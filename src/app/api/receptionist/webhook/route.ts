import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import { notifyNewCall } from '@/lib/messaging/discord';
import { notifyCall } from '@/lib/notifications';

const OFFICE_EMAIL = 'brighton@scwellservice.com';
const WEBHOOK_SECRET = process.env.VAPI_WEBHOOK_SECRET || 'scws-vapi-2024';

interface VapiMessage {
  role: string;
  content: string;
}

interface VapiCall {
  id: string;
  status: string;
  startedAt: string;
  endedAt?: string;
  customer?: {
    number?: string;
    name?: string;
  };
  transcript?: string;
  messages?: VapiMessage[];
  analysis?: {
    summary?: string;
    structuredData?: {
      customerName?: string;
      address?: string;
      city?: string;
      serviceNeeded?: string;
      urgency?: string;
      notes?: string;
    };
  };
}

/**
 * POST /api/receptionist/webhook - Receive AI receptionist call data from Vapi
 * Creates leads/requests in the CRM
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Handle different Vapi webhook event types
    const eventType = body.message?.type || body.type || 'end-of-call-report';
    
    // We only care about completed calls
    if (eventType !== 'end-of-call-report' && body.status !== 'ended') {
      return NextResponse.json({ ok: true, skipped: true, reason: 'not-completed-call' });
    }

    // Extract call data - handle both direct payload and nested message format
    const call: VapiCall = body.message?.call || body.call || body;
    
    // Analysis might be at message level, not call level
    const analysis = body.message?.analysis || call.analysis || body.analysis || {};
    
    // Log for debugging
    console.log('[Receptionist] Webhook received:', JSON.stringify({
      hasMessage: !!body.message,
      hasCall: !!call,
      hasAnalysis: !!analysis,
      callId: call.id,
      analysisKeys: Object.keys(analysis),
    }));
    
    if (!call.id) {
      return NextResponse.json({ ok: false, error: 'No call ID' }, { status: 400 });
    }

    const supabase = createServiceClient();
    
    // Check if we already processed this call
    const { data: existingCalls } = await supabase
      .from('receptionist_calls')
      .select('id')
      .eq('vapi_call_id', call.id)
      .limit(1);
    
    if (existingCalls && existingCalls.length > 0) {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already-processed' });
    }

    // Extract customer info
    const phone = call.customer?.number?.replace(/\D/g, '') || '';
    // Transcript might be at message level too
    const transcript = body.message?.transcript || call.transcript || 
      call.messages?.map(m => `${m.role}: ${m.content}`).join('\n') || 
      'No transcript available';
    const summary = analysis.summary || '';
    const structuredData = analysis.structuredData || {};
    
    // Try to extract customer name from structured data or transcript
    let customerName = structuredData.customerName || call.customer?.name || '';
    let address = structuredData.address || '';
    let city = structuredData.city || '';
    let serviceNeeded = structuredData.serviceNeeded || '';
    let urgency = structuredData.urgency || 'normal';
    let notes = structuredData.notes || '';

    // If no structured data, try to parse from summary
    if (!customerName && summary) {
      // Common patterns: "John Smith called...", "The customer, John Smith, ..."
      const nameMatch = summary.match(/(?:^|\s)([A-Z][a-z]+ [A-Z][a-z]+)(?:\s+called|\s+is\s+calling|\s+inquired)/);
      if (nameMatch) customerName = nameMatch[1];
    }

    // Calculate call duration - prefer direct durationSeconds from Vapi
    const startedAt = body.message?.startedAt || call.startedAt || body.startedAt;
    const endedAt = body.message?.endedAt || call.endedAt || body.endedAt;
    
    // Vapi sends durationSeconds directly in the end-of-call-report
    let durationSec = body.message?.durationSeconds || call.durationSeconds || body.durationSeconds || 0;
    
    // Fallback to timestamp calculation if direct duration not available
    if (!durationSec && startedAt && endedAt) {
      const startTime = new Date(startedAt);
      const endTime = new Date(endedAt);
      durationSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    }

    // Format phone for display
    const formatPhone = (p: string) => {
      if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
      if (p.length === 11 && p[0] === '1') return `(${p.slice(1, 4)}) ${p.slice(4, 7)}-${p.slice(7)}`;
      return p;
    };

    // Find or create customer
    let customerId: string | null = null;
    let isNewCustomer = false;

    if (phone.length >= 10) {
      // Check for existing customer
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id, name')
        .eq('phone', phone)
        .single();

      if (existingCustomer) {
        customerId = (existingCustomer as { id: string }).id;
      } else if (customerName) {
        // Create new customer
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            name: customerName.trim(),
            phone: phone,
            billing_address: address ? `${address}, ${city}`.trim() : null,
            lead_source: 'phone',
            lead_source_detail: 'AI Receptionist (Vapi)',
            lead_stage: 'lead',
          } as any)
          .select()
          .single();

        if (!customerError && newCustomer) {
          customerId = (newCustomer as { id: string }).id;
          isNewCustomer = true;

          // Create property if address provided
          if (address) {
            await supabase.from('properties').insert({
              customer_id: customerId,
              address: address.trim(),
              city: city.trim() || null,
            } as any);
          }
        }
      }
    }

    // Determine priority
    const isUrgent = urgency === 'urgent' || 
      /urgent|emergency|no water|no pressure|flooding/i.test(transcript + summary);

    // Create the receptionist call record
    const { data: callRecord, error: callError } = await supabase
      .from('receptionist_calls')
      .insert({
        vapi_call_id: call.id,
        phone: phone,
        customer_name: customerName || null,
        customer_id: customerId,
        address: address || null,
        city: city || null,
        service_needed: serviceNeeded || null,
        transcript: transcript,
        summary: summary || null,
        duration_sec: durationSec,
        status: 'pending',
        priority: isUrgent ? 'urgent' : 'normal',
        called_at: startedAt || new Date().toISOString(),
      } as any)
      .select()
      .single();

    if (callError) {
      console.error('Error creating call record:', callError);
      // Don't fail - still try to email
    }

    // Also create a booking request if we have enough info
    if (phone.length >= 10) {
      // Just include summary - full transcript is in receptionist_calls table
      const notesText = summary 
        ? `📞 Sarah AI: ${summary}` 
        : `📞 Call from ${customerName || formatPhone(phone)} - ${serviceNeeded || 'Phone inquiry'}`;
      
      await supabase.from('booking_requests').insert({
        service_type: serviceNeeded || 'Phone Inquiry',
        customer_name: customerName || `Caller: ${formatPhone(phone)}`,
        phone: phone,
        address: address || '',
        city: city || '',
        notes: notesText,
        status: 'pending',
        customer_id: customerId,
        source: 'phone' as any,
      } as any);
    }

    // 📞 Add to customer communication timeline (if customer exists)
    if (customerId) {
      try {
        await supabase.from('communications').insert({
          customer_id: customerId,
          type: 'call',
          direction: 'inbound',
          content: summary || `Phone call from ${customerName || formatPhone(phone)}${serviceNeeded ? ` - ${serviceNeeded}` : ''}`,
          duration_seconds: durationSec > 0 ? durationSec : null,
        });
      } catch (commError) {
        console.log('[Receptionist] Communication record skipped:', commError);
      }
    }

    // 🎯 AUTO-CREATE TASK - Assign to Brighton
    let taskCreated = false;
    try {
      const taskTitle = isUrgent 
        ? `⚠️ URGENT: Call back ${customerName || formatPhone(phone)}`
        : `📞 Follow up: ${customerName || formatPhone(phone)}`;
      
      const taskDescription = [
        `Sarah received call at ${startTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`,
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

      // Get Brighton's user ID
      const { data: brightonUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', 'brighton@scwellservice.com')
        .single();

      const { error: taskError } = await supabase.from('tasks').insert({
        title: taskTitle,
        description: taskDescription,
        assigned_to: brightonUser?.id || null,
        due_date: new Date().toISOString().split('T')[0],
        status: 'pending',
        priority: isUrgent ? 'urgent' : 'high',
      });

      taskCreated = !taskError;
      if (taskError) console.log('[Receptionist] Task creation skipped:', taskError.message);
    } catch (taskErr) {
      console.log('[Receptionist] Task creation failed:', taskErr);
    }

    // Send email notification
    const pstTime = startedAt 
      ? startTime.toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        })
      : new Date().toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

    const emailSubject = `📞 Sarah: ${customerName || formatPhone(phone)}${isUrgent ? ' ⚠️ URGENT' : ''}`;
    const emailContent = `
New call received by Sarah (AI Receptionist)

CALL DETAILS:
• Time: ${pstTime}
• Duration: ${durationSec > 0 ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s` : 'Unknown'}
• Phone: ${formatPhone(phone)}
${customerName ? `• Customer: ${customerName}` : ''}
${address ? `• Address: ${address}${city ? `, ${city}` : ''}` : ''}
${serviceNeeded ? `• Service Needed: ${serviceNeeded}` : ''}
${isUrgent ? '\n⚠️ MARKED AS URGENT\n' : ''}

SUMMARY:
${summary || 'No summary available'}

FULL TRANSCRIPT:
${transcript}

---
${isNewCustomer ? '⚡ NEW CUSTOMER CREATED' : customerId ? '✓ Existing customer matched' : '⚪ Customer not matched (incomplete info)'}
${taskCreated ? '✅ Task created and assigned to Brighton' : ''}
${customerId ? `\nView Customer: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/customers/${customerId}` : ''}
View Tasks: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/tasks
View Requests: ${process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app'}/requests
    `.trim();

    const emailResult = await sendEmail({
      to: OFFICE_EMAIL,
      subject: emailSubject,
      html: textToHtml(emailContent),
      text: emailContent,
    });
    console.log(`[Receptionist] Email result:`, emailResult);

    // Discord notification (instant mobile alert)
    await notifyNewCall({
      phone,
      customerName,
      serviceNeeded,
      summary,
      isUrgent,
      customerId,
      isNewCustomer,
    });

    // In-app notification (bell icon)
    await notifyCall({
      phone,
      customerName,
      serviceNeeded,
      isUrgent,
      customerId,
    });

    console.log(`[Receptionist] Call processed: ${call.id} - ${customerName || phone} - Task: ${taskCreated}`);

    return NextResponse.json({
      ok: true,
      call_id: call.id,
      customer_id: customerId,
      is_new_customer: isNewCustomer,
      is_urgent: isUrgent,
      task_created: taskCreated,
      email_sent: emailResult?.success || false,
      email_error: emailResult?.error || null,
    });
  } catch (error) {
    console.error('Receptionist webhook error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET endpoint for health check / verification
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'SCWS AI Receptionist Webhook',
    timestamp: new Date().toISOString(),
  });
}
