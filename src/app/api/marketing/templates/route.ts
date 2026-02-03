import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET /api/marketing/templates - List templates
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const category = searchParams.get('category')

    let sql = 'SELECT * FROM marketing_templates WHERE 1=1'
    const params: any[] = []
    let paramIndex = 1

    if (type) {
      sql += ` AND type = $${paramIndex++}`
      params.push(type)
    }
    if (category) {
      sql += ` AND category = $${paramIndex++}`
      params.push(category)
    }

    sql += ' ORDER BY times_used DESC'

    const templates = await query(sql, params)
    return NextResponse.json({ templates })
  } catch (error) {
    console.error('Error fetching templates:', error)
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 })
  }
}

// POST /api/marketing/templates - Create template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const template = await queryOne(`
      INSERT INTO marketing_templates (name, type, category, subject, content, variables)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      body.name,
      body.type,
      body.category,
      body.subject || null,
      body.content,
      JSON.stringify(body.variables || [])
    ])

    return NextResponse.json({ template })
  } catch (error) {
    console.error('Error creating template:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
