import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw new Error('Supabase credentials not configured')
  }
  return createClient(url, key)
}

// GET /api/marketing/segments - List segments
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabase()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    let query = supabase
      .from('marketing_segments')
      .select('*')
      .order('customer_count', { ascending: false })

    if (type) {
      query = query.eq('type', type)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ segments: data })
  } catch (error) {
    console.error('Error fetching segments:', error)
    return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 })
  }
}

// POST /api/marketing/segments - Create segment
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabase()
    const body = await request.json()
    
    // Calculate initial customer count based on conditions
    const customerCount = await calculateSegmentCount(supabase, body.conditions)
    
    const { data, error } = await supabase
      .from('marketing_segments')
      .insert({
        name: body.name,
        description: body.description,
        type: body.type || 'custom',
        conditions: body.conditions || [],
        customer_count: customerCount,
        is_dynamic: body.is_dynamic || false,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ segment: data })
  } catch (error) {
    console.error('Error creating segment:', error)
    return NextResponse.json({ error: 'Failed to create segment' }, { status: 500 })
  }
}

// Helper to calculate segment count based on conditions
async function calculateSegmentCount(supabase: SupabaseClient, conditions: any[]): Promise<number> {
  if (!conditions || conditions.length === 0) {
    // Return total customer count
    const { count } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true })
    return count || 0
  }

  // Build dynamic query based on conditions
  let query = supabase.from('customers').select('*', { count: 'exact', head: true })

  for (const condition of conditions) {
    switch (condition.field) {
      case 'city':
        if (condition.operator === 'in') {
          const cities = condition.value.split(',').map((c: string) => c.trim())
          query = query.in('city', cities)
        }
        break
      case 'last_service':
        // Would need to join with jobs table
        break
    }
  }

  const { count } = await query
  return count || 0
}
