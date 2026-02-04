import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET /api/marketing/segments/[id] - Get single segment
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    const segment = await queryOne('SELECT * FROM marketing_segments WHERE id = $1', [id])

    if (!segment) {
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
    }

    return NextResponse.json({ segment })
  } catch (error) {
    console.error('Error fetching segment:', error)
    return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 })
  }
}

// PUT /api/marketing/segments/[id] - Update segment
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    const body = await request.json()
    
    // Don't allow editing system segments
    const existing = await queryOne<any>('SELECT type FROM marketing_segments WHERE id = $1', [id])
    if (!existing) {
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
    }
    if (existing.type === 'system') {
      return NextResponse.json({ error: 'Cannot edit system segments' }, { status: 400 })
    }
    
    const segment = await queryOne(`
      UPDATE marketing_segments 
      SET 
        name = COALESCE($1, name),
        description = $2,
        conditions = COALESCE($3, conditions),
        is_dynamic = COALESCE($4, is_dynamic),
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [
      body.name,
      body.description || null,
      JSON.stringify(body.conditions || []),
      body.is_dynamic,
      id
    ])

    return NextResponse.json({ segment })
  } catch (error) {
    console.error('Error updating segment:', error)
    return NextResponse.json({ error: 'Failed to update segment' }, { status: 500 })
  }
}

// DELETE /api/marketing/segments/[id] - Delete segment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    // Don't allow deleting system segments
    const existing = await queryOne<any>('SELECT type FROM marketing_segments WHERE id = $1', [id])
    if (!existing) {
      return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
    }
    if (existing.type === 'system') {
      return NextResponse.json({ error: 'Cannot delete system segments' }, { status: 400 })
    }
    
    // Check if segment is used in any campaigns
    const usedInCampaign = await queryOne(
      'SELECT id FROM marketing_campaigns WHERE segment_id = $1 LIMIT 1',
      [id]
    )
    
    if (usedInCampaign) {
      return NextResponse.json({ 
        error: 'Cannot delete segment that is used in campaigns' 
      }, { status: 400 })
    }
    
    await query('DELETE FROM marketing_segments WHERE id = $1', [id])
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting segment:', error)
    return NextResponse.json({ error: 'Failed to delete segment' }, { status: 500 })
  }
}
