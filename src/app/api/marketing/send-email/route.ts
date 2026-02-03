import { NextRequest, NextResponse } from 'next/server'
import { sendEmail, isResendConfigured, textToHtml } from '@/lib/messaging/email'
import { query } from '@/lib/db'
import { logEmail } from '@/lib/communications'

interface SendEmailBody {
  recipientId: string // marketing_campaign_recipients.id
  campaignId: string
  customerId: string
  email: string
  subject: string
  content: string
  isHtml?: boolean
}

// POST /api/marketing/send-email - Send a single email for a campaign
export async function POST(request: NextRequest) {
  try {
    // Check Resend is configured
    if (!isResendConfigured()) {
      return NextResponse.json(
        { 
          error: 'Resend not configured',
          details: 'Required env vars: RESEND_API_KEY'
        },
        { status: 500 }
      )
    }

    const body: SendEmailBody = await request.json()
    const { recipientId, campaignId, customerId, email, subject, content, isHtml } = body

    if (!email || !subject || !content) {
      return NextResponse.json(
        { error: 'Email, subject, and content are required' },
        { status: 400 }
      )
    }

    // Add unsubscribe link to footer
    const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://jobs.scwellservice.com'}/unsubscribe?cid=${campaignId}&rid=${recipientId}`
    const contentWithUnsubscribe = content + `\n\n---\nTo unsubscribe from marketing emails, click here: ${unsubscribeUrl}`

    // Send the email
    const result = await sendEmail({
      to: email,
      subject,
      html: isHtml ? content : textToHtml(contentWithUnsubscribe),
      text: contentWithUnsubscribe,
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
        await logEmail({
          customerId,
          subject,
          body: content,
          email,
          messageId: result.messageId,
        }).catch(err => console.error('[Marketing Email] Failed to log communication:', err))
      }
      
      return NextResponse.json({
        success: true,
        messageId: result.messageId,
        to: email,
      })
    } else {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('[Marketing Email] Error:', error)
    return NextResponse.json(
      { error: 'Failed to send email', details: error.message },
      { status: 500 }
    )
  }
}

// GET /api/marketing/send-email - Check Resend configuration
export async function GET() {
  const configured = isResendConfigured()
  return NextResponse.json({
    configured,
    provider: 'resend',
    requiredEnvVars: ['RESEND_API_KEY'],
    optionalEnvVars: ['FROM_EMAIL', 'FROM_NAME'],
  })
}
