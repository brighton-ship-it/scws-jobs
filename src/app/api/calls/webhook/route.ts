import { NextRequest, NextResponse } from 'next/server';

// Tracking number to source mapping
const TRACKING_NUMBERS: Record<string, string> = {
  '+17604630493': 'seo',
  '+17608914264': 'yelp',
  '+17604540365': 'apple_maps',
  '+17603312502': 'google_ads',
  '+17602791262': 'gbp_ramona',
  '+19516510957': 'gbp_anza',
  '+17604937719': 'direct',
  '+18773863995': 'toll_free',
  '+17608237963': 'line_7963',
  '+17604408520': 'main_line',
  '+17607895955': 'ransom_line',
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // Extract Twilio webhook data
    const callSid = formData.get('CallSid') as string;
    const calledNumber = formData.get('Called') as string;
    const callerNumber = formData.get('From') as string;
    const callStatus = formData.get('CallStatus') as string;
    
    // Determine source from tracking number
    const source = TRACKING_NUMBERS[calledNumber] || 'unknown';
    
    // No database write here. The old write targeted public.calls, which no longer exists, so every call
    // logged a PGRST205 error. This line only bridges the caller to Mike; Mike's own webhook
    // (/api/receptionist/webhook) records the call in receptionist_calls, which the dashboard reads.
    console.log(`[calls/webhook] ${callStatus || 'ringing'} ${source} ${callSid || ''}`);

    // Bridge to Mike (AI receptionist, Vapi line). Live routing for any number whose Voice URL is this route.
    const MIKE_VAPI_NUMBER = '+17604915348';

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
    <Number>${MIKE_VAPI_NUMBER}</Number>
  </Dial>
</Response>`;
    
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('Call webhook error:', error);
    // Always return valid TwiML even on error so the caller still reaches Mike.
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
