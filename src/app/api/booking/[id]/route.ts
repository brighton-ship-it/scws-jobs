import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { requireUser } from '@/lib/require-auth';

const BOOKING_PATCH_FIELDS = [
  'status',
  'notes',
  'customer_id',
  'job_id',
  'preferred_date',
  'preferred_time',
] as const;

/**
 * PATCH /api/booking/[id] - Update a booking request (staff only)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const supabase = createServiceClient();
    const body = await request.json();
    const { id } = params;

    const updates: Record<string, unknown> = {};
    for (const field of BOOKING_PATCH_FIELDS) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    const { data, error } = await supabase
      .from('booking_requests')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ booking: data });
  } catch (error) {
    console.error('Booking update error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * DELETE /api/booking/[id] - Delete a booking request (staff only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireUser();
  if (auth.response) return auth.response;

  try {
    const supabase = createServiceClient();
    const { id } = params;

    const { error } = await supabase
      .from('booking_requests')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Booking delete error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
