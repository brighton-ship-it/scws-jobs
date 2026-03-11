import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import { notifyNewCall } from '@/lib/messaging/discord';
import { notifyCall } from '@/lib/notifications';

const OFFICE_EMAILS = ['brighton@scwellservice.com'];
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
 * Creates leads/requests in the CRM, handles function calls
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Handle different Vapi webhook event types
    const eventType = body.message?.type || body.type || 'end-of-call-report';
    
    // Handle function calls
    if (eventType === 'function-call') {
      return await handleFunctionCall(body);
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
    const phone = (call.customer?.number || message.customer?.number || body.customer?.number || '').replace(/\D/g, '');
    
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
      artifact.messages?.map((m: any) => `${m.role}: ${m.content}`).join('\n') ||
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
    
    // Parse start time (used for email/task templates below)
    const startTime = startedAt ? new Date(startedAt) : new Date();
    
    // Fallback to timestamp calculation if direct duration not available
    if (!durationSec && startedAt && endedAt) {
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

    // Update the receptionist call record with full details (we created a placeholder above)
    const { data: callRecord, error: callError } = await supabase
      .from('receptionist_calls')
      .update({
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
      .eq('id', callRecordId)
      .select()
      .single();

    if (callError) {
      console.error('Error updating call record:', callError);
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

    // Send to all office emails (Brighton + Brian)
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

    // Mark as completed to prevent any future duplicate processing
    await supabase
      .from('receptionist_calls')
      .update({ status: 'completed', email_sent: emailResult?.success || false })
      .eq('id', callRecordId);

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

/**
 * Handle Vapi function calls
 */
async function handleFunctionCall(body: any) {
  const functionCall = body.message?.functionCall || body.functionCall;
  const name = functionCall?.name;
  const params = functionCall?.parameters || {};
  const phone = body.message?.call?.customer?.number || params.phone || '';
  
  console.log(`[Receptionist] Function call: ${name}`, JSON.stringify(params));
  
  try {
    switch (name) {
      case 'lookupCustomer':
        return NextResponse.json(await handleLookupCustomer(phone || params.phone));
      
      case 'checkSchedule':
        return NextResponse.json(await handleCheckSchedule(phone || params.phone));
      
      case 'getServiceInfo':
        return NextResponse.json(handleGetServiceInfo(params.serviceType));
      
      case 'checkServiceArea':
        return NextResponse.json(handleCheckServiceArea(params.location));
      
      case 'getBusinessHours':
        return NextResponse.json({
          result: {
            hours: "Monday through Friday, 7 AM to 4 PM",
            emergency: "24/7 emergency service available",
            note: "We're available for emergencies anytime - someone will call back within 15 minutes for urgent issues."
          }
        });
      
      case 'createCallback':
      case 'flagEmergency':
        // These are handled by the main webhook flow when the call ends
        return NextResponse.json({
          result: { success: true, message: "Request noted. I'll make sure this is taken care of." }
        });
      
      default:
        console.warn(`Unknown function: ${name}`);
        return NextResponse.json({ result: { error: `Unknown function: ${name}` } });
    }
  } catch (error: any) {
    console.error(`Function call error (${name}):`, error);
    return NextResponse.json({
      result: { error: 'Failed to process request', message: error?.message || 'Unknown error' }
    });
  }
}

/**
 * Look up customer in Jobber by phone
 */
async function handleLookupCustomer(phone: string) {
  const normalized = phone.replace(/\D/g, '').slice(-10);
  const searchTerm = normalized.slice(-7);
  
  const response = await fetch('https://api.getjobber.com/api/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.JOBBER_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': '2026-02-17'
    },
    body: JSON.stringify({
      query: `
        query SearchClients($searchTerm: String!) {
          clients(searchTerm: $searchTerm, first: 5) {
            nodes {
              id
              name
              phones { number }
            }
          }
        }
      `,
      variables: { searchTerm }
    })
  });
  
  const data = await response.json();
  const clients = data?.data?.clients?.nodes || [];
  
  // Find exact phone match
  for (const client of clients) {
    for (const phoneObj of client.phones || []) {
      const clientPhone = phoneObj.number.replace(/\D/g, '').slice(-10);
      if (clientPhone === normalized) {
        return {
          result: {
            found: true,
            customerName: client.name,
            message: `Welcome back, ${client.name}! I have your account pulled up. How can I help you today?`
          }
        };
      }
    }
  }
  
  return {
    result: {
      found: false,
      message: "I don't see this number in our system yet - no problem! Can I get your name?"
    }
  };
}

/**
 * Check customer's scheduled appointments
 */
async function handleCheckSchedule(phone: string) {
  const normalized = phone.replace(/\D/g, '').slice(-10);
  const searchTerm = normalized.slice(-7);
  
  // First find the client
  const clientResponse = await fetch('https://api.getjobber.com/api/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.JOBBER_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': '2026-02-17'
    },
    body: JSON.stringify({
      query: `
        query SearchClients($searchTerm: String!) {
          clients(searchTerm: $searchTerm, first: 5) {
            nodes {
              id
              name
              phones { number }
            }
          }
        }
      `,
      variables: { searchTerm }
    })
  });
  
  const clientData = await clientResponse.json();
  const clients = clientData?.data?.clients?.nodes || [];
  
  // Find exact match
  let clientId = null;
  let clientName = null;
  for (const client of clients) {
    for (const phoneObj of client.phones || []) {
      const clientPhone = phoneObj.number.replace(/\D/g, '').slice(-10);
      if (clientPhone === normalized) {
        clientId = client.id;
        clientName = client.name;
        break;
      }
    }
    if (clientId) break;
  }
  
  if (!clientId) {
    return {
      result: {
        found: false,
        hasAppointments: false,
        message: "I don't see an account with this phone number in our system. Would you like me to take down your information and have someone call you back to schedule an appointment?"
      }
    };
  }
  
  // Get their scheduled visits
  const scheduleResponse = await fetch('https://api.getjobber.com/api/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.JOBBER_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': '2026-02-17'
    },
    body: JSON.stringify({
      query: `
        query GetClientJobs($clientId: EncodedId!) {
          client(id: $clientId) {
            jobs(first: 5) {
              nodes {
                title
                visits(first: 3) {
                  nodes {
                    startAt
                  }
                }
              }
            }
          }
        }
      `,
      variables: { clientId }
    })
  });
  
  const scheduleData = await scheduleResponse.json();
  const jobs = scheduleData?.data?.client?.jobs?.nodes || [];
  
  // Collect upcoming visits
  const visits: any[] = [];
  for (const job of jobs) {
    for (const visit of job.visits?.nodes || []) {
      if (visit.startAt) {
        visits.push({
          date: visit.startAt,
          service: job.title
        });
      }
    }
  }
  
  // Sort by date
  visits.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  
  // Filter to future only
  const now = new Date();
  const upcoming = visits.filter(v => new Date(v.date) > now);
  
  if (upcoming.length === 0) {
    return {
      result: {
        found: true,
        customerName: clientName,
        hasAppointments: false,
        message: `I found your account, ${clientName}, but I don't see any upcoming appointments scheduled. Would you like me to create a callback request to get you scheduled?`
      }
    };
  }
  
  // Format the first appointment
  const first = upcoming[0];
  const date = new Date(first.date);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Los_Angeles' });
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
  
  let message = `Yes! I see you're scheduled for ${dateStr} at ${timeStr} for ${first.service}.`;
  if (upcoming.length > 1) {
    message += ` You also have ${upcoming.length - 1} more appointment${upcoming.length > 2 ? 's' : ''} coming up.`;
  }
  
  return {
    result: {
      found: true,
      customerName: clientName,
      hasAppointments: true,
      appointments: upcoming.slice(0, 3),
      message
    }
  };
}

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

