const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIiwiaWF0IjoxfQ.placeholder';

/** Preview / local builds may lack NEXT_PUBLIC keys; never throw at import or prerender. */
export function supabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const configured = Boolean(url && anonKey && url !== 'your-supabase-url');
  return {
    url: configured ? url! : PLACEHOLDER_URL,
    anonKey: configured ? anonKey! : PLACEHOLDER_ANON,
    configured,
  };
}
