import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET - List users
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    
    const role = searchParams.get('role');
    const limit = parseInt(searchParams.get('limit') || '100');

    let query = supabase
      .from('users')
      .select('*')
      .order('name', { ascending: true })
      .limit(limit);

    if (role) {
      if (role === 'field') {
        // Field crew - technicians who do on-site work
        query = query.eq('role', 'field');
      } else {
        query = query.eq('role', role);
      }
    }

    const { data: users, error } = await query;

    if (error) {
      console.error('Users fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    console.error('Users API error:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
