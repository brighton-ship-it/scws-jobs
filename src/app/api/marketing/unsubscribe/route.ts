import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

interface UnsubscribeBody {
  campaignId?: string
  recipientId?: string
  customerId?: string
  channel: 'email' | 'sms' | 'all'
  reason?: string
}

// POST /api/marketing/unsubscribe - Handle unsubscribe requests
export async function POST(request: NextRequest) {
  try {
    const body: UnsubscribeBody = await request.json()
    const { campaignId, recipientId, customerId: directCustomerId, channel, reason } = body

    if (!channel) {
      return NextResponse.json({ error: 'Channel is required' }, { status: 400 })
    }

    // Determine customer ID
    let customerId = directCustomerId

    if (!customerId && recipientId) {
      // Look up customer from recipient record
      const recipient = await queryOne<any>(`
        SELECT customer_id FROM marketing_campaign_recipients WHERE id = $1
      `, [recipientId])
      
      if (recipient) {
        customerId = recipient.customer_id
      }
    }

    if (!customerId) {
      return NextResponse.json({ error: 'Could not identify customer' }, { status: 400 })
    }

    // Insert unsubscribe record
    await query(`
      INSERT INTO marketing_unsubscribes (customer_id, channel, reason, campaign_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (customer_id, channel) DO UPDATE SET
        reason = EXCLUDED.reason,
        campaign_id = EXCLUDED.campaign_id,
        unsubscribed_at = NOW()
    `, [customerId, channel, reason || 'User requested unsubscribe', campaignId])

    // Update recipient status if provided
    if (recipientId) {
      await query(`
        UPDATE marketing_campaign_recipients
        SET status = 'unsubscribed'
        WHERE id = $1
      `, [recipientId])
    }

    // Update campaign unsubscribe count
    if (campaignId) {
      await query(`
        UPDATE marketing_campaigns
        SET unsubscribed = unsubscribed + 1
        WHERE id = $1
      `, [campaignId])
    }

    console.log(`[Marketing] Customer ${customerId} unsubscribed from ${channel}`)

    return NextResponse.json({ 
      success: true,
      message: `Successfully unsubscribed from ${channel} marketing communications`
    })
  } catch (error: any) {
    console.error('[Marketing Unsubscribe] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process unsubscribe', details: error.message },
      { status: 500 }
    )
  }
}

// GET /api/marketing/unsubscribe - Check unsubscribe status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get('customerId')

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  }

  try {
    const unsubscribes = await query(`
      SELECT channel, unsubscribed_at FROM marketing_unsubscribes
      WHERE customer_id = $1
    `, [customerId])

    return NextResponse.json({
      customerId,
      unsubscribed: unsubscribes.length > 0,
      channels: unsubscribes,
    })
  } catch (error) {
    console.error('[Marketing Unsubscribe] Error:', error)
    return NextResponse.json({ error: 'Failed to check unsubscribe status' }, { status: 500 })
  }
}
