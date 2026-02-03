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

// GET /api/marketing/campaigns - List campaigns
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    const supabase = getSupabase()
    let query = supabase
      .from('marketing_campaigns')
      .select(`
        *,
        segment:marketing_segments(id, name, customer_count),
        template:marketing_templates(id, name)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }
    if (type) {
      query = query.eq('type', type)
    }

    const { data, error, count } = await query

    if (error) throw error

    return NextResponse.json({ campaigns: data, total: count })
  } catch (error) {
    console.error('Error fetching campaigns:', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }
}

// POST /api/marketing/campaigns - Create campaign
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('marketing_campaigns')
      .insert({
        name: body.name,
        type: body.type,
        status: body.status || 'draft',
        template_id: body.template_id,
        subject: body.subject,
        content: body.content,
        segment_id: body.segment_id,
        recipient_count: body.recipient_count || 0,
        scheduled_for: body.scheduled_for,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ campaign: data })
  } catch (error) {
    console.error('Error creating campaign:', error)
    return NextResponse.json({ error: 'Failed to create campaign' }, { status: 500 })
  }
}
