import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// GET - Lookup team member by email
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email');

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const { data: teamMember, error } = await supabase
      .from('team_members')
      .select('id, name, email, role')
      .eq('email', email)
      .single();

    if (error) {
      // Not found is ok, just return null
      return NextResponse.json({ team_member: null });
    }

    return NextResponse.json({ team_member: teamMember });
  } catch (error) {
    console.error('User lookup error:', error);
    return NextResponse.json({ error: 'Failed to lookup user' }, { status: 500 });
  }
}
