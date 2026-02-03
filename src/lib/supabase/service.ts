import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

/**
 * Service role client for bypassing RLS
 * Use this for server-side operations that need full database access
 * (e.g., public portal routes without user auth)
 */
export function createServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase service configuration');
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
