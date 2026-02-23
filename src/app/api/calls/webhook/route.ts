import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// Tracking number to source mapping
const TRACKING_NUMBERS: Record<string, string> = {
  '+17604630493': 'seo',
  '+17603312502': 'google_ads',
  '+17602791262': 'gmb',
  '+17604937719': 'direct',
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // Extract Twilio webhook data
    const callSid = formData.get('CallSid') as string;
    const calledNumber = formData.get('Called') as string;
    const callerNumber = formData.get('From') as string;
    const callStatus = formData.get('CallStatus') as string;
    const direction = formData.get('Direction') as string;
    const callerCity = formData.get('CallerCity') as string;
    const callerState = formData.get('CallerState') as string;
    const callerZip = formData.get('CallerZip') as string;
    const duration = formData.get('CallDuration') as string;
    
    // Determine source from tracking number
    const source = TRACKING_NUMBERS[calledNumber] || 'unknown';
    
    // Upsert call record (don't await - fire and forget to avoid blocking)
    supabase
      .from('calls')
      .upsert({
        call_sid: callSid,
        source,
        tracking_number: calledNumber,
        caller_number: callerNumber,
        caller_city: callerCity,
        caller_state: callerState,
        caller_zip: callerZip,
        call_status: callStatus,
        direction: direction || 'inbound',
        duration_seconds: duration ? parseInt(duration) : null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'call_sid',
      })
      .then(({ error }) => {
        if (error) console.error('Error logging call:', error);
        else console.log(`Logged call from ${source}: ${callerNumber}`);
      });
    
    // Forward all calls directly to Sarah (AI Receptionist)
    const SARAH_VAPI_NUMBER = '+17604915348';
    
    // Ensure caller ID is properly formatted (E.164)
    // Note: + in URL form data decodes as space, so we handle that
    let formattedCallerId = callerNumber?.trim() || '';
    // Strip non-digits and re-add +
    const digits = formattedCallerId.replace(/\D/g, '');
    formattedCallerId = digits ? `+${digits}` : '';
    // Fallback to tracking number if caller ID is invalid
    if (!formattedCallerId || digits.length < 10) {
      formattedCallerId = calledNumber;
    }
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${formattedCallerId}" timeout="60">
    <Number>${SARAH_VAPI_NUMBER}</Number>
  </Dial>
</Response>`;
    
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('Call webhook error:', error);
    // Always return valid TwiML even on error - forward to Sarah directly
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30">
    <Number>+17604915348</Number>
  </Dial>
</Response>`;
    return new NextResponse(fallbackTwiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

// GET endpoint for testing
export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    service: 'SCWS Call Tracking Webhook',
    tracking_numbers: TRACKING_NUMBERS,
  });
}
