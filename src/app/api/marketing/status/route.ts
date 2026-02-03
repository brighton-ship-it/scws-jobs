import { NextResponse } from 'next/server'
import { isTwilioConfigured } from '@/lib/messaging/sms'
import { isResendConfigured } from '@/lib/messaging/email'

// GET /api/marketing/status - Check marketing module configuration
export async function GET() {
  const twilioConfigured = isTwilioConfigured()
  const resendConfigured = isResendConfigured()

  const missingEnvVars: string[] = []

  if (!twilioConfigured) {
    if (!process.env.TWILIO_ACCOUNT_SID) missingEnvVars.push('TWILIO_ACCOUNT_SID')
    if (!process.env.TWILIO_AUTH_TOKEN) missingEnvVars.push('TWILIO_AUTH_TOKEN')
    if (!process.env.TWILIO_FROM_NUMBER) missingEnvVars.push('TWILIO_FROM_NUMBER')
  }

  if (!resendConfigured) {
    if (!process.env.RESEND_API_KEY) missingEnvVars.push('RESEND_API_KEY')
  }

  return NextResponse.json({
    sms: {
      configured: twilioConfigured,
      provider: 'twilio',
      requiredEnvVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
    },
    email: {
      configured: resendConfigured,
      provider: 'resend',
      requiredEnvVars: ['RESEND_API_KEY'],
      optionalEnvVars: ['FROM_EMAIL', 'FROM_NAME'],
    },
    ready: twilioConfigured && resendConfigured,
    smsReady: twilioConfigured,
    emailReady: resendConfigured,
    missingEnvVars,
    message: twilioConfigured && resendConfigured 
      ? 'Marketing module fully configured'
      : `Missing configuration: ${missingEnvVars.join(', ')}`,
  })
}
