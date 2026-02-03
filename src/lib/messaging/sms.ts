import twilio from 'twilio';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

interface SendSMSOptions {
  to: string;
  message: string;
}

interface SendSMSResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Clean and format a phone number for Twilio
 */
export function formatPhoneNumber(phone: string): string {
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length === 10) {
    cleanPhone = '1' + cleanPhone;
  }
  if (!cleanPhone.startsWith('1')) {
    cleanPhone = '1' + cleanPhone;
  }
  return '+' + cleanPhone;
}

/**
 * Check if Twilio is configured
 */
export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
}

/**
 * Send an SMS via Twilio
 */
export async function sendSMS({ to, message }: SendSMSOptions): Promise<SendSMSResult> {
  if (!isTwilioConfigured()) {
    console.error('[SMS] Twilio credentials not configured');
    return {
      success: false,
      error: 'Twilio not configured',
    };
  }

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const formattedPhone = formatPhoneNumber(to);

    const result = await client.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: formattedPhone,
    });

    console.log(`[SMS] Sent to ${formattedPhone}: ${result.sid}`);

    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error: any) {
    console.error('[SMS] Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to send SMS',
    };
  }
}
