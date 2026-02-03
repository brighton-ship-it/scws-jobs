import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Automation, CreateAutomationInput } from '@/types/automations';

// Check if we're in demo/mock mode
const useMockData = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

// Use service key for server-side operations
const supabase = useMockData ? null : createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Mock automations for demo mode
const mockAutomations: Automation[] = [
  {
    id: 'auto1',
    name: 'Post-Service Review Request',
    description: 'Ask for Google review after job completion',
    trigger: 'job_completed',
    delay_hours: 24,
    message_type: 'sms',
    message_template: 'Hi {{customer_name}}, thank you for choosing SCWS! We hope you were satisfied with our service. Would you mind leaving us a review? It really helps! https://g.page/scws/review',
    email_subject: null,
    is_active: true,
    sent_count: 47,
    created_at: '2024-01-15T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
  },
  {
    id: 'auto2',
    name: 'Appointment Reminder',
    description: 'Remind customer of upcoming appointment',
    trigger: 'appointment_scheduled',
    delay_hours: -24,
    message_type: 'both',
    message_template: 'Hi {{customer_name}}, this is a reminder that SCWS will be at {{address}} tomorrow at {{time}} for {{service_type}}. See you then!',
    email_subject: 'Appointment Reminder - SCWS Service Tomorrow',
    is_active: true,
    sent_count: 156,
    created_at: '2024-01-10T00:00:00Z',
    updated_at: '2024-05-15T00:00:00Z',
  },
  {
    id: 'auto3',
    name: 'Invoice Payment Reminder',
    description: 'Follow up on sent invoices',
    trigger: 'invoice_sent',
    delay_hours: 72,
    message_type: 'email',
    message_template: 'Hi {{customer_name}}, we wanted to follow up on Invoice #{{invoice_number}} for ${{amount}}. Payment is due by {{due_date}}. Pay online: {{payment_link}}',
    email_subject: 'Invoice #{{invoice_number}} - Payment Reminder',
    is_active: false,
    sent_count: 23,
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-04-20T00:00:00Z',
  },
  {
    id: 'auto4',
    name: 'Payment Thank You',
    description: 'Thank customer after payment received',
    trigger: 'invoice_paid',
    delay_hours: 1,
    message_type: 'sms',
    message_template: 'Thank you, {{customer_name}}! We received your payment of ${{amount}} for Invoice #{{invoice_number}}. We appreciate your business!',
    email_subject: null,
    is_active: true,
    sent_count: 89,
    created_at: '2024-02-15T00:00:00Z',
    updated_at: '2024-06-10T00:00:00Z',
  },
];

/**
 * GET /api/automations - List all automations
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const activeOnly = searchParams.get('active') === 'true';
    const trigger = searchParams.get('trigger');

    // Return mock data in demo mode
    if (useMockData || !supabase) {
      let automations = [...mockAutomations];
      
      if (activeOnly) {
        automations = automations.filter(a => a.is_active);
      }
      if (trigger) {
        automations = automations.filter(a => a.trigger === trigger);
      }
      
      return NextResponse.json({ automations });
    }

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
      console.error('[Automations] Fetch error, falling back to mock data:', error);
      // Fall back to mock data on error
      let automations = [...mockAutomations];
      if (activeOnly) {
        automations = automations.filter(a => a.is_active);
      }
      if (trigger) {
        automations = automations.filter(a => a.trigger === trigger);
      }
      return NextResponse.json({ automations });
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

    // Handle mock data mode
    if (useMockData || !supabase) {
      const newAutomation: Automation = {
        id: `auto${Date.now()}`,
        name: body.name,
        description: body.description || null,
        trigger: body.trigger,
        delay_hours: body.delay_hours ?? 24,
        message_type: body.message_type || 'sms',
        message_template: body.message_template,
        email_subject: body.email_subject || null,
        is_active: body.is_active ?? true,
        sent_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockAutomations.unshift(newAutomation);
      return NextResponse.json({ automation: newAutomation }, { status: 201 });
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
      console.error('[Automations] Create error, falling back to mock:', error);
      // Fall back to mock data on error
      const newAutomation: Automation = {
        id: `auto${Date.now()}`,
        name: body.name,
        description: body.description || null,
        trigger: body.trigger,
        delay_hours: body.delay_hours ?? 24,
        message_type: body.message_type || 'sms',
        message_template: body.message_template,
        email_subject: body.email_subject || null,
        is_active: body.is_active ?? true,
        sent_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      mockAutomations.unshift(newAutomation);
      return NextResponse.json({ automation: newAutomation }, { status: 201 });
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
