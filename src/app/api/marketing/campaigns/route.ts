import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET /api/marketing/campaigns - List campaigns
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    let sql = `
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
      WHERE 1=1
    `
    const params: any[] = []
    let paramIndex = 1

    if (status) {
      sql += ` AND c.status = $${paramIndex++}`
      params.push(status)
    }
    if (type) {
      sql += ` AND c.type = $${paramIndex++}`
      params.push(type)
    }

    sql += ` ORDER BY c.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`
    params.push(limit, offset)

    const campaigns = await query(sql, params)
    
    // Transform to nested structure
    const transformed = campaigns.map(c => ({
      id: c.id,
      name: c.name,
      type: c.type,
      status: c.status,
      subject: c.subject,
      content: c.content,
      recipient_count: c.recipient_count,
      scheduled_for: c.scheduled_for,
      sent_at: c.sent_at,
      completed_at: c.completed_at,
      delivered: c.delivered,
      opened: c.opened,
      clicked: c.clicked,
      bounced: c.bounced,
      unsubscribed: c.unsubscribed,
      replied: c.replied,
      created_at: c.created_at,
      updated_at: c.updated_at,
      segment: c.segment_id ? {
        id: c.segment_id,
        name: c.segment_name,
        customer_count: c.segment_customer_count
      } : null,
      template: c.template_id ? {
        id: c.template_id,
        name: c.template_name
      } : null
    }))

    return NextResponse.json({ campaigns: transformed, total: campaigns.length })
  } catch (error) {
    console.error('Error fetching campaigns:', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }
}

// POST /api/marketing/campaigns - Create campaign
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const campaign = await queryOne(`
      INSERT INTO marketing_campaigns (name, type, status, template_id, subject, content, segment_id, recipient_count, scheduled_for)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      body.name,
      body.type,
      body.status || 'draft',
      body.template_id || null,
      body.subject || null,
      body.content,
      body.segment_id || null,
      body.recipient_count || 0,
      body.scheduled_for || null
    ])

    return NextResponse.json({ campaign })
  } catch (error) {
    console.error('Error creating campaign:', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
