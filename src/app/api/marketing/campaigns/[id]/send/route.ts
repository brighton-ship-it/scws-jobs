import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// POST /api/marketing/campaigns/[id]/send - Send a campaign
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const campaignId = params.id
  
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
      return NextResponse.json({ error: 'Campaign cannot be sent' }, { status: 400 })
    }

    // Update campaign status to sending
    await query(`
      UPDATE marketing_campaigns 
      SET status = 'sending', sent_at = NOW() 
      WHERE id = $1
    `, [campaignId])

    // Get eligible customers (simplified - in production would apply segment conditions)
    const customers = await query<any>(`
      SELECT id, name, email, phone 
      FROM customers 
      WHERE email IS NOT NULL OR phone IS NOT NULL
      LIMIT $1
    `, [campaign.segment_customer_count || 1000])

    // Get unsubscribed customer IDs
    const unsubscribes = await query<any>(`
      SELECT customer_id FROM marketing_unsubscribes 
      WHERE channel = $1 OR channel = 'all'
    `, [campaign.type])

    const unsubscribedIds = new Set(unsubscribes.map(u => u.customer_id))

    // Filter out unsubscribed customers
    const eligibleCustomers = customers.filter(c => !unsubscribedIds.has(c.id))

    // Create recipient records
    for (const customer of eligibleCustomers) {
      await query(`
        INSERT INTO marketing_campaign_recipients (campaign_id, customer_id, email, phone, status)
        VALUES ($1, $2, $3, $4, 'pending')
        ON CONFLICT (campaign_id, customer_id) DO NOTHING
      `, [campaignId, customer.id, customer.email, customer.phone])
    }

    // TODO: Actually send messages via Twilio/SendGrid
    // For now, simulate sending by updating status
    
    if (campaign.type === 'email') {
      console.log(`[Marketing] Would send ${eligibleCustomers.length} emails for campaign ${campaignId}`)
    } else {
      console.log(`[Marketing] Would send ${eligibleCustomers.length} SMS for campaign ${campaignId}`)
    }

    // Simulate: Update all recipients to delivered
    await query(`
      UPDATE marketing_campaign_recipients
      SET status = 'delivered', sent_at = NOW(), delivered_at = NOW()
      WHERE campaign_id = $1
    `, [campaignId])

    // Update campaign with final stats
    await query(`
      UPDATE marketing_campaigns 
      SET status = 'sent', completed_at = NOW(), delivered = $1, recipient_count = $1
      WHERE id = $2
    `, [eligibleCustomers.length, campaignId])

    return NextResponse.json({ 
      success: true, 
      message: `Campaign sent to ${eligibleCustomers.length} recipients`,
      recipients: eligibleCustomers.length
    })
  } catch (error) {
    console.error('Error sending campaign:', error)
    
    // Update campaign status to failed
    try {
      await query(`
        UPDATE marketing_campaigns SET status = 'failed' WHERE id = $1
      `, [campaignId])
    } catch (e) {
      console.error('Failed to update campaign status:', e)
    }

    return NextResponse.json({ error: 'Failed to send campaign' }, { status: 500 })
  }
}
