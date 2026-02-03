import { NextRequest, NextResponse } from 'next/server'
import { sendSMS, isTwilioConfigured, formatPhoneNumber } from '@/lib/messaging/sms'
import { query, queryOne } from '@/lib/db'
import { logSMS } from '@/lib/communications'

// Rate limiting: track last send time
let lastSendTime = 0
const MIN_INTERVAL_MS = 1000 // 1 second between messages to avoid carrier blocks

async function waitForRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastSendTime
  if (elapsed < MIN_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL_MS - elapsed))
  }
  lastSendTime = Date.now()
}

interface SendSMSBody {
  recipientId: string // marketing_campaign_recipients.id
  campaignId: string
  customerId: string
  phone: string
  message: string
}

// POST /api/marketing/send-sms - Send a single SMS for a campaign
export async function POST(request: NextRequest) {
  try {
    // Check Twilio is configured
    if (!isTwilioConfigured()) {
      return NextResponse.json(
        { 
          error: 'Twilio not configured',
          details: 'Required env vars: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER'
        },
        { status: 500 }
      )
    }

    const body: SendSMSBody = await request.json()
    const { recipientId, campaignId, customerId, phone, message } = body

    if (!phone || !message) {
      return NextResponse.json(
        { error: 'Phone and message are required' },
        { status: 400 }
      )
    }

    // Rate limit
    await waitForRateLimit()

    // Send the SMS
    const result = await sendSMS({
      to: phone,
      message,
    })

    // Update recipient record if provided
    if (recipientId) {
      if (result.success) {
        await query(`
          UPDATE marketing_campaign_recipients
          SET status = 'sent', sent_at = NOW(), external_message_id = $1
          WHERE id = $2
        `, [result.messageId, recipientId])
      } else {
        await query(`
          UPDATE marketing_campaign_recipients
          SET status = 'failed', error_message = $1
          WHERE id = $2
        `, [result.error, recipientId])
      }
    }

    if (result.success) {
      // Auto-log the communication
      if (customerId) {
        await logSMS({
          customerId,
          message,
          phone,
          messageId: result.messageId,
        }).catch(err => console.error('[Marketing SMS] Failed to log communication:', err))
      }
      
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        to: formatPhoneNumber(phone),
      })
    } else {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('[Marketing SMS] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send SMS', details: error.message },
      { status: 500 }
    )
  }
}

// GET /api/marketing/send-sms - Check Twilio configuration
export async function GET() {
  const configured = isTwilioConfigured()
  return NextResponse.json({
    configured,
    provider: 'twilio',
    requiredEnvVars: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'],
  })
}
