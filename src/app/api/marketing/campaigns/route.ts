import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/marketing/campaigns - List campaigns
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = supabase
      .from('marketing_campaigns')
      .select(`
        *,
        segment:marketing_segments!segment_id (id, name, customer_count),
        template:marketing_templates!template_id (id, name)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }
    if (type) {
      query = query.eq('type', type)
    }

    const { data: campaigns, error } = await query

    if (error) {
      console.error('Error fetching campaigns:', error)
      return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
    }
    
    // Transform to match expected structure
    const transformed = (campaigns || []).map(c => ({
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
      segment: c.segment || null,
      template: c.template || null
    }))

    return NextResponse.json({ campaigns: transformed, total: transformed.length })
  } catch (error) {
    console.error('Error fetching campaigns:', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }
}

// POST /api/marketing/campaigns - Create campaign
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const body = await request.json()
    
    const { data: campaign, error } = await supabase
      .from('marketing_campaigns')
      .insert({
        name: body.name,
        type: body.type,
        status: body.status || 'draft',
        template_id: body.template_id || null,
        subject: body.subject || null,
        content: body.content,
        segment_id: body.segment_id || null,
        recipient_count: body.recipient_count || 0,
        scheduled_for: body.scheduled_for || null
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating campaign:', error)
      return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
    }

    return NextResponse.json({ campaign })
  } catch (error) {
    console.error('Error creating campaign:', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
