/** Same rule as middleware: no Supabase config → dashboard APIs are local/demo. */
export function isDemoAuthMode(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  return !url || url === 'your-supabase-url';
}
