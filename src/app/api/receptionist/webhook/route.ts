import { handleLookupCustomer } from '@/lib/receptionist/lookup-customer';
import { normalizeBookJobParams, normalizeCheckScheduleParams } from '@/lib/receptionist/tool-params';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import { notifyNewCall } from '@/lib/messaging/discord';
import { notifyCall } from '@/lib/notifications';
import { handleSendPayEmail, handleSendPayLink, paymentHostForLog } from '@/lib/receptionist/pay-link';
import { authorizeVapiWebhook } from '@/lib/receptionist/vapi-webhook-auth';
import { handleCheckSchedule } from '@/lib/receptionist/check-schedule';
import { handleBookServiceCall } from '@/lib/receptionist/book-service-call';
import { buildCallEmail, extractCallOutcome } from '@/lib/receptionist/call-email';
import { diversionNumbers, jobberClientLine, leadSourceLine, resolveLeadSource, vapiAnsweredNumber, type RecordingHint } from '@/lib/receptionist/lead-source';
import { formatDurationLabel, resolveCallDurationSec } from '@/lib/receptionist/call-duration';
import { isCallerUrgent } from '@/lib/receptionist/caller-urgency';
import { getBusinessHours } from '@/lib/receptionist/business-hours';
import { checkServiceArea, serviceAreaLocationFromParams } from '@/lib/receptionist/service-area';
import { callCustomerPhone, parseVapiServerTools, vapiCallId, vapiToolHttpBody } from '@/lib/receptionist/vapi-tools';
import { isOwnNumber } from '@/lib/ads/real-leads';
import { isReceptionistTestCaller, testToolResult } from '@/lib/receptionist/test-call';
import { businessCallerId, phoneForCallbackTool } from '@/lib/receptionist/mike-callback';
import { linkAttemptVapi, overrideCallbackCaller, updateAttemptOutcome } from '@/lib/receptionist/mike-callback-run';
import {
  OFFICE_ALERT_DEDUPE_MS,
  OFFICE_ALERT_EMAILS,
  type OfficeAlertPatch,
  type OfficeAlertRow,
  type OfficeRequestIdentity,
  isMissingOfficeDedupeColumnError,
  isOfficeAlertTool,
  omitOfficeDedupeColumns,
  resolveOfficeToolBatch,
} from '@/lib/receptionist/office-callback';
import { BOOK_TOOL_NAMES, checkBookingConsent, consentTurnsFromVapiBody } from '@/lib/receptionist/booking-consent';
import { buildMissedServiceFlag, isMissingNeedsCallbackColumn } from '@/lib/receptionist/missed-service-flag';
import { callerTownContext, rememberLookupCaller, withTownGuard } from '@/lib/receptionist/town-guard';

const OFFICE_EMAILS = OFFICE_ALERT_EMAILS;

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
 * Creates leads/requests in the CRM, handles function calls
 */
