import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { startOfWeek, endOfWeek, eachDayOfInterval, isWeekend, format, addWeeks } from 'date-fns';

// GET - List on-call slots
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { searchParams } = new URL(request.url);
    
    const startDate = searchParams.get('start') || format(new Date(), 'yyyy-MM-dd');
    const endDate = searchParams.get('end') || format(addWeeks(new Date(), 8), 'yyyy-MM-dd');
    const userId = searchParams.get('user_id');

    let query = supabase
      .from('on_call_slots')
      .select(`
        *,
        assigned_user:users!on_call_slots_assigned_user_id_fkey (id, name, email, phone),
        signups:on_call_signups (
          id,
          status,
          user:users (id, name)
        )
      `)
      .gte('slot_date', startDate)
      .lte('slot_date', endDate)
      .order('slot_date', { ascending: true });

    if (userId) {
      query = query.eq('assigned_user_id', userId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching slots:', error);
      return NextResponse.json({ error: 'Failed to fetch slots' }, { status: 500 });
    }

    // Generate any missing weekend slots
    const existingDates = new Set(data?.map(s => s.slot_date) || []);
    const allDays = eachDayOfInterval({
      start: new Date(startDate),
      end: new Date(endDate),
    });
    
    const missingWeekends = allDays
      .filter(d => isWeekend(d) && !existingDates.has(format(d, 'yyyy-MM-dd')))
      .map(d => ({
        slot_date: format(d, 'yyyy-MM-dd'),
        status: 'open',
        assigned_user: null,
        signups: [],
      }));

    // Auto-create missing slots in DB
    if (missingWeekends.length > 0) {
      await supabase
        .from('on_call_slots')
        .upsert(
          missingWeekends.map(s => ({ slot_date: s.slot_date, status: 'open' })),
          { onConflict: 'slot_date' }
        );
    }

    const slots = [...(data || []), ...missingWeekends].sort(
      (a, b) => a.slot_date.localeCompare(b.slot_date)
    );

    return NextResponse.json({ slots });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST - Sign up for a slot
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();
    const { slot_date, user_id, auto_approve } = body;

    if (!slot_date || !user_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get or create the slot
    let { data: slot } = await supabase
      .from('on_call_slots')
      .select('*')
      .eq('slot_date', slot_date)
      .single();

    if (!slot) {
      const { data: newSlot, error: createError } = await supabase
        .from('on_call_slots')
        .insert({ slot_date, status: 'open' })
        .select()
        .single();

      if (createError) throw createError;
      slot = newSlot;
    }

    // Check if already assigned
    if (slot.assigned_user_id) {
      return NextResponse.json({ error: 'Slot already filled' }, { status: 400 });
    }

    // If auto_approve or slot is open, assign directly
    if (auto_approve) {
      const { data: updated, error: updateError } = await supabase
        .from('on_call_slots')
        .update({ 
          assigned_user_id: user_id, 
          status: 'filled',
          updated_at: new Date().toISOString(),
        })
        .eq('id', slot.id)
        .select(`
          *,
          assigned_user:users!on_call_slots_assigned_user_id_fkey (id, name, email)
        `)
        .single();

      if (updateError) throw updateError;
      return NextResponse.json({ slot: updated, message: 'Signed up successfully' });
    }

    // Otherwise create a signup request
    const { data: signup, error: signupError } = await supabase
      .from('on_call_signups')
      .insert({
        slot_id: slot.id,
        user_id,
        status: 'pending',
      })
      .select()
      .single();

    if (signupError) {
      if (signupError.code === '23505') {
        return NextResponse.json({ error: 'Already signed up for this slot' }, { status: 400 });
      }
      throw signupError;
    }

    return NextResponse.json({ signup, message: 'Signup request submitted' });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
