import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { UpdateAutomationInput } from '@/types/automations';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * GET /api/automations/[id] - Get a single automation
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data, error } = await supabase
      .from('automations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Automation not found' },
          { status: 404 }
        );
      }
      console.error('[Automations] Fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch automation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ automation: data });
  } catch (error) {
    console.error('[Automations] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/automations/[id] - Update an automation
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body: Partial<UpdateAutomationInput> = await request.json();

    // Build update object with only provided fields
    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.trigger !== undefined) updateData.trigger = body.trigger;
    if (body.delay_hours !== undefined) updateData.delay_hours = body.delay_hours;
    if (body.message_type !== undefined) updateData.message_type = body.message_type;
    if (body.message_template !== undefined) updateData.message_template = body.message_template;
    if (body.email_subject !== undefined) updateData.email_subject = body.email_subject;
    if (body.is_active !== undefined) updateData.is_active = body.is_active;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('automations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Automation not found' },
          { status: 404 }
        );
      }
      console.error('[Automations] Update error:', error);
      return NextResponse.json(
        { error: 'Failed to update automation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ automation: data });
  } catch (error) {
    console.error('[Automations] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/automations/[id] - Delete an automation
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { error } = await supabase
      .from('automations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Automations] Delete error:', error);
      return NextResponse.json(
        { error: 'Failed to delete automation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Automations] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
