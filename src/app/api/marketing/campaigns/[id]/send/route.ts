import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'
import { sendSMS, isTwilioConfigured, formatPhoneNumber } from '@/lib/messaging/sms'
import { sendEmail, isResendConfigured, textToHtml } from '@/lib/messaging/email'

// Rate limiting for SMS: 1 message per second to avoid carrier blocks
const SMS_INTERVAL_MS = 1000
let lastSMSSendTime = 0

async function waitForSMSRateLimit(): Promise<void> {
  const now = Date.now()
  const elapsed = now - lastSMSSendTime
  if (elapsed < SMS_INTERVAL_MS) {
    await new Promise(resolve => setTimeout(resolve, SMS_INTERVAL_MS - elapsed))
  }
  lastSMSSendTime = Date.now()
}

/**
 * Substitute template variables in message content
 */
function substituteVariables(content: string, customer: any): string {
  const vars: Record<string, string> = {
    '{{customer_name}}': customer.name || 'Valued Customer',
    '{{first_name}}': customer.name?.split(' ')[0] || 'Valued Customer',
    '{{address}}': customer.address || customer.service_address || '',
    '{{city}}': customer.city || '',
    '{{phone}}': customer.phone || '',
    '{{email}}': customer.email || '',
    '{{last_service_date}}': customer.last_service_date 
      ? new Date(customer.last_service_date).toLocaleDateString('en-US', { 
          year: 'numeric', month: 'long', day: 'numeric' 
        })
      : 'N/A',
  }

  let result = content
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value)
  }
  return result
}

/**
 * Get customers for a segment
 */
async function getSegmentCustomers(segmentId: string, campaignType: 'email' | 'sms'): Promise<any[]> {
  // Get segment conditions
  const segment = await queryOne<any>(`
    SELECT * FROM marketing_segments WHERE id = $1
  `, [segmentId])

  if (!segment) {
    throw new Error('Segment not found')
  }

  // For now, get all customers with required contact info
  // TODO: Apply segment conditions for dynamic segments
  const contactField = campaignType === 'email' ? 'email' : 'phone'
  
  const customers = await query<any>(`
    SELECT 
      c.id, 
      c.name, 
      c.email, 
      c.phone, 
      c.service_address as address,
      c.city,
      MAX(j.completed_at) as last_service_date
    FROM customers c
    LEFT JOIN jobs j ON j.customer_id = c.id AND j.status = 'completed'
    WHERE c.${contactField} IS NOT NULL 
      AND c.${contactField} != ''
    GROUP BY c.id, c.name, c.email, c.phone, c.service_address, c.city
    LIMIT 10000
  `)

  return customers
}

