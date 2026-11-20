import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import { authorizeVapiWebhook } from '@/lib/receptionist/vapi-webhook-auth';
import { callerUtteranceText } from '@/lib/receptionist/caller-urgency';
import { assignReceptionistFollowUp } from '@/lib/receptionist/follow-up-task-jobber';

const OFFICE_EMAILS = ['brighton@scwellservice.com', 'shanicey@scwellservice.com'];

interface SarahCallData {
  // SpeakSarah expected fields (flexible - we'll adapt to their actual format)
  call_id?: string;
  id?: string;
  
  // Caller info
  caller_phone?: string;
  phone?: string;
  from?: string;
  caller_name?: string;
  customer_name?: string;
  name?: string;
  
  // Call content
  transcript?: string;
  messages?: Array<{ role: string; content: string }>;
  summary?: string;
  call_summary?: string;
  
  // Extracted info
  service_type?: string;
  service_needed?: string;
  address?: string;
  city?: string;
  urgency?: string;
  is_urgent?: boolean;
  notes?: string;
  
  // Metadata
  duration?: number;
  duration_seconds?: number;
  started_at?: string;
  ended_at?: string;
  timestamp?: string;
  recording_url?: string;
  
  // Status
  status?: string;
  outcome?: string;
}

/**
 * POST /api/receptionist/sarah - Receive calls from SpeakSarah AI Receptionist
 * Creates leads and customer records. Follow-ups are Jobber tasks, not in-app tasks.
 */
