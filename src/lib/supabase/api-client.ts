import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Simple Supabase client for API routes (no cookie handling needed)
// Uses service key for server-side access to utility tables
export function createApiClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
