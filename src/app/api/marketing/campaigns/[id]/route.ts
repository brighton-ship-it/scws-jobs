import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET /api/marketing/campaigns/[id] - Get single campaign
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    const campaign = await queryOne(`
      SELECT 
        c.*,
        s.id as segment_id,
        s.name as segment_name,
        s.customer_count as segment_customer_count,
        t.id as template_id,
        t.name as template_name
      FROM marketing_campaigns c
      LEFT JOIN marketing_segments s ON c.segment_id = s.id
      LEFT JOIN marketing_templates t ON c.template_id = t.id
      WHERE c.id = $1
    `, [id])

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    // Get recipient stats
    const stats = await queryOne<any>(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE opened_at IS NOT NULL) as opened,
        COUNT(*) FILTER (WHERE clicked_at IS NOT NULL) as clicked
      FROM marketing_campaign_recipients
      WHERE campaign_id = $1
    `, [id])

    return NextResponse.json({ 
      campaign: {
        ...campaign,
        segment: campaign.segment_id ? {
          id: campaign.segment_id,
          name: campaign.segment_name,
          customer_count: campaign.segment_customer_count
        } : null,
        template: campaign.template_id ? {
          id: campaign.template_id,
          name: campaign.template_name
        } : null
      },
      stats: stats ? {
        total: parseInt(stats.total),
        sent: parseInt(stats.sent),
        delivered: parseInt(stats.delivered),
        failed: parseInt(stats.failed),
        opened: parseInt(stats.opened),
        clicked: parseInt(stats.clicked),
      } : null
    })
  } catch (error) {
    console.error('Error fetching campaign:', error)
    return NextResponse.json({ error: 'Failed to fetch campaign' }, { status: 500 })
  }
}

// PUT /api/marketing/campaigns/[id] - Update campaign
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    const body = await request.json()
    
    // Only allow updating draft campaigns
    const existing = await queryOne<any>('SELECT status FROM marketing_campaigns WHERE id = $1', [id])
    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Can only edit draft campaigns' }, { status: 400 })
    }
    
    const campaign = await queryOne(`
      UPDATE marketing_campaigns 
      SET 
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        template_id = $3,
        subject = COALESCE($4, subject),
        content = COALESCE($5, content),
        segment_id = $6,
        scheduled_for = $7,
        updated_at = NOW()
      WHERE id = $8
      RETURNING *
    `, [
      body.name,
      body.type,
      body.template_id || null,
      body.subject,
      body.content,
      body.segment_id || null,
      body.scheduled_for || null,
      id
    ])

    return NextResponse.json({ campaign })
  } catch (error) {
    console.error('Error updating campaign:', error)
    return NextResponse.json({ error: 'Failed to update campaign' }, { status: 500 })
  }
}

// DELETE /api/marketing/campaigns/[id] - Delete campaign
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    // Only allow deleting draft campaigns
    const existing = await queryOne<any>('SELECT status FROM marketing_campaigns WHERE id = $1', [id])
    if (!existing) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }
    if (existing.status !== 'draft') {
      return NextResponse.json({ error: 'Can only delete draft campaigns' }, { status: 400 })
    }
    
    await query('DELETE FROM marketing_campaigns WHERE id = $1', [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting campaign:', error)
    return NextResponse.json({ error: 'Failed to delete campaign' }, { status: 500 })
  }
}
