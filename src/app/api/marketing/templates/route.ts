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

// GET /api/marketing/templates - List templates
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') // email or sms
    const category = searchParams.get('category')

    const supabase = getSupabase()
    let query = supabase
      .from('marketing_templates')
      .select('*')
      .order('times_used', { ascending: false })

    if (type) {
      query = query.eq('type', type)
    }
    if (category) {
      query = query.eq('category', category)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ templates: data })
  } catch (error) {
    console.error('Error fetching templates:', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

// POST /api/marketing/templates - Create template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('marketing_templates')
      .insert({
        name: body.name,
        type: body.type,
        category: body.category,
        subject: body.subject,
        content: body.content,
        variables: body.variables || [],
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ template: data })
  } catch (error) {
    console.error('Error creating template:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
