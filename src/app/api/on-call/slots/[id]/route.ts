import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

// GET - Get single slot
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();
    
    const { data, error } = await supabase
      .from('on_call_slots')
      .select(`
        *,
        assigned_user:users!on_call_slots_assigned_user_id_fkey (id, name, email, phone),
        signups:on_call_signups (
          id,
          status,
          requested_at,
          user:users (id, name, email)
        ),
        callouts:on_call_callouts (*)
      `)
      .eq('id', params.id)
      .single();

    if (error) {
      return NextResponse.json({ error: 'Slot not found' }, { status: 404 });
    }

    return NextResponse.json({ slot: data });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PUT - Update slot (assign user, change status)
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const { data, error } = await supabase
      .from('on_call_slots')
      .update({
        ...body,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select(`
        *,
        assigned_user:users!on_call_slots_assigned_user_id_fkey (id, name, email)
      `)
      .single();

    if (error) {
      console.error('Error updating slot:', error);
      return NextResponse.json({ error: 'Failed to update slot' }, { status: 500 });
    }

    return NextResponse.json({ slot: data });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE - Remove assignment from slot
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();

    const { data, error } = await supabase
      .from('on_call_slots')
      .update({
        assigned_user_id: null,
        status: 'open',
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: 'Failed to clear slot' }, { status: 500 });
    }

    return NextResponse.json({ slot: data, message: 'Slot cleared' });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
