import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// GET /api/marketing/segments - List segments
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    let query = supabase
      .from('marketing_segments')
      .select('*')
      .order('customer_count', { ascending: false })

    if (type) {
      query = query.eq('type', type)
    }

    const { data: segments, error } = await query

    if (error) {
      console.error('Error fetching segments:', error)
      return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 })
    }

    return NextResponse.json({ segments: segments || [] })
  } catch (error) {
    console.error('Error fetching segments:', error)
    return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 })
  }
}

// POST /api/marketing/segments - Create segment
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient()
    const body = await request.json()
    
    // Calculate initial customer count
    let customerCount = 0
    if (!body.conditions || body.conditions.length === 0) {
      const { count } = await supabase.from('customers').select('*', { count: 'exact', head: true })
      customerCount = count || 0
    }
    
    const { data: segment, error } = await supabase
      .from('marketing_segments')
      .insert({
        name: body.name,
        description: body.description || null,
        type: body.type || 'custom',
        conditions: body.conditions || [],
        customer_count: customerCount,
        is_dynamic: body.is_dynamic || false
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating segment:', error)
      return NextResponse.json({ error: 'Failed to create segment' }, { status: 500 })
    }

    return NextResponse.json({ segment })
  } catch (error) {
    console.error('Error creating segment:', error)
    return NextResponse.json({ error: 'Failed to create segment' }, { status: 500 })
  }
}
