import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET /api/marketing/segments - List segments
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')

    let sql = 'SELECT * FROM marketing_segments WHERE 1=1'
    const params: any[] = []
    let paramIndex = 1

    if (type) {
      sql += ` AND type = $${paramIndex++}`
      params.push(type)
    }

    sql += ' ORDER BY customer_count DESC'

    const segments = await query(sql, params)
    return NextResponse.json({ segments })
  } catch (error) {
    console.error('Error fetching segments:', error)
    return NextResponse.json({ error: 'Failed to fetch segments' }, { status: 500 })
  }
}

// POST /api/marketing/segments - Create segment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Calculate initial customer count
    let customerCount = 0
    if (!body.conditions || body.conditions.length === 0) {
      const result = await queryOne<{ count: string }>('SELECT COUNT(*) FROM customers')
      customerCount = result ? parseInt(result.count) : 0
    }
    
    const segment = await queryOne(`
      INSERT INTO marketing_segments (name, description, type, conditions, customer_count, is_dynamic)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      body.name,
      body.description || null,
      body.type || 'custom',
      JSON.stringify(body.conditions || []),
      customerCount,
      body.is_dynamic || false
    ])

    return NextResponse.json({ segment })
  } catch (error) {
    console.error('Error creating segment:', error)
    return NextResponse.json({ error: 'Failed to create segment' }, { status: 500 })
  }
}