// POST /api/marketing/campaigns/[id]/send - Send a campaign
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params
  
  try {
    // Get campaign details
    const campaign = await queryOne<any>(`
      SELECT c.*, s.name as segment_name, s.customer_count as segment_customer_count
      FROM marketing_campaigns c
      LEFT JOIN marketing_segments s ON c.segment_id = s.id
      WHERE c.id = $1
    `, [campaignId])

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Campaign cannot be sent - status is ' + campaign.status }, { status: 400 })
    }

    // Check provider configuration
    if (campaign.type === 'sms' && !isTwilioConfigured()) {
      return NextResponse.json({ 
        error: 'Twilio not configured',
        details: 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER environment variables'
      }, { status: 500 })
    }

    if (campaign.type === 'email' && !isResendConfigured()) {
      return NextResponse.json({ 
        error: 'Resend not configured',
        details: 'Set RESEND_API_KEY environment variable'
      }, { status: 500 })
    }

    // Update campaign status to sending
    await query(`
      UPDATE marketing_campaigns 
      SET status = 'sending', sent_at = NOW() 
      WHERE id = $1
    `, [campaignId])

    // Get eligible customers
    const customers = await getSegmentCustomers(campaign.segment_id, campaign.type)

    // Get unsubscribed customer IDs
    const unsubscribes = await query<any>(`
      SELECT customer_id FROM marketing_unsubscribes 
      WHERE channel = $1 OR channel = 'all'
    `, [campaign.type])

    const unsubscribedIds = new Set(unsubscribes.map((u: any) => u.customer_id))

    // Filter out unsubscribed customers
    const eligibleCustomers = customers.filter((c: any) => !unsubscribedIds.has(c.id))

    console.log(`[Marketing Campaign ${campaignId}] Sending ${campaign.type} to ${eligibleCustomers.length} recipients`)

    // Create recipient records
    for (const customer of eligibleCustomers) {
      await query(`
        INSERT INTO marketing_campaign_recipients (campaign_id, customer_id, email, phone, status)
        VALUES ($1, $2, $3, $4, 'pending')
        ON CONFLICT (campaign_id, customer_id) DO NOTHING
      `, [campaignId, customer.id, customer.email, customer.phone])
    }

    // Get all recipient records for this campaign
    const recipients = await query<any>(`
      SELECT r.*, c.name, c.email, c.phone, c.service_address as address, c.city
      FROM marketing_campaign_recipients r
      JOIN customers c ON c.id = r.customer_id
      WHERE r.campaign_id = $1 AND r.status = 'pending'
    `, [campaignId])

    // Send messages
    let sent = 0
    let failed = 0
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jobs.scwellservice.com'

    for (const recipient of recipients) {
      try {
        // Substitute variables
        const personalizedContent = substituteVariables(campaign.content, recipient)

        if (campaign.type === 'sms') {
          // Rate limit SMS
          await waitForSMSRateLimit()

          if (!recipient.phone) {
            await query(`
              UPDATE marketing_campaign_recipients
              SET status = 'failed', error_message = 'No phone number'
              WHERE id = $1
            `, [recipient.id])
            failed++
            continue
          }

          const result = await sendSMS({
            to: recipient.phone,
            message: personalizedContent,
          })

          if (result.success) {
            await query(`
              UPDATE marketing_campaign_recipients
              SET status = 'sent', sent_at = NOW(), external_message_id = $1
              WHERE id = $2
            `, [result.messageId, recipient.id])
            sent++
          } else {
            await query(`
              UPDATE marketing_campaign_recipients
              SET status = 'failed', error_message = $1
              WHERE id = $2
            `, [result.error, recipient.id])
            failed++
          }
        } else {
          // Email
          if (!recipient.email) {
            await query(`
              UPDATE marketing_campaign_recipients
              SET status = 'failed', error_message = 'No email address'
              WHERE id = $1
            `, [recipient.id])
            failed++
            continue
          }

          // Add unsubscribe link
          const unsubscribeUrl = `${baseUrl}/unsubscribe?cid=${campaignId}&rid=${recipient.id}`
          const contentWithUnsubscribe = personalizedContent + 
            `\n\n---\nTo unsubscribe from marketing emails, click here: ${unsubscribeUrl}`

          const result = await sendEmail({
            to: recipient.email,
            subject: substituteVariables(campaign.subject || 'Message from Southern California Well Service', recipient),
            html: textToHtml(contentWithUnsubscribe),
            text: contentWithUnsubscribe,
          })

          if (result.success) {
            await query(`
              UPDATE marketing_campaign_recipients
              SET status = 'sent', sent_at = NOW(), external_message_id = $1
              WHERE id = $2
            `, [result.messageId, recipient.id])
            sent++
          } else {
            await query(`
              UPDATE marketing_campaign_recipients
              SET status = 'failed', error_message = $1
              WHERE id = $2
            `, [result.error, recipient.id])
            failed++
          }
        }

        // Log progress every 100 messages
        if ((sent + failed) % 100 === 0) {
          console.log(`[Marketing Campaign ${campaignId}] Progress: ${sent} sent, ${failed} failed`)
        }
      } catch (error: any) {
        console.error(`[Marketing Campaign ${campaignId}] Error sending to ${recipient.id}:`, error)
        await query(`
          UPDATE marketing_campaign_recipients
          SET status = 'failed', error_message = $1
          WHERE id = $2
        `, [error.message || 'Unknown error', recipient.id])
        failed++
      }
    }

    // Update campaign with final stats
    const finalStatus = failed === recipients.length ? 'failed' : 'sent'
    await query(`
      UPDATE marketing_campaigns 
      SET status = $1, completed_at = NOW(), delivered = $2, recipient_count = $3
      WHERE id = $4
    `, [finalStatus, sent, recipients.length, campaignId])

    console.log(`[Marketing Campaign ${campaignId}] Complete: ${sent} sent, ${failed} failed`)

    return NextResponse.json({ 
      success: true, 
      message: `Campaign sent: ${sent} delivered, ${failed} failed`,
      stats: {
        total: recipients.length,
        sent,
        failed,
      }
    })
  } catch (error: any) {
    console.error('Error sending campaign:', error)
    
    // Update campaign status to failed
    try {
      await query(`
        UPDATE marketing_campaigns SET status = 'failed' WHERE id = $1
      `, [campaignId])
    } catch (e) {
      console.error('Failed to update campaign status:', e)
    }

    return NextResponse.json({ 
      error: 'Failed to send campaign',
      details: error.message 
    }, { status: 500 })
  }
}

// GET /api/marketing/campaigns/[id]/send - Get send status/config
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: campaignId } = await params
  
  try {
    const campaign = await queryOne<any>(`
      SELECT * FROM marketing_campaigns WHERE id = $1
    `, [campaignId])

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Get recipient stats
    const stats = await queryOne<any>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM marketing_campaign_recipients
      WHERE campaign_id = $1
    `, [campaignId])

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        status: campaign.status,
      },
      stats: stats ? {
        total: parseInt(stats.total),
        pending: parseInt(stats.pending),
        sent: parseInt(stats.sent),
        delivered: parseInt(stats.delivered),
        failed: parseInt(stats.failed),
      } : null,
      providerConfigured: campaign.type === 'sms' ? isTwilioConfigured() : isResendConfigured(),
    })
  } catch (error) {
    console.error('Error getting campaign status:', error)
    return NextResponse.json({ error: 'Failed to get campaign status' }, { status: 500 })
  }
}
