import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

// GET /api/marketing/stats - Get marketing analytics overview
export async function GET() {
  try {
    const supabase = createServiceClient()

    // Get all campaigns
    const { data: campaigns, error: campaignsError } = await supabase
      .from('marketing_campaigns')
      .select('id, name, type, status, sent_at, recipient_count, delivered, opened, clicked, created_at')

    if (campaignsError) {
      console.error('Error fetching campaigns:', campaignsError)
      // If table doesn't exist, return empty stats
      if (campaignsError.code === '42P01') {
        return NextResponse.json({
          campaigns: { total: 0, draft: 0, scheduled: 0, sending: 0, sent: 0, failed: 0, byType: { email: 0, sms: 0 } },
          messages: { total: 0, sent: 0, delivered: 0, failed: 0, opened: 0, clicked: 0, thisYear: 0 },
          rates: { openRate: 0, clickRate: 0, smsDeliveryRate: 0 },
          recentCampaigns: [],
        })
      }
      throw campaignsError
    }

    // Get recipients if table exists
    let recipientStats = { total: 0, sent: 0, delivered: 0, failed: 0, opened: 0, clicked: 0 }
    const { data: recipients, error: recipientsError } = await supabase
      .from('marketing_campaign_recipients')
      .select('status, opened_at, clicked_at')

    if (!recipientsError && recipients) {
      recipientStats = {
        total: recipients.length,
        sent: recipients.filter(r => r.status === 'sent').length,
        delivered: recipients.filter(r => r.status === 'delivered').length,
        failed: recipients.filter(r => r.status === 'failed').length,
        opened: recipients.filter(r => r.opened_at).length,
        clicked: recipients.filter(r => r.clicked_at).length,
      }
    }

    // Calculate campaign stats
    const allCampaigns = campaigns || []
    const campaignStats = {
      total: allCampaigns.length,
      draft: allCampaigns.filter(c => c.status === 'draft').length,
      scheduled: allCampaigns.filter(c => c.status === 'scheduled').length,
      sending: allCampaigns.filter(c => c.status === 'sending').length,
      sent: allCampaigns.filter(c => c.status === 'sent').length,
      failed: allCampaigns.filter(c => c.status === 'failed').length,
      byType: {
        email: allCampaigns.filter(c => c.type === 'email').length,
        sms: allCampaigns.filter(c => c.type === 'sms').length,
      }
    }

    // Calculate rates
    const emailCampaigns = allCampaigns.filter(c => c.type === 'email' && c.status === 'sent')
    const smsCampaigns = allCampaigns.filter(c => c.type === 'sms' && c.status === 'sent')
    
    const emailTotal = emailCampaigns.reduce((sum, c) => sum + (c.recipient_count || 0), 0)
    const emailOpened = emailCampaigns.reduce((sum, c) => sum + (c.opened || 0), 0)
    const emailClicked = emailCampaigns.reduce((sum, c) => sum + (c.clicked || 0), 0)
    
    const smsTotal = smsCampaigns.reduce((sum, c) => sum + (c.recipient_count || 0), 0)
    const smsDelivered = smsCampaigns.reduce((sum, c) => sum + (c.delivered || 0), 0)

    const openRate = emailTotal > 0 ? ((emailOpened / emailTotal) * 100) : 0
    const clickRate = emailTotal > 0 ? ((emailClicked / emailTotal) * 100) : 0
    const smsDeliveryRate = smsTotal > 0 ? ((smsDelivered / smsTotal) * 100) : 0

    // Recent campaigns (non-draft, sorted by sent/created date)
    const recentCampaigns = allCampaigns
      .filter(c => c.status !== 'draft')
      .sort((a, b) => {
        const dateA = new Date(a.sent_at || a.created_at).getTime()
        const dateB = new Date(b.sent_at || b.created_at).getTime()
        return dateB - dateA
      })
      .slice(0, 5)

    return NextResponse.json({
      campaigns: campaignStats,
      messages: {
        ...recipientStats,
        thisYear: recipientStats.sent, // Simplified - all sent messages
      },
      rates: {
        openRate: parseFloat(openRate.toFixed(1)),
        clickRate: parseFloat(clickRate.toFixed(1)),
        smsDeliveryRate: parseFloat(smsDeliveryRate.toFixed(1)),
      },
      recentCampaigns,
    })
  } catch (error) {
    console.error('Error fetching marketing stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats', details: String(error) }, { status: 500 })
  }
}
