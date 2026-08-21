import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendSMS, sendEmail, textToHtml, isTwilioConfigured, isResendConfigured } from '@/lib/messaging';
import type { Automation, AutomationTrigger, TriggerEntityType } from '@/types/automations';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Verify cron secret in production
const CRON_SECRET = process.env.CRON_SECRET;

interface TemplateData {
  customer_name: string;
  customer_phone?: string;
  customer_email?: string;
  service_type?: string;
  address?: string;
  tech_name?: string;
  date?: string;
  time?: string;
  amount?: string;
  job_number?: string;
  quote_number?: string;
  invoice_number?: string;
  due_date?: string;
  valid_until?: string;
  payment_link?: string;
  payment_method?: string;
}

/**
 * Replace template variables in a message
 */
function processTemplate(template: string, data: TemplateData): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return (data as any)[key] || match;
  });
}

/**
 * Get the entity type for a trigger
 */
function getTriggerEntityType(trigger: AutomationTrigger): TriggerEntityType {
  switch (trigger) {
    case 'appointment_scheduled':
    case 'job_completed':
      return 'job';
    case 'quote_sent':
    case 'quote_approved':
      return 'quote';
    case 'invoice_sent':
    case 'invoice_paid':
      return 'invoice';
    default:
      return 'job';
  }
}

/**
 * Find events that should trigger automations
 */
