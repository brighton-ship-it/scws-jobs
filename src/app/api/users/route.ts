import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET - List users (from team_members table for job assignments)
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    
    const role = searchParams.get('role');
    const activeOnly = searchParams.get('active') !== 'false';
    const limit = parseInt(searchParams.get('limit') || '100');

    // Use team_members table for job assignments
    let query = supabase
      .from('team_members')
      .select('*')
      .order('name', { ascending: true })
      .limit(limit);

    if (activeOnly) {
      query = query.eq('active', true);
    }

    if (role) {
      query = query.eq('role', role);
    }

    const { data: users, error } = await query;

    if (error) {
      console.error('Users fetch error:', error);
      // Fallback to users table if team_members doesn't exist
      const { data: fallbackUsers, error: fallbackError } = await supabase
        .from('users')
        .select('*')
        .order('name', { ascending: true })
        .limit(limit);
      
      if (fallbackError) {
        return NextResponse.json({ error: fallbackError.message }, { status: 500 });
      }
      return NextResponse.json({ users: fallbackUsers || [] });
    }

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    console.error('Users API error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
