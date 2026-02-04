import { NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET /api/marketing/stats - Get marketing analytics overview
export async function GET() {
  try {
    // Total campaigns
    const campaignCounts = await queryOne<any>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'draft') as draft,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled,
        COUNT(*) FILTER (WHERE status = 'sending') as sending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE type = 'email') as email_campaigns,
        COUNT(*) FILTER (WHERE type = 'sms') as sms_campaigns
      FROM marketing_campaigns
    `)

    // Recipient stats (all time)
    const recipientStats = await queryOne<any>(`
      SELECT 
        COUNT(*) as total_recipients,
        COUNT(*) FILTER (WHERE status = 'sent') as total_sent,
        COUNT(*) FILTER (WHERE status = 'delivered') as total_delivered,
        COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as total_opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as total_clicked
      FROM marketing_campaign_recipients
    `)

    // This year stats
    const yearStats = await queryOne<any>(`
      SELECT 
        COUNT(*) as messages_sent
      FROM marketing_campaign_recipients r
      JOIN marketing_campaigns c ON c.id = r.campaign_id
      WHERE r.status = 'sent' 
        AND r.sent_at >= date_trunc('year', CURRENT_DATE)
    `)

    // Email performance (open rate, click rate)
    const emailPerf = await queryOne<any>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as clicked
      FROM marketing_campaign_recipients r
      JOIN marketing_campaigns c ON c.id = r.campaign_id
      WHERE c.type = 'email' AND r.status = 'sent'
    `)

    // SMS performance (delivery rate)
    const smsPerf = await queryOne<any>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered
      FROM marketing_campaign_recipients r
      JOIN marketing_campaigns c ON c.id = r.campaign_id
      WHERE c.type = 'sms' AND r.status IN ('sent', 'delivered')
    `)

    // Recent campaigns
    const recentCampaigns = await query<any>(`
      SELECT 
        c.id, c.name, c.type, c.status, c.sent_at, c.recipient_count,
        c.delivered, c.opened, c.clicked
      FROM marketing_campaigns c
      WHERE c.status != 'draft'
      ORDER BY COALESCE(c.sent_at, c.created_at) DESC
      LIMIT 5
    `)

    // Calculate rates
    const emailTotal = parseInt(emailPerf?.total || '0')
    const emailOpened = parseInt(emailPerf?.opened || '0')
    const emailClicked = parseInt(emailPerf?.clicked || '0')
    const smsTotal = parseInt(smsPerf?.total || '0')
    const smsDelivered = parseInt(smsPerf?.delivered || '0')

    const openRate = emailTotal > 0 ? ((emailOpened / emailTotal) * 100).toFixed(1) : '0.0'
    const clickRate = emailTotal > 0 ? ((emailClicked / emailTotal) * 100).toFixed(1) : '0.0'
    const smsDeliveryRate = smsTotal > 0 ? ((smsDelivered / smsTotal) * 100).toFixed(1) : '0.0'

    return NextResponse.json({
      campaigns: {
        total: parseInt(campaignCounts?.total || '0'),
        draft: parseInt(campaignCounts?.draft || '0'),
        scheduled: parseInt(campaignCounts?.scheduled || '0'),
        sending: parseInt(campaignCounts?.sending || '0'),
        sent: parseInt(campaignCounts?.sent || '0'),
        failed: parseInt(campaignCounts?.failed || '0'),
        byType: {
          email: parseInt(campaignCounts?.email_campaigns || '0'),
          sms: parseInt(campaignCounts?.sms_campaigns || '0'),
        }
      },
      messages: {
        total: parseInt(recipientStats?.total_recipients || '0'),
        sent: parseInt(recipientStats?.total_sent || '0'),
        delivered: parseInt(recipientStats?.total_delivered || '0'),
        failed: parseInt(recipientStats?.total_failed || '0'),
        opened: parseInt(recipientStats?.total_opened || '0'),
        clicked: parseInt(recipientStats?.total_clicked || '0'),
        thisYear: parseInt(yearStats?.messages_sent || '0'),
      },
      rates: {
        openRate: parseFloat(openRate),
        clickRate: parseFloat(clickRate),
        smsDeliveryRate: parseFloat(smsDeliveryRate),
      },
      recentCampaigns,
    })
  } catch (error) {
    console.error('Error fetching marketing stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
