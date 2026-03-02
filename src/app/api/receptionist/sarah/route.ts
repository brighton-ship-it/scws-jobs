import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';

const OFFICE_EMAILS = ['brighton@scwellservice.com'];
const WEBHOOK_SECRET = process.env.SARAH_WEBHOOK_SECRET || 'scws-sarah-2024';
const BRIGHTON_USER_ID = process.env.BRIGHTON_USER_ID || null; // Set in env

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
 * Creates leads, tasks, and customer records
 */
export async function POST(request: NextRequest) {
  try {
    // Optional auth header check
    const authHeader = request.headers.get('authorization');
    const providedSecret = authHeader?.replace('Bearer ', '') || 
                          request.headers.get('x-webhook-secret');
    
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

    // 🎯 AUTO-CREATE TASK - Assign to Brighton
    const taskTitle = isUrgent 
      ? `⚠️ URGENT: Call back ${customerName || formatPhone(phone)}`
      : `📞 Follow up: ${customerName || formatPhone(phone)}`;
    
    const taskDescription = [
      `AI Receptionist received call at ${new Date(callTime).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`,
      '',
      `Phone: ${formatPhone(phone)}`,
      customerName ? `Customer: ${customerName}` : '',
      serviceNeeded ? `Service: ${serviceNeeded}` : '',
      address ? `Address: ${address}${city ? `, ${city}` : ''}` : '',
      '',
      summary ? `Summary: ${summary}` : '',
      '',
      customerId ? `Customer: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/customers/${customerId}` : '',
    ].filter(Boolean).join('\n');

    // Get Brighton's user ID if we don't have it hardcoded
    let assigneeId = BRIGHTON_USER_ID;
    if (!assigneeId) {
      const { data: brightonUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', 'brighton@scwellservice.com')
        .single();
      assigneeId = brightonUser?.id || null;
    }

    await supabase.from('tasks').insert({
      title: taskTitle,
      description: taskDescription,
      assigned_to: assigneeId,
      due_date: new Date().toISOString().split('T')[0], // Due today
      status: 'pending',
      priority: isUrgent ? 'urgent' : 'high',
    });

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
✅ Task created and assigned

${customerId ? `View Customer: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/customers/${customerId}` : ''}
View Tasks: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/tasks
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

    console.log(`[Sarah Webhook] Call processed: ${callId} - ${customerName || phone} - Task created`);

    return NextResponse.json({
      ok: true,
      call_id: callId,
      customer_id: customerId,
      is_new_customer: isNewCustomer,
      is_urgent: isUrgent,
      task_created: true,
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
