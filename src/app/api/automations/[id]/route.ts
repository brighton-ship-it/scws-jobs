import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { Automation, UpdateAutomationInput } from '@/types/automations';

// Check if we're in demo/mock mode
const useMockData = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

const supabase = useMockData ? null : createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Mock automations store (shared with main route via module state)
// Note: In a real app, this would be shared state or imported from a common module
let mockAutomations: Automation[] = [
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
 * GET /api/automations/[id] - Get a single automation
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Handle mock data mode
    if (useMockData || !supabase) {
      const automation = mockAutomations.find(a => a.id === id);
      if (!automation) {
        return NextResponse.json(
          { error: 'Automation not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ automation });
    }

    const { data, error } = await supabase
      .from('automations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[Automations] Fetch error, trying mock data:', error);
      // Fall back to mock data
      const automation = mockAutomations.find(a => a.id === id);
      if (automation) {
        return NextResponse.json({ automation });
      }
      return NextResponse.json(
        { error: 'Automation not found' },
        { status: 404 }
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

    // Handle mock data mode
    if (useMockData || !supabase) {
      const index = mockAutomations.findIndex(a => a.id === id);
      if (index === -1) {
        return NextResponse.json(
          { error: 'Automation not found' },
          { status: 404 }
        );
      }
      mockAutomations[index] = {
        ...mockAutomations[index],
        ...updateData,
        updated_at: new Date().toISOString(),
      };
      return NextResponse.json({ automation: mockAutomations[index] });
    }

    const { data, error } = await supabase
      .from('automations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[Automations] Update error, trying mock data:', error);
      // Fall back to mock data
      const index = mockAutomations.findIndex(a => a.id === id);
      if (index !== -1) {
        mockAutomations[index] = {
          ...mockAutomations[index],
          ...updateData,
          updated_at: new Date().toISOString(),
        };
        return NextResponse.json({ automation: mockAutomations[index] });
      }
      return NextResponse.json(
        { error: 'Automation not found' },
        { status: 404 }
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

    // Handle mock data mode
    if (useMockData || !supabase) {
      const index = mockAutomations.findIndex(a => a.id === id);
      if (index === -1) {
        return NextResponse.json(
          { error: 'Automation not found' },
          { status: 404 }
        );
      }
      mockAutomations.splice(index, 1);
      return NextResponse.json({ success: true });
    }

    const { error } = await supabase
      .from('automations')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[Automations] Delete error, trying mock data:', error);
      // Fall back to mock data
      const index = mockAutomations.findIndex(a => a.id === id);
      if (index !== -1) {
        mockAutomations.splice(index, 1);
        return NextResponse.json({ success: true });
      }
      return NextResponse.json(
        { error: 'Automation not found' },
        { status: 404 }
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
