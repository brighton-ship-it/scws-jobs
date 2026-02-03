import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw new Error('Supabase credentials not configured')
  }
  return createClient(url, key)
}

// POST /api/marketing/campaigns/[id]/send - Send a campaign
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const campaignId = params.id
    const supabase = getSupabase()

    // Get campaign details
    const { data: campaign, error: campaignError } = await supabase
      .from('marketing_campaigns')
      .select(`
        *,
        segment:marketing_segments(*)
      `)
      .eq('id', campaignId)
      .single()

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: 'Campaign cannot be sent' }, { status: 400 })
    }

    // Update campaign status to sending
    await supabase
      .from('marketing_campaigns')
      .update({ status: 'sending', sent_at: new Date().toISOString() })
      .eq('id', campaignId)

    // Get recipients based on segment
    // This is simplified - full implementation would apply segment conditions
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('id, name, email, phone')
      .limit(campaign.recipient_count || 1000)

    if (customersError) throw customersError

    // Check for unsubscribes
    const { data: unsubscribes } = await supabase
      .from('marketing_unsubscribes')
      .select('customer_id')
      .eq('channel', campaign.type === 'email' ? 'email' : 'sms')

    const unsubscribedIds = new Set(unsubscribes?.map(u => u.customer_id) || [])

    // Filter out unsubscribed customers
    const eligibleCustomers = customers?.filter(c => !unsubscribedIds.has(c.id)) || []

    // Create recipient records
    const recipients = eligibleCustomers.map(customer => ({
      campaign_id: campaignId,
      customer_id: customer.id,
      email: customer.email,
      phone: customer.phone,
      status: 'pending',
    }))

    if (recipients.length > 0) {
      await supabase
        .from('marketing_campaign_recipients')
        .insert(recipients)
    }

    // TODO: Actually send messages via Twilio/SendGrid
    // For now, simulate sending by updating status
    
    if (campaign.type === 'email') {
      // Would call SendGrid API here
      console.log(`Sending ${recipients.length} emails for campaign ${campaignId}`)
      
      // Simulate: Update all recipients to delivered
      await supabase
        .from('marketing_campaign_recipients')
        .update({ 
          status: 'delivered',
          sent_at: new Date().toISOString(),
          delivered_at: new Date().toISOString()
        })
        .eq('campaign_id', campaignId)
    } else {
      // Would call Twilio API here
      console.log(`Sending ${recipients.length} SMS for campaign ${campaignId}`)
      
      // Simulate: Update all recipients to delivered
      await supabase
        .from('marketing_campaign_recipients')
        .update({ 
          status: 'delivered',
          sent_at: new Date().toISOString(),
          delivered_at: new Date().toISOString()
        })
        .eq('campaign_id', campaignId)
    }

    // Update campaign with final stats
    await supabase
      .from('marketing_campaigns')
      .update({ 
        status: 'sent',
        completed_at: new Date().toISOString(),
        delivered: recipients.length,
        recipient_count: recipients.length
      })
      .eq('id', campaignId)

    return NextResponse.json({ 
      success: true, 
      message: `Campaign sent to ${recipients.length} recipients`,
      recipients: recipients.length
    })
  } catch (error) {
    console.error('Error sending campaign:', error)
    
    // Update campaign status to failed
    try {
      const supabase = getSupabase()
      await supabase
        .from('marketing_campaigns')
        .update({ status: 'failed' })
        .eq('id', params.id)
    } catch (e) {
      console.error('Failed to update campaign status:', e)
    }

    return NextResponse.json({ error: 'Failed to send campaign' }, { status: 500 })
  }
}