export async function POST(request: NextRequest) {
  const webhookAuth = authorizeVapiWebhook(request.headers, process.env);
  if (!webhookAuth.ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    // Handle different Vapi webhook event types
    const eventType = body.message?.type || body.type || 'end-of-call-report';
    
    // Legacy function-call and current tool-calls (toolCallList) both run tools.
    if (eventType === 'function-call' || eventType === 'tool-calls') {
      return await handleVapiTools(body);
    }
    
    // Only process end-of-call-report events (ignore status-update, hang, etc.)
    if (eventType !== 'end-of-call-report') {
      return NextResponse.json({ ok: true, skipped: true, reason: 'not-end-of-call-report' });
    }

    // Extract call data - handle multiple Vapi payload formats
    // Format 1: body.message.call (older format)
    // Format 2: call data directly in body.message (newer format)
    // Format 3: call data in body directly
    const message = body.message || {};
    const call: VapiCall = message.call || body.call || {
      id: message.callId || body.callId || message.id || body.id,
      customer: message.customer || body.customer,
      transcript: message.transcript || body.transcript,
      startedAt: message.startedAt || body.startedAt,
      endedAt: message.endedAt || body.endedAt,
      analysis: message.analysis || body.analysis,
      status: message.status || body.status || 'ended',
    };
    
    // Analysis might be at different levels
    const analysis = message.analysis || call.analysis || body.analysis || {};
    
    // Extract phone early since we need it for call ID generation
    let phone = (call.customer?.number || message.customer?.number || body.customer?.number || '').replace(/\D/g, '');
    
    // Try to get call ID from multiple places, generate one if not found
    const callId = call.id || message.callId || message.call?.id || body.callId || body.call?.id || 
      `generated-${message.timestamp || Date.now()}-${phone.slice(-4) || 'unknown'}`;
    call.id = callId;
    
    // Log for debugging
    console.log('[Receptionist] Webhook received:', JSON.stringify({
      hasMessage: !!body.message,
      messageKeys: Object.keys(message),
      callId: call.id,
      phone,
      hasTranscript: !!call.transcript,
    }));

    const supabase = createServiceClient();
    let callbackAttempt: { id: string } | null = null;
    try {
      const match = await overrideCallbackCaller(supabase as any, phone, call.id);
      if (match) {
        callbackAttempt = { id: match.id };
        const rewritten = match.phone.replace(/\D/g, '');
        if (rewritten.length >= 10) phone = rewritten.slice(-10);
        await linkAttemptVapi(supabase as any, match.id, call.id);
      }
    } catch (callbackErr) {
      console.error('[mike-callback] caller match failed', callbackErr instanceof Error ? callbackErr.message : callbackErr);
    }
    // Vapi sees the tracking number as the caller on a callback bridge. If that
    // number does not match exactly one in-flight callback, do not file a lead for it.
    if (!callbackAttempt && isReceptionistTestCaller(phone)) {
      // Our own test line: no lead, no task, no office email, no Discord, no dashboard row.
      console.log(`[Receptionist] Test call ${call.id} from a test line; not filing a lead`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'test-call' });
    }
    if (!callbackAttempt && businessCallerId(phone)) {
      console.error('[mike-callback] no unique in-flight callback for this business caller ID; not filing a lead');
      return NextResponse.json({ ok: true, skipped: true, reason: 'callback-unmatched' });
    }
    
    // Check if we already processed this call - use upsert pattern to prevent race conditions
    // First, try to claim this call by inserting a placeholder record
    const { data: claimResult, error: claimError } = await supabase
      .from('receptionist_calls')
      .upsert(
        { 
          vapi_call_id: call.id, 
          phone: phone || 'pending',
          status: 'processing',
          called_at: new Date().toISOString()
        },
        { 
          onConflict: 'vapi_call_id',
          ignoreDuplicates: true  // Returns null if already exists
        }
      )
      .select('id, status')
      .single();
    
    // If we didn't get a result, the record already existed (another request got it first)
    if (!claimResult || claimError) {
      console.log(`[Receptionist] Call ${call.id} already being processed, skipping`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'already-processing' });
    }
    
    // If status is not 'processing', this call was already fully processed
    if (claimResult.status !== 'processing') {
      return NextResponse.json({ ok: true, skipped: true, reason: 'already-processed' });
    }
    
    // Double-check: query to see if this call already has email_sent status
    const { data: existingCall } = await supabase
      .from('receptionist_calls')
      .select('status')
      .eq('vapi_call_id', call.id)
      .eq('status', 'completed')
      .single();
    if (existingCall) {
      console.log(`[Receptionist] Call ${call.id} already completed, skipping duplicate`);
      return NextResponse.json({ ok: true, skipped: true, reason: 'already-completed' });
    }
    
    const callRecordId = claimResult.id;

    // Transcript might be in multiple places
    const artifact = message.artifact || body.artifact || {};
    const transcript = message.transcript || call.transcript || body.transcript ||
      artifact.transcript ||
      artifact.messages?.map((m: any) => `${m.role}: ${m.content || m.message || ''}`).join('\n') ||
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

    // Vapi sends fractional durationSeconds (e.g. 118.54). duration_sec is an integer.
    const startedAt = body.message?.startedAt || call.startedAt || body.startedAt;
    const startTime = startedAt ? new Date(startedAt) : new Date();
    const durationSec = resolveCallDurationSec(body);

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
      } else if (customerName && !callbackAttempt) {
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

    // Urgency keywords come from the caller's lines, not Sarah's questions.
    const rawMessages = artifact.messages || message.messages || call.messages || [];
    const isUrgent = isCallerUrgent({
      structuredUrgency: urgency,
      transcript,
      messages: rawMessages,
    });

    // Log only. Does not text, dial, read the callback flag, or call the callback cron.
    const missedService = buildMissedServiceFlag({
      messages: rawMessages,
      serviceNeeded,
      summary,
      transcript,
      isTestCall: isReceptionistTestCaller(phone),
      callbackAttempt: Boolean(callbackAttempt),
      vapiCallId: call.id,
      phone,
    });
    if (missedService.flag) {
      console.log('[Receptionist] auto-flag needs-callback', missedService.log);
    }

    const updateReceptionistCall = async (patch: Record<string, unknown>, selectRow: boolean) => {
      const run = (body: Record<string, unknown>) => {
        const query = supabase.from('receptionist_calls').update(body as any).eq('id', callRecordId);
        return selectRow ? query.select().single() : query;
      };
      let result = await run(patch);
      if (
        result.error &&
        Object.prototype.hasOwnProperty.call(patch, 'needs_callback') &&
        isMissingNeedsCallbackColumn(result.error)
      ) {
        console.warn(
          '[Receptionist] receptionist_calls.needs_callback is missing. Apply supabase/migrations/20261021_receptionist_calls_needs_callback.sql',
        );
        const { needs_callback: _drop, ...rest } = patch;
        result = await run(rest);
      }
      return result;
    };

    // Update the receptionist call record with full details (we created a placeholder above)
    const { error: callError } = await updateReceptionistCall({
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
      ...(missedService.flag ? { notes: missedService.notes, needs_callback: true } : {}),
    }, true);

    if (callError) {
      console.error('Error updating call record:', callError);
      // Don't fail - still try to email
    }

    // Also create a booking request if we have enough info.
    // A callback already has the original missed call. Only a real booking
    // (the book tool) should take that caller off the callback list.
    if (phone.length >= 10 && !callbackAttempt) {
      // Just include summary - full transcript is in receptionist_calls table
      const notesText = summary 
        ? `📞 Mike: ${summary}` 
        : `📞 Call from ${customerName || formatPhone(phone)} - ${serviceNeeded || 'Phone inquiry'}`;
      const bookingNotes = missedService.flag
        ? `${missedService.bookingNotesPrefix}\n${notesText}`
        : notesText;
      
      await supabase.from('booking_requests').insert({
        service_type: missedService.flag ? missedService.serviceType : (serviceNeeded || 'Phone Inquiry'),
        customer_name: customerName || `Caller: ${formatPhone(phone)}`,
        phone: phone,
        address: address || '',
        city: city || '',
        notes: bookingNotes,
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
          direction: callbackAttempt ? 'outbound' : 'inbound',
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
        `Mike received call at ${startTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}`,
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
        .eq('email', 'travis@scwellservice.com')
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

    // Exactly one email per call. Outcome comes from Mike's tool calls on this call.
    const outcome = extractCallOutcome(rawMessages, {
      name: customerName,
      phone,
      address,
      city,
      issue: serviceNeeded,
    });
    // Backup source: the row Mike's flag/callback tool saved for this call.
    if (outcome.kind === 'none' || (!outcome.booked && !outcome.emergency)) {
      try {
        const { data: toolRows } = await supabase
          .from('booking_requests')
          .select('service_type, notes')
          .eq('vapi_call_id', call.id);
        for (const row of (toolRows || []) as Array<{ service_type?: string | null }>) {
          if (row.service_type === 'Emergency') outcome.emergency = true;
          else if (row.service_type === 'Callback') outcome.callback = true;
        }
        if (!outcome.booked) {
          outcome.kind = outcome.emergency ? 'emergency' : outcome.callback ? 'callback' : 'none';
        }
      } catch (rowErr) {
        console.log('[Receptionist] Tool-row outcome lookup skipped:', rowErr);
      }
    }
    // Where the lead came from: the dialed number (SIP Diversion) plus any Twilio
    // tracking-line recording for this caller just before Mike answered.
    let leadLine: string | null = null;
    try {
      const vapiCall = message.call || body.call || call;
      let recordings: RecordingHint[] = [];
      if (!callbackAttempt && phone.length >= 10) {
        const t = startTime.getTime();
        const { data: recRows } = await (supabase as any)
          .from('inbound_call_recordings')
          .select('tracking_number, source, started_at')
          .eq('caller_number', `+1${phone.slice(-10)}`)
          .gte('started_at', new Date(t - 10 * 60_000).toISOString())
          .lte('started_at', new Date(t + 2 * 60_000).toISOString())
          .order('started_at', { ascending: false })
          .limit(5);
        recordings = (recRows || []) as RecordingHint[];
      }
      leadLine = callbackAttempt
        ? 'Lead source: Mike callback (outbound call)'
        : leadSourceLine(resolveLeadSource({ diversions: diversionNumbers(vapiCall), recordings, answered: vapiAnsweredNumber(vapiCall) }));
    } catch (leadErr) {
      console.log('[Receptionist] Lead source lookup skipped:', leadErr);
      leadLine = 'Lead source: Unknown (lookup failed)';
    }
    const built = buildCallEmail({
      outcome,
      leadSourceLine: leadLine,
      clientLine: jobberClientLine(rawMessages),
      fallbackName: customerName || formatPhone(phone),
      fallbackPhone: phone,
      fallbackAddress: address,
      fallbackIssue: serviceNeeded,
      urgent: isUrgent,
      autoFlagged: missedService.flag,
      summary,
      transcript,
      timeLabel: pstTime,
      durationLabel: formatDurationLabel(durationSec),
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app',
      customerId,
    });
    const emailSubject = built.subject;
    const emailContent = built.text;

    // Send to all office emails as separate messages (no CC)
    let emailResult: { success?: boolean; error?: string } = {};
    for (const email of OFFICE_EMAILS) {
      emailResult = await sendEmail({
        to: email,
        subject: emailSubject,
        html: textToHtml(emailContent),
        text: emailContent,
      });
      console.log(`[Receptionist] Email to ${email}:`, emailResult);
    }

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

    // A flagged service hang-up stays pending so the office still sees it. The note is the only action.
    await updateReceptionistCall(
      {
        status: missedService.flag ? 'pending' : 'completed',
        email_sent: emailResult?.success || false,
      },
      false,
    );

    console.log(`[Receptionist] Call processed: ${call.id} - ${customerName || phone} - Task: ${taskCreated}`);

    if (callbackAttempt) {
      try {
        await updateAttemptOutcome(
          supabase as any,
          callbackAttempt.id,
          outcome.booked ? 'booked' : 'reached',
          null,
          outcome.booked ? ['dialing', 'reached'] : ['dialing'],
        );
      } catch (callbackErr) {
        console.error('[mike-callback] outcome update failed', callbackErr instanceof Error ? callbackErr.message : callbackErr);
      }
    }

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
  } catch (error: any) {
    console.error('Receptionist webhook error:', error);
    return NextResponse.json(
      { ok: false, error: 'Internal server error', details: error?.message || String(error) },
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

function redactToolLog(params: Record<string, unknown>): Record<string, unknown> {
  const logParams = { ...params };
  if (logParams.paymentUrl) {
    logParams.paymentUrl = paymentHostForLog(String(logParams.paymentUrl));
  }
  for (const key of ['to', 'phone', 'from', 'customerPhone']) {
    if (logParams[key] == null || logParams[key] === '') continue;
    const digits = String(logParams[key]).replace(/\D/g, '');
    logParams[key] = digits ? `***${digits.slice(-4)}` : '[redacted]';
  }
  return logParams;
}

/**
 * Handle Vapi tool calls.
 * function-call returns { result }. tool-calls returns { results: [{ toolCallId, result }] }.
 * Callback and emergency tools email the office. They never text the customer.
 */
async function handleVapiTools(body: any) {
  const parsed = parseVapiServerTools(body);
  if (parsed.mode === 'none') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no-tool-calls' });
  }

  const calls = parsed.mode === 'function-call' ? [parsed.call] : parsed.calls;
  let callPhone = callCustomerPhone(body);
  const callId = vapiCallId(body) || null;
  let testCall = isReceptionistTestCaller(callPhone);
  try {
    const match = await overrideCallbackCaller(createServiceClient() as any, callPhone, callId || '');
    if (match) { callPhone = match.phone; testCall = false; }
    else if (isOwnNumber(callPhone)) callPhone = '';
  } catch (callbackErr) {
    console.error('[mike-callback] tool caller match failed', callbackErr instanceof Error ? callbackErr.message : callbackErr);
    if (isOwnNumber(callPhone)) callPhone = '';
  }
  const executed: Array<{ id: string | null; body: { result: unknown } } | undefined> = new Array(calls.length);
  const consentTurns = consentTurnsFromVapiBody(body);
  const officeIndexes: number[] = [];

  for (let i = 0; i < calls.length; i++) {
    const call = calls[i];
    const params = call.params || {};
    console.log(`[Receptionist] Function call: ${call.name}${testCall ? ' (test call)' : ''}`, JSON.stringify(redactToolLog(params)));
    // Consent gate runs before test simulation so test calls exercise it too.
    if (BOOK_TOOL_NAMES.has(call.name)) {
      const consent = checkBookingConsent(params, consentTurns);
      if (!consent.ok) {
        console.warn(`[Receptionist] book refused (${consent.code})${testCall ? ' (test call)' : ''}`);
        executed[i] = { id: call.id, body: { result: consent.result } };
        continue;
      }
    }
    // Test line: side-effect tools are simulated (no Jobber, no booking row, no alert).
    const simulated = testCall ? testToolResult(call.name, params) : null;
    if (simulated) { executed[i] = { id: call.id, body: simulated }; continue; }
    if (isOfficeAlertTool(call.name)) officeIndexes.push(i);
  }

  if (officeIndexes.length > 0) {
    const officeCalls = officeIndexes.map((index) => calls[index]);
    const identity: OfficeRequestIdentity = {
      vapiCallId: callId,
      toolCallId: officeCalls.map((call) => call.id).filter((id): id is string => Boolean(id)).join('|') || null,
    };
    try {
      const outcomes = await resolveOfficeToolBatch(officeCalls, {
        callPhone,
        vapiCallId: callId,
        deps: {
          insertBooking: insertOfficeBooking,
          updateBooking: updateOfficeBooking,
          loadCandidates: () => loadOfficeAlertCandidates(identity),
          // One email per call: the end-of-call report sends it, with the final
          // outcome. The booking_requests row saved here is the fallback source
          // (see /api/cron/receptionist-alert-fallback).
          sendAlert: async () => ({ success: true }),
        },
      });
      officeIndexes.forEach((index, offset) => {
        executed[index] = outcomes[offset];
      });
    } catch (error: any) {
      console.error('Office alert batch failed:', error);
      for (const index of officeIndexes) {
        executed[index] = {
          id: calls[index].id,
          body: {
            result: { error: 'Failed to process request', message: error?.message || 'Unknown error' },
          },
        };
      }
    }
  }

  for (let i = 0; i < calls.length; i++) {
    if (executed[i]) continue;
    const call = calls[i];
    const params = call.params || {};
    const phone = phoneForCallbackTool(params.phone, callPhone);
    try {
      executed[i] = { id: call.id, body: await executeTool(call.name, params, phone, callId) };
    } catch (error: any) {
      console.error(`Function call error (${call.name}):`, error);
      executed[i] = {
        id: call.id,
        body: {
          result: { error: 'Failed to process request', message: error?.message || 'Unknown error' },
        },
      };
    }
  }

  return NextResponse.json(vapiToolHttpBody(
    parsed,
    executed as Array<{ id: string | null; body: { result: unknown } }>,
  ));
}

async function executeTool(name: string, params: any, phone: string, callId: string | null = null) {
  switch (name) {
    case 'lookupCustomer': {
      const looked = await handleLookupCustomer(phone || params.phone);
      rememberLookupCaller(callId, looked?.result);
      return looked;
    }

    case 'checkSchedule':
      // Confirmation lock: canConfirm only when Jobber returned a visit.
      // With city/intent=book, also returns real Jobber openSlots (never invented).
      params = normalizeCheckScheduleParams(params);
      return withTownGuard('checkSchedule', params, callerTownContext(callId, params), () => handleCheckSchedule({
        phone: phone || params.phone,
        city: params.city,
        address: params.address,
        zip: params.zip || params.postalCode,
        postalCode: params.postalCode,
        intent: params.intent,
        urgency: params.urgency,
        needNow: params.needNow,
        thisWeekend: params.thisWeekend,
        notes: params.notes,
      }));

    case 'bookJob':
    case 'book_job':
    case 'bookServiceCall':
      params = normalizeBookJobParams(params, phone);
      return withTownGuard(name, params, callerTownContext(callId, params), () => handleBookServiceCall(
        {
          phone: phone || params.phone,
          name: params.name || params.callerName || params.customerName,
          firstName: params.firstName,
          lastName: params.lastName,
          email: params.email,
          address: params.address,
          city: params.city,
          zip: params.zip || params.postalCode,
          postalCode: params.postalCode,
          startAt: params.startAt,
          preferredDate: params.preferredDate,
          preferredTime: params.preferredTime,
          urgency: params.urgency,
          needNow: params.needNow,
          thisWeekend: params.thisWeekend,
          notes: params.notes || params.reason,
          repeatVisit: params.repeatVisit,
          differentProblem: params.differentProblem ?? params.secondJob,
        },
        {
          // The weekend-emergency flag is folded into the end-of-call email
          // (bookServiceCall's weekendEmergency result). No mid-call email.
          notifyOffice: async (flag) => {
            console.log(`[Receptionist] Office flag deferred to end-of-call email: ${flag.kind}`);
          },
        }
      ));

    case 'getServiceInfo':
      return handleGetServiceInfo(params.serviceType || '');

    case 'checkServiceArea':
      return withTownGuard('checkServiceArea', params, callerTownContext(callId, params), () =>
        checkServiceArea(serviceAreaLocationFromParams(params)),
      );

    case 'getBusinessHours':
      return getBusinessHours();

    case 'sendPayLink':
      return handleSendPayLink(params);

    case 'sendPayEmail':
      return handleSendPayEmail(params, {
        sendEmailFn: sendEmail,
        textToHtmlFn: textToHtml,
      });

    default:
      console.warn(`Unknown function: ${name}`);
      return { result: { error: `Unknown function: ${name}` } };
  }
}

const OFFICE_ALERT_COLUMNS =
  'id, service_type, notes, phone, address, city, customer_name, email, vapi_call_id, tool_call_id, created_at';
const OFFICE_ALERT_COLUMNS_LEGACY =
  'id, service_type, notes, phone, address, city, customer_name, email, created_at';

const MISSING_DEDUPE_COLUMNS_WARNING =
  '[Receptionist] booking_requests is missing vapi_call_id/tool_call_id. Same-phone dedupe still applies for 10 minutes. Apply supabase/migrations/20261007_booking_requests_vapi_call_dedupe.sql in the Supabase SQL editor.';

function mapOfficeAlertRow(row: Record<string, unknown>): OfficeAlertRow {
  return {
    id: String(row.id),
    serviceType: String(row.service_type || ''),
    notes: String(row.notes || ''),
    phone: String(row.phone || ''),
    address: String(row.address || ''),
    city: String(row.city || ''),
    customerName: String(row.customer_name || ''),
    email: typeof row.email === 'string' ? row.email : null,
    vapiCallId: typeof row.vapi_call_id === 'string' ? row.vapi_call_id : null,
    toolCallId: typeof row.tool_call_id === 'string' ? row.tool_call_id : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
  };
}

function rememberOfficeRows(target: Map<string, OfficeAlertRow>, data: unknown) {
  if (!Array.isArray(data)) return;
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const mapped = mapOfficeAlertRow(row as Record<string, unknown>);
    if (mapped.id) target.set(mapped.id, mapped);
  }
}

async function loadOfficeAlertCandidates(identity: OfficeRequestIdentity): Promise<OfficeAlertRow[]> {
  const supabase = createServiceClient();
  const sinceIso = new Date(Date.now() - OFFICE_ALERT_DEDUPE_MS).toISOString();
  const found = new Map<string, OfficeAlertRow>();

  const recent = await supabase
    .from('booking_requests')
    .select(OFFICE_ALERT_COLUMNS)
    .in('service_type', ['Emergency', 'Callback'])
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(50);

  if (recent.error && isMissingOfficeDedupeColumnError(recent.error)) {
    console.warn(MISSING_DEDUPE_COLUMNS_WARNING);
    const legacy = await supabase
      .from('booking_requests')
      .select(OFFICE_ALERT_COLUMNS_LEGACY)
      .in('service_type', ['Emergency', 'Callback'])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(50);
    if (legacy.error) console.error('[Receptionist] Office alert lookup failed:', legacy.error);
    rememberOfficeRows(found, legacy.data);
    return [...found.values()];
  }

  if (recent.error) {
    console.error('[Receptionist] Office alert lookup failed:', recent.error);
  } else {
    rememberOfficeRows(found, recent.data);
  }

  if (identity.vapiCallId) {
    const byCall = await supabase
      .from('booking_requests')
      .select(OFFICE_ALERT_COLUMNS)
      .in('service_type', ['Emergency', 'Callback'])
      .eq('vapi_call_id', identity.vapiCallId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (byCall.error) console.error('[Receptionist] Office alert call lookup failed:', byCall.error);
    else rememberOfficeRows(found, byCall.data);
  }

  for (const toolId of (identity.toolCallId || '').split('|').map((id) => id.trim()).filter(Boolean)) {
    const exact = await supabase
      .from('booking_requests')
      .select(OFFICE_ALERT_COLUMNS)
      .in('service_type', ['Emergency', 'Callback'])
      .eq('tool_call_id', toolId)
      .limit(5);
    if (!exact.error) rememberOfficeRows(found, exact.data);

    const pattern = `%${toolId.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const combined = await supabase
      .from('booking_requests')
      .select(OFFICE_ALERT_COLUMNS)
      .in('service_type', ['Emergency', 'Callback'])
      .like('tool_call_id', pattern)
      .limit(10);
    if (!combined.error) rememberOfficeRows(found, combined.data);
  }

  return [...found.values()];
}

async function insertOfficeBooking(row: {
  service_type: string;
  customer_name: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  notes: string;
  status: 'pending';
  source: 'phone';
  vapi_call_id?: string | null;
  tool_call_id?: string | null;
}) {
  const supabase = createServiceClient();
  let { data, error } = await supabase
    .from('booking_requests')
    .insert(row as any)
    .select('id')
    .single();
  if (error && isMissingOfficeDedupeColumnError(error)) {
    console.warn(MISSING_DEDUPE_COLUMNS_WARNING);
    const retry = await supabase
      .from('booking_requests')
      .insert(omitOfficeDedupeColumns(row) as any)
      .select('id')
      .single();
    data = retry.data;
    error = retry.error;
  }
  const inserted = data as { id?: string } | null;
  return { id: inserted?.id ?? null, error: error?.message ?? null };
}

async function updateOfficeBooking(id: string, patch: OfficeAlertPatch) {
  const supabase = createServiceClient();
  const full: Record<string, unknown> = {
    notes: patch.notes,
    service_type: patch.serviceType,
    address: patch.address,
    city: patch.city,
    customer_name: patch.customerName.slice(0, 255),
    email: patch.email,
  };
  if (patch.vapiCallId) full.vapi_call_id = patch.vapiCallId;
  if (patch.toolCallId) full.tool_call_id = patch.toolCallId;

  let { error } = await supabase.from('booking_requests').update(full).eq('id', id);
  if (error && isMissingOfficeDedupeColumnError(error)) {
    console.warn(MISSING_DEDUPE_COLUMNS_WARNING);
    const retry = await supabase
      .from('booking_requests')
      .update(omitOfficeDedupeColumns(full))
      .eq('id', id);
    error = retry.error;
  }
  return { error: error?.message ?? null };
}

/**
 * Look up customer in Jobber by phone
 */
/**
 * Get service info and pricing
 */
function handleGetServiceInfo(serviceType: string) {
  const services: Record<string, any> = {
    'well drilling': { description: 'New well drilling', priceRange: '$15,000 - $50,000+', note: 'Price depends on depth and conditions' },
    'pump repair': { description: 'Well pump repair', priceRange: '$300 - $3,000', note: 'Depends on the issue' },
    'pump replacement': { description: 'Well pump replacement', priceRange: '$2,500 - $8,000', note: 'Includes pump and labor' },
    'pressure tank': { description: 'Pressure tank service/replacement', priceRange: '$400 - $1,500', note: '' },
    'water testing': { description: 'Well water testing', priceRange: '$150 - $400', note: 'Different tests available' },
    'well rehabilitation': { description: 'Well rehabilitation/cleaning', priceRange: '$2,000 - $10,000', note: '' },
  };
  
  const key = Object.keys(services).find(k => serviceType.toLowerCase().includes(k));
  if (key) {
    return { result: services[key] };
  }
  
  return {
    result: {
      description: 'Various well and pump services',
      priceRange: 'Varies by service',
      note: "I can have a technician call you back with specific pricing for your situation."
    }
  };
}

