import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { query } from '@/lib/db';
import { logSMS } from '@/lib/communications';

// Twilio credentials from environment variables
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

export async function POST(request: NextRequest) {
  try {
    // Verify Twilio credentials are configured
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      console.error('[On My Way SMS] Twilio credentials not configured');
      return NextResponse.json(
        { error: 'SMS service not configured. Contact admin.' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { customerName, customerPhone, techName, eta, jobId } = body;

    // Validate required fields
    if (!customerPhone) {
      return NextResponse.json(
        { error: 'Customer phone number is required' },
        { status: 400 }
      );
    }

    // Clean phone number - remove non-digits and ensure US format
    let cleanPhone = customerPhone.replace(/\D/g, '');
    if (cleanPhone.length === 10) {
      cleanPhone = '1' + cleanPhone;
    }
    if (!cleanPhone.startsWith('1')) {
      cleanPhone = '1' + cleanPhone;
    }
    cleanPhone = '+' + cleanPhone;

    // Build the message
    const firstName = customerName?.split(' ')[0] || 'there';
    const techFirstName = techName?.split(' ')[0] || 'Your technician';
    const etaText = eta ? `approximately ${eta} minutes` : 'shortly';
    
    const message = `Hi ${firstName}, this is ${techFirstName} from Southern California Well Service. I'm on my way to your property and should arrive in ${etaText}. Call or text (760) 440-8520 if you need anything.`;

    // Initialize Twilio client
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    // Send the SMS
    const result = await client.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: cleanPhone,
    });

    console.log(`[On My Way SMS] Sent to ${cleanPhone} for job ${jobId}: ${result.sid}`);

    // Auto-log the communication
    if (jobId) {
      try {
        // Get customer_id from job via property
        const jobData = await query<{ customer_id: string }>(`
          SELECT p.customer_id 
          FROM jobs j 
          JOIN properties p ON j.property_id = p.id 
          WHERE j.id = $1
        `, [jobId]);
        
        if (jobData[0]?.customer_id) {
          await logSMS({
            customerId: jobData[0].customer_id,
            jobId,
            message,
            phone: cleanPhone,
            messageId: result.sid,
          });
        }
      } catch (err) {
        console.error('[On My Way SMS] Failed to log communication:', err);
      }
    }

    return NextResponse.json({
      success: true,
      messageId: result.sid,
      to: cleanPhone,
      message: message,
    });

  } catch (error: any) {
    console.error('[On My Way SMS] Error:', error);
    
    // Handle Twilio-specific errors
    if (error.code) {
      return NextResponse.json(
        { error: `Twilio error: ${error.message}`, code: error.code },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: 'Failed to send SMS' },
      { status: 500 }
    );
  }
}
