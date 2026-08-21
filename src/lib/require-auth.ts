import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Cookie-session auth for API routes that must not run as the service role
 * until a staff user is present. Pair with middleware; this is defense in depth.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { user, response: null };
}
