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

// POST - Create a new team member
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();
    
    const { name, email, phone, role } = body;
    
    if (!name || !email) {
      return NextResponse.json({ error: 'Name and email are required' }, { status: 400 });
    }

    // Check if email already exists
    const { data: existing } = await supabase
      .from('team_members')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return NextResponse.json({ error: 'A user with this email already exists' }, { status: 409 });
    }

    const { data: user, error } = await supabase
      .from('team_members')
      .insert({
        name,
        email,
        phone: phone || null,
        role: role || 'tech',
        active: true,
      })
      .select()
      .single();

    if (error) {
      console.error('User create error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    console.error('Users POST error:', error);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
