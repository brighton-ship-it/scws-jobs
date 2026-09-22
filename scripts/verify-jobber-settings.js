#!/usr/bin/env node
/**
 * Verify public.settings exists for the Jobber OAuth durable store.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY from the
 * environment. Prints no keys, tokens, or row values.
 *
 * Exit 0: table is present.
 * Exit 2: table is missing (apply supabase/migrations/20260922_jobber_oauth_single_writer.sql).
 * Exit 1: env missing or the read failed for another reason.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL.trim();
const key = (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

if (!url || !key || url === 'your-supabase-url') {
  console.error(
    'Jobber settings verify: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY'
  );
  process.exit(1);
}

const endpoint = new URL('/rest/v1/settings', url);
endpoint.searchParams.set('key', 'eq.jobber_oauth');
endpoint.searchParams.set('select', 'key');

fetch(endpoint, {
  headers: {
    apikey: key,
    Authorization: 'Bearer ' + key,
    Accept: 'application/json',
  },
})
  .then(async (response) => {
    const body = await response.text();
    if (response.ok) {
      console.log('Jobber settings verify: public.settings is present');
      process.exit(0);
    }

    let code = '';
    try {
      code = String((JSON.parse(body) || {}).code || '');
    } catch {
      code = '';
    }

    if (
      code === 'PGRST205' ||
      code === '42P01' ||
      (/Could not find the table/i.test(body) && /settings/i.test(body))
    ) {
      console.error(
        'Jobber settings verify: public.settings is missing. Apply supabase/migrations/20260922_jobber_oauth_single_writer.sql in the Supabase SQL Editor. Env tokens were not refreshed.'
      );
      process.exit(2);
    }

    console.error('Jobber settings verify: settings read failed (HTTP ' + response.status + ').');
    process.exit(1);
  })
  .catch(() => {
    console.error('Jobber settings verify: settings read failed (network).');
    process.exit(1);
  });