export async function POST(request: NextRequest) {
  const webhookAuth = authorizeVapiWebhook(request.headers, process.env, {
    secretEnvName: 'SARAH_WEBHOOK_SECRET',
  });
  if (!webhookAuth.ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    // Log incoming request for debugging
    const body: SarahCallData = await request.json();
    console.log('[Sarah Webhook] Received:', JSON.stringify(body, null, 2));
    
    // Flexible field extraction - handle various formats
    const callId = body.call_id || body.id || `sarah-${Date.now()}`;
    const phone = (body.caller_phone || body.phone || body.from || '')
      .replace(/\D/g, '');
    const customerName = body.caller_name || body.customer_name || body.name || '';
    const transcript = body.transcript || 
      body.messages?.map(m => `${m.role}: ${m.content}`).join('\n') || 
      '';
    const summary = body.summary || body.call_summary || '';
    const serviceNeeded = body.service_type || body.service_needed || '';
    const address = body.address || '';
    const city = body.city || '';
    const duration = body.duration || body.duration_seconds || 0;
    const isUrgent = body.is_urgent || body.urgency === 'urgent' ||
      /urgent|emergency|no water|flooding|leak/i.test(transcript + summary);
    const recordingUrl = body.recording_url || null;
    
    const callTime = body.started_at || body.timestamp || new Date().toISOString();

    if (!phone || phone.length < 10) {
      console.log('[Sarah Webhook] Skipping - no valid phone');
      return NextResponse.json({ ok: true, skipped: true, reason: 'no-phone' });
    }

    const supabase = createServiceClient();

    // Check for duplicate
    const { data: existing } = await supabase
      .from('receptionist_calls')
      .select('id')
      .eq('vapi_call_id', `sarah-${callId}`)
      .single();

    if (existing) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already-processed' });
    }

    // Find or create customer
    let customerId: string | null = null;
    let isNewCustomer = false;

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id, name')
      .eq('phone', phone)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else if (customerName || phone) {
      const { data: newCustomer, error } = await supabase
        .from('customers')
        .insert({
          name: customerName.trim() || `Caller ${formatPhone(phone)}`,
          phone: phone,
          billing_address: address ? `${address}${city ? `, ${city}` : ''}` : null,
          lead_source: 'phone',
          lead_source_detail: 'AI Receptionist (Sarah)',
          lead_stage: 'lead',
        } as any)
        .select()
        .single();

      if (!error && newCustomer) {
        customerId = newCustomer.id;
        isNewCustomer = true;

        if (address) {
          await supabase.from('properties').insert({
            customer_id: customerId,
            address: address.trim(),
            city: city.trim() || null,
          } as any);
        }
      }
    }

    // Create receptionist call record
    const { data: callRecord } = await supabase
      .from('receptionist_calls')
      .insert({
        vapi_call_id: `sarah-${callId}`,
        phone: phone,
        customer_name: customerName || null,
        customer_id: customerId,
        address: address || null,
        city: city || null,
        service_needed: serviceNeeded || null,
        transcript: transcript,
        summary: summary || null,
        duration_sec: duration,
        status: 'pending',
        priority: isUrgent ? 'urgent' : 'normal',
        called_at: callTime,
        notes: recordingUrl ? `Recording: ${recordingUrl}` : null,
      } as any)
      .select()
      .single();

    // Create booking request
    await supabase.from('booking_requests').insert({
      service_type: serviceNeeded || 'Phone Inquiry',
      customer_name: customerName || `Caller: ${formatPhone(phone)}`,
      phone: phone,
      address: address || '',
      city: city || '',
      notes: `📞 AI Receptionist (Sarah) Call\n\n${summary ? `Summary: ${summary}\n\n` : ''}${transcript ? `Transcript:\n${transcript}` : ''}`,
      status: 'pending',
      customer_id: customerId,
      source: 'phone' as any,
    } as any);

    const callerSaid = callerUtteranceText(transcript, body.messages);
    let followUp: Awaited<ReturnType<typeof assignReceptionistFollowUp>> = {
      created: false,
      reason: null,
      taskId: null,
      assigneeName: null,
      lane: null,
      dedupeChecked: false,
      customerNotified: false,
    };
    try {
      followUp = await assignReceptionistFollowUp({
        source: 'sarah',
        phone,
        name: customerName,
        serviceNeeded,
        summary,
        callerText: callerSaid,
        transcript,
        address,
        city,
        notes: body.notes,
        urgent: isUrgent,
        booked: /booked/i.test(body.outcome || ''),
        durationSec: duration,
      });
    } catch (taskErr) {
      console.error('[Sarah Webhook] Jobber follow-up failed', taskErr instanceof Error ? taskErr.message : taskErr);
    }

    // Email notification
    const pstTime = new Date(callTime).toLocaleString('en-US', {
      timeZone: 'America/Los_Angeles',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const emailSubject = `📞 Sarah AI: ${customerName || formatPhone(phone)}${isUrgent ? ' ⚠️ URGENT' : ''}`;
    const emailContent = `
New call from Sarah AI Receptionist

CALL DETAILS:
• Time: ${pstTime}
• Duration: ${Math.floor(duration / 60)}m ${duration % 60}s
• Phone: ${formatPhone(phone)}
${customerName ? `• Customer: ${customerName}` : ''}
${address ? `• Address: ${address}${city ? `, ${city}` : ''}` : ''}
${serviceNeeded ? `• Service Needed: ${serviceNeeded}` : ''}
${isUrgent ? '\n⚠️ MARKED AS URGENT\n' : ''}
${recordingUrl ? `\n🎵 Recording: ${recordingUrl}\n` : ''}

SUMMARY:
${summary || 'No summary available'}

TRANSCRIPT:
${transcript || 'No transcript available'}

---
${isNewCustomer ? '⚡ NEW CUSTOMER CREATED' : customerId ? '✓ Existing customer matched' : '⚪ Customer not matched'}
${followUp.created
  ? `Jobber task for ${followUp.assigneeName}. The customer was not texted or emailed.`
  : `No Jobber task (${followUp.reason || 'not created'}).`}

${customerId ? `View Customer: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/customers/${customerId}` : ''}
    `.trim();

    // Send to all office emails
    for (const email of OFFICE_EMAILS) {
      await sendEmail({
        to: email,
        subject: emailSubject,
        html: textToHtml(emailContent),
        text: emailContent,
      });
    }

    console.log(`[Sarah Webhook] Call processed: ${callId} - ${customerName || phone} - Jobber task: ${followUp.created ? followUp.assigneeName : followUp.reason || 'not-created'}`);

    return NextResponse.json({
      ok: true,
      call_id: callId,
      customer_id: customerId,
      is_new_customer: isNewCustomer,
      is_urgent: isUrgent,
      task_created: followUp.created,
      task_id: followUp.taskId,
      task_assignee: followUp.assigneeName,
      task_skipped: followUp.reason,
      customer_notified: followUp.customerNotified,
    });
  } catch (error) {
    console.error('[Sarah Webhook] Error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET for health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'SCWS AI Receptionist - SpeakSarah Integration',
    webhook_url: '/api/receptionist/sarah',
    timestamp: new Date().toISOString(),
    docs: 'POST call data to this endpoint. Fields: caller_phone, caller_name, transcript, summary, service_type, address, city, urgency',
  });
}

function formatPhone(p: string): string {
  if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
  if (p.length === 11 && p[0] === '1') return `(${p.slice(1, 4)}) ${p.slice(4, 7)}-${p.slice(7)}`;
  return p;
}