/**
 * Check if location is in service area
 */
function handleCheckServiceArea(location: string) {
  const loc = location.toLowerCase();
  
  const sdCounty = ['san diego', 'ramona', 'valley center', 'escondido', 'poway', 'julian', 'fallbrook', 'bonsall', 'alpine', 'lakeside', 'el cajon', 'santee', 'jamul', 'descanso', 'pine valley', 'campo', 'borrego springs', 'warner springs', 'santa ysabel', 'pauma valley'];
  const riversideCounty = ['riverside', 'anza', 'temecula', 'murrieta', 'hemet', 'menifee', 'winchester', 'idyllwild', 'aguanga'];
  const sbCounty = ['san bernardino', 'yucaipa', 'redlands', 'big bear', 'highland', 'victorville', 'hesperia', 'apple valley', 'crestline', 'lake arrowhead', 'running springs'];
  
  const allAreas = [...sdCounty, ...riversideCounty, ...sbCounty];
  const inArea = allAreas.some(area => loc.includes(area));
  
  if (inArea) {
    return {
      result: {
        inServiceArea: true,
        message: `Yes, we service ${location}! We'd be happy to help you.`
      }
    };
  }
  
  // Check for county names
  if (loc.includes('san diego county') || loc.includes('riverside county') || loc.includes('san bernardino county')) {
    return {
      result: {
        inServiceArea: true,
        message: "Yes, we service that area! We cover San Diego, Riverside, and San Bernardino counties."
      }
    };
  }
  
  return {
    result: {
      inServiceArea: false,
      message: "That location might be outside our usual service area, but let me take your information. If we can't help, we might be able to recommend someone who can."
    }
  };
}
