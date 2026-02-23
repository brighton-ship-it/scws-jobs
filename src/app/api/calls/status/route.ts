import { NextRequest, NextResponse } from 'next/server';

// Sarah's Vapi AI Receptionist number
const SARAH_VAPI_NUMBER = '+17604915348';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    // Check if the call was answered
    const dialCallStatus = formData.get('DialCallStatus') as string;
    const callerNumber = formData.get('From') as string;
    
    console.log(`Call status callback: ${dialCallStatus} from ${callerNumber}`);
    
    // If Brighton answered, we're done
    if (dialCallStatus === 'completed' || dialCallStatus === 'answered') {
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      });
    }
    
    // Brighton didn't answer - forward to Sarah
    // Ensure caller ID is properly formatted (+ decodes as space in form data)
    let formattedCallerId = callerNumber?.trim() || '';
    const digits = formattedCallerId.replace(/\D/g, '');
    formattedCallerId = digits.length >= 10 ? `+${digits}` : '';
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${formattedCallerId ? ` callerId="${formattedCallerId}"` : ''} timeout="30">
    <Number>${SARAH_VAPI_NUMBER}</Number>
  </Dial>
</Response>`;
    
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('Call status webhook error:', error);
    // On error, try to forward to Sarah anyway
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30">
    <Number>${SARAH_VAPI_NUMBER}</Number>
  </Dial>
</Response>`;
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}