async function findTriggerEvents(automation: Automation) {
  const now = new Date();
  const delayMs = automation.delay_hours * 60 * 60 * 1000;
  
  switch (automation.trigger) {
    case 'job_completed': {
      // Find jobs completed in the past that haven't been processed
      const triggerTime = new Date(now.getTime() - delayMs);
      const { data: jobs } = await supabase
        .from('jobs')
        .select(`
          id,
          job_type,
          job_number,
          completed_at,
          property:properties (
            address,
            customer:customers (
              id,
              name,
              phone,
              email
            )
          ),
          assigned_user:team_members (name)
        `)
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .lte('completed_at', triggerTime.toISOString())
        .gte('completed_at', new Date(triggerTime.getTime() - 24 * 60 * 60 * 1000).toISOString());
      
      return (jobs || []).map(job => ({
        entity_id: job.id,
        entity_type: 'job' as TriggerEntityType,
        customer_id: (job as any).property?.customer?.id,
        data: {
          customer_name: (job as any).property?.customer?.name || 'Valued Customer',
          customer_phone: (job as any).property?.customer?.phone,
          customer_email: (job as any).property?.customer?.email,
          service_type: job.job_type,
          address: (job as any).property?.address,
          tech_name: (job as any).assigned_user?.name,
          job_number: job.job_number,
        } as TemplateData,
      }));
    }

    case 'appointment_scheduled': {
      // For appointments, delay_hours is negative (before the event)
      // Find jobs scheduled for `abs(delay_hours)` from now
      const targetTime = new Date(now.getTime() + Math.abs(delayMs));
      const targetDate = targetTime.toISOString().split('T')[0];
      
      const { data: jobs } = await supabase
        .from('jobs')
        .select(`
          id,
          job_type,
          job_number,
          scheduled_date,
          scheduled_time,
          property:properties (
            address,
            customer:customers (
              id,
              name,
              phone,
              email
            )
          ),
          assigned_user:team_members (name)
        `)
        .eq('status', 'scheduled')
        .eq('scheduled_date', targetDate);

      return (jobs || []).map(job => ({
        entity_id: job.id,
        entity_type: 'job' as TriggerEntityType,
        customer_id: (job as any).property?.customer?.id,
        data: {
          customer_name: (job as any).property?.customer?.name || 'Valued Customer',
          customer_phone: (job as any).property?.customer?.phone,
          customer_email: (job as any).property?.customer?.email,
          service_type: job.job_type,
          address: (job as any).property?.address,
          tech_name: (job as any).assigned_user?.name,
          date: job.scheduled_date,
          time: job.scheduled_time || 'TBD',
          job_number: job.job_number,
        } as TemplateData,
      }));
    }

    case 'quote_sent': {
      // Find quotes sent X hours ago that are still pending
      const triggerTime = new Date(now.getTime() - delayMs);
      const { data: quotes } = await supabase
        .from('quotes')
        .select(`
          id,
          quote_number,
          total,
          valid_until,
          sent_at,
          customer:customers (
            id,
            name,
            phone,
            email
          ),
          property:properties (address)
        `)
        .eq('status', 'sent')
        .not('sent_at', 'is', null)
        .lte('sent_at', triggerTime.toISOString())
        .gte('sent_at', new Date(triggerTime.getTime() - 24 * 60 * 60 * 1000).toISOString());

      return (quotes || []).map(quote => ({
        entity_id: quote.id,
        entity_type: 'quote' as TriggerEntityType,
        customer_id: (quote as any).customer?.id,
        data: {
          customer_name: (quote as any).customer?.name || 'Valued Customer',
          customer_phone: (quote as any).customer?.phone,
          customer_email: (quote as any).customer?.email,
          quote_number: String(quote.quote_number),
          amount: `$${(quote.total / 100).toFixed(2)}`,
          valid_until: quote.valid_until,
          address: (quote as any).property?.address,
          service_type: 'well service',
        } as TemplateData,
      }));
    }

    case 'invoice_sent': {
      // Find invoices sent X hours ago that are still unpaid
      const triggerTime = new Date(now.getTime() - delayMs);
      const { data: invoices } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          total,
          due_date,
          sent_at,
          customer:customers (
            id,
            name,
            phone,
            email
          )
        `)
        .in('status', ['sent', 'viewed', 'overdue'])
        .not('sent_at', 'is', null)
        .lte('sent_at', triggerTime.toISOString())
        .gte('sent_at', new Date(triggerTime.getTime() - 24 * 60 * 60 * 1000).toISOString());

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jobs.scwellservice.com';
      
      return (invoices || []).map(invoice => ({
        entity_id: invoice.id,
        entity_type: 'invoice' as TriggerEntityType,
        customer_id: (invoice as any).customer?.id,
        data: {
          customer_name: (invoice as any).customer?.name || 'Valued Customer',
          customer_phone: (invoice as any).customer?.phone,
          customer_email: (invoice as any).customer?.email,
          invoice_number: String(invoice.invoice_number),
          amount: `$${(invoice.total / 100).toFixed(2)}`,
          due_date: invoice.due_date,
          payment_link: `${baseUrl}/invoices/${invoice.id}/pay`,
        } as TemplateData,
      }));
    }

    case 'invoice_paid': {
      // Find invoices paid X hours ago
      const triggerTime = new Date(now.getTime() - delayMs);
      const { data: invoices } = await supabase
        .from('invoices')
        .select(`
          id,
          invoice_number,
          total,
          paid_at,
          customer:customers (
            id,
            name,
            phone,
            email
          )
        `)
        .eq('status', 'paid')
        .not('paid_at', 'is', null)
        .lte('paid_at', triggerTime.toISOString())
        .gte('paid_at', new Date(triggerTime.getTime() - 24 * 60 * 60 * 1000).toISOString());

      return (invoices || []).map(invoice => ({
        entity_id: invoice.id,
        entity_type: 'invoice' as TriggerEntityType,
        customer_id: (invoice as any).customer?.id,
        data: {
          customer_name: (invoice as any).customer?.name || 'Valued Customer',
          customer_phone: (invoice as any).customer?.phone,
          customer_email: (invoice as any).customer?.email,
          invoice_number: String(invoice.invoice_number),
          amount: `$${(invoice.total / 100).toFixed(2)}`,
        } as TemplateData,
      }));
    }

    default:
      return [];
  }
}

/**
 * Check if a message has already been sent for this entity/automation combo
 */
async function hasMessageBeenSent(
  automationId: string,
  entityId: string,
  entityType: TriggerEntityType,
  messageType: 'sms' | 'email'
): Promise<boolean> {
  const { data } = await supabase
    .from('automation_sent_messages')
    .select('id')
    .eq('automation_id', automationId)
    .eq('trigger_entity_id', entityId)
    .eq('trigger_entity_type', entityType)
    .eq('message_type', messageType)
    .maybeSingle();
  
  return !!data;
}

/**
 * Schedule a message to be sent
 */
async function scheduleMessage(
  automation: Automation,
  entityId: string,
  entityType: TriggerEntityType,
  customerId: string,
  messageType: 'sms' | 'email',
  recipient: string,
  content: string
) {
  const scheduledFor = new Date();
  
  try {
    await supabase.from('automation_sent_messages').insert({
      automation_id: automation.id,
      customer_id: customerId,
      trigger_entity_id: entityId,
      trigger_entity_type: entityType,
      message_type: messageType,
      recipient,
      message_content: content,
      status: 'pending',
      scheduled_for: scheduledFor.toISOString(),
    });
    return true;
  } catch (error) {
    // Unique constraint violation means already scheduled
    return false;
  }
}

/**
 * Send pending messages that are due
 */
async function sendPendingMessages() {
  const results = { sent: 0, failed: 0, skipped: 0 };
  
  // Get pending messages that are due
  const { data: pendingMessages } = await supabase
    .from('automation_sent_messages')
    .select('*, automation:automations(name, email_subject)')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .limit(50);  // Process in batches

  if (!pendingMessages?.length) {
    return results;
  }

  for (const msg of pendingMessages) {
    try {
      let success = false;
      let externalId: string | undefined;
      let errorMessage: string | undefined;

      if (msg.message_type === 'sms') {
        if (!isTwilioConfigured()) {
          results.skipped++;
          continue;
        }
        const result = await sendSMS({
          to: msg.recipient,
          message: msg.message_content,
        });
        success = result.success;
        externalId = result.messageId;
        errorMessage = result.error;
      } else if (msg.message_type === 'email') {
        if (!isResendConfigured()) {
          results.skipped++;
          continue;
        }
        const result = await sendEmail({
          to: msg.recipient,
          subject: (msg as any).automation?.email_subject || 'Message from Southern California Well Service',
          html: textToHtml(msg.message_content),
          text: msg.message_content,
        });
        success = result.success;
        externalId = result.messageId;
        errorMessage = result.error;
      }

      // Update message status
      await supabase
        .from('automation_sent_messages')
        .update({
          status: success ? 'sent' : 'failed',
          external_id: externalId,
          error_message: errorMessage,
          sent_at: success ? new Date().toISOString() : null,
        })
        .eq('id', msg.id);

      // Update automation sent count
      if (success) {
        await supabase.rpc('increment_automation_sent_count', {
          automation_id: msg.automation_id,
        }).catch(() => {
          // Fallback if RPC doesn't exist
          supabase
            .from('automations')
            .update({
              sent_count: supabase.sql`sent_count + 1`,
              last_sent_at: new Date().toISOString(),
            })
            .eq('id', msg.automation_id);
        });
        results.sent++;
      } else {
        results.failed++;
      }

      // Log the event
      await supabase.from('automation_logs').insert({
        automation_id: msg.automation_id,
        event_type: success ? 'sent' : 'failed',
        details: {
          message_id: msg.id,
          recipient: msg.recipient,
          message_type: msg.message_type,
          external_id: externalId,
          error: errorMessage,
        },
      });
    } catch (error) {
      console.error(`[Automations] Error processing message ${msg.id}:`, error);
      results.failed++;
    }
  }

  return results;
}

/**
 * POST /api/cron/process-automations
 * Main cron endpoint to process automations
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const results = {
    automationsProcessed: 0,
    eventsFound: 0,
    messagesScheduled: 0,
    messagesSent: 0,
    messagesFailed: 0,
    messagesSkipped: 0,
  };

  try {
    console.log('[Automations Cron] Starting processing...');

    // 1. Get all active automations
    const { data: automations } = await supabase
      .from('automations')
      .select('*')
      .eq('is_active', true);

    if (!automations?.length) {
      console.log('[Automations Cron] No active automations found');
      return NextResponse.json({
        success: true,
        message: 'No active automations',
        results,
        duration: Date.now() - startTime,
      });
    }

    // 2. Process each automation
    for (const automation of automations) {
      results.automationsProcessed++;
      
      try {
        const events = await findTriggerEvents(automation);
        results.eventsFound += events.length;

        for (const event of events) {
          if (!event.customer_id) continue;

          const messageTypes: ('sms' | 'email')[] = 
            automation.message_type === 'both' 
              ? ['sms', 'email'] 
              : [automation.message_type as 'sms' | 'email'];

          for (const msgType of messageTypes) {
            // Skip if already sent
            const alreadySent = await hasMessageBeenSent(
              automation.id,
              event.entity_id,
              event.entity_type,
              msgType
            );
            if (alreadySent) continue;

            // Get recipient
            const recipient = msgType === 'sms' 
              ? event.data.customer_phone 
              : event.data.customer_email;
            
            if (!recipient) continue;

            // Process template
            const content = processTemplate(automation.message_template, event.data);

            // Schedule the message
            const scheduled = await scheduleMessage(
              automation,
              event.entity_id,
              event.entity_type,
              event.customer_id,
              msgType,
              recipient,
              content
            );

            if (scheduled) {
              results.messagesScheduled++;
            }
          }
        }
      } catch (error) {
        console.error(`[Automations Cron] Error processing automation ${automation.id}:`, error);
      }
    }

    // 3. Send pending messages
    const sendResults = await sendPendingMessages();
    results.messagesSent = sendResults.sent;
    results.messagesFailed = sendResults.failed;
    results.messagesSkipped = sendResults.skipped;

    console.log('[Automations Cron] Completed:', results);

    // Log the cron run
    await supabase.from('automation_logs').insert({
      event_type: 'cron_run',
      details: {
        ...results,
        duration_ms: Date.now() - startTime,
      },
    });

    return NextResponse.json({
      success: true,
      results,
      duration: Date.now() - startTime,
    });
  } catch (error) {
    console.error('[Automations Cron] Fatal error:', error);
    return NextResponse.json(
      { error: 'Cron processing failed', details: String(error) },
      { status: 500 }
    );
  }
}

// Also allow GET for easier testing
export async function GET(request: NextRequest) {
  return POST(request);
}
