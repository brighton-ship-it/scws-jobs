import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * POST /api/admin/run-migration
 * Runs a migration SQL file via Supabase
 */
export async function POST(request: NextRequest) {
  try {
    // Verify admin secret
    const authHeader = request.headers.get('authorization');
    const adminSecret = process.env.ADMIN_SECRET || process.env.SUPABASE_SERVICE_KEY;
    
    if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sql } = await request.json();
    
    if (!sql) {
      return NextResponse.json({ error: 'SQL required' }, { status: 400 });
    }

    // Use service role for admin operations
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Split SQL into statements and execute
    const statements = sql
      .split(';')
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && !s.startsWith('--'));

    const results = [];
    for (const stmt of statements) {
      try {
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: stmt + ';' });
        if (error) {
          // Try direct query via postgres function if rpc doesn't exist
          results.push({ statement: stmt.substring(0, 50) + '...', status: 'error', error: error.message });
        } else {
          results.push({ statement: stmt.substring(0, 50) + '...', status: 'success' });
        }
      } catch (e) {
        results.push({ statement: stmt.substring(0, 50) + '...', status: 'error', error: String(e) });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      { error: 'Migration failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
