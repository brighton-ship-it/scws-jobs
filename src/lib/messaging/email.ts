import { Resend } from 'resend';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@scwellservice.com';
const FROM_NAME = process.env.FROM_NAME || 'Southern California Well Service';

interface SendEmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Check if Resend is configured
 */
export function isResendConfigured(): boolean {
  return !!RESEND_API_KEY;
}

/**
 * Send an email via Resend
 */
export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: SendEmailOptions): Promise<SendEmailResult> {
  if (!isResendConfigured()) {
    console.error('[Email] Resend API key not configured');
    return {
      success: false,
      error: 'Resend not configured',
    };
  }

  try {
    const resend = new Resend(RESEND_API_KEY);

    const result = await resend.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: [to],
      subject,
      html,
      text,
      replyTo: replyTo || 'office@scwellservice.com',
    });

    if (result.error) {
      console.error('[Email] Resend error:', result.error);
      return {
        success: false,
        error: result.error.message,
      };
    }

    console.log(`[Email] Sent to ${to}: ${result.data?.id}`);

    return {
      success: true,
      messageId: result.data?.id,
    };
  } catch (error: any) {
    console.error('[Email] Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to send email',
    };
  }
}

/**
 * Convert plain text message to simple HTML
 */
export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  
  const withLinks = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color: #1e40af;">$1</a>'
  );
  
  const withBreaks = withLinks.replace(/\n/g, '<br>');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background-color: #f9fafb; border-radius: 8px; padding: 24px;">
    <p style="margin: 0 0 16px 0;">${withBreaks}</p>
    <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
    <p style="font-size: 12px; color: #6b7280; margin: 0;">
      Southern California Well Service<br>
      (760) 440-8520 | office@scwellservice.com
    </p>
  </div>
</body>
</html>`;
}
