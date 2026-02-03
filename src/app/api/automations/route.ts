import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Automation, CreateAutomationInput } from '@/types/automations';

// Use service key for server-side operations
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * GET /api/automations - List all automations
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';
    const trigger = searchParams.get('trigger');

    let query = supabase
      .from('automations')
      .select('*')
      .order('created_at', { ascending: false });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    if (trigger) {
      query = query.eq('trigger', trigger);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Automations] Fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch automations' },
        { status: 500 }
      );
    }

    return NextResponse.json({ automations: data || [] });
  } catch (error) {
    console.error('[Automations] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/automations - Create a new automation
 */
export async function POST(request: NextRequest) {
  try {
    const body: CreateAutomationInput = await request.json();

    // Validate required fields
    if (!body.name || !body.trigger || !body.message_template) {
      return NextResponse.json(
        { error: 'Missing required fields: name, trigger, message_template' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('automations')
      .insert({
        name: body.name,
        description: body.description || null,
        trigger: body.trigger,
        delay_hours: body.delay_hours ?? 24,
        message_type: body.message_type || 'sms',
        message_template: body.message_template,
        email_subject: body.email_subject || null,
        is_active: body.is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      console.error('[Automations] Create error:', error);
      return NextResponse.json(
        { error: 'Failed to create automation' },
        { status: 500 }
      );
    }

    return NextResponse.json({ automation: data }, { status: 201 });
  } catch (error) {
    console.error('[Automations] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
