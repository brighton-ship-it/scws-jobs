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
    
    // Upsert call record
    const { data, error } = await supabase
      .from('tracked_calls')
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
      });
    
    if (error) {
      console.error('Error logging call:', error);
    } else {
      console.log(`Logged call from ${source}: ${callerNumber}`);
    }
    
    // Forward call to Brighton first, then Sarah if no answer
    const BRIGHTON_NUMBER = '+17604408520';
    const SARAH_VAPI_NUMBER = '+17604915348';
    const statusUrl = 'https://scws-jobs.vercel.app/api/calls/status';
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerNumber}" timeout="20" action="${statusUrl}">
    <Number>${BRIGHTON_NUMBER}</Number>
  </Dial>
</Response>`;
    
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('Call webhook error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
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
