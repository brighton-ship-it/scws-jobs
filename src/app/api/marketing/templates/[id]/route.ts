import { NextRequest, NextResponse } from 'next/server'
import { query, queryOne } from '@/lib/db'

// GET /api/marketing/templates/[id] - Get single template
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    const template = await queryOne('SELECT * FROM marketing_templates WHERE id = $1', [id])

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ template })
  } catch (error) {
    console.error('Error fetching template:', error)
    return NextResponse.json({ error: 'Failed to fetch template' }, { status: 500 })
  }
}

// PUT /api/marketing/templates/[id] - Update template
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    const body = await request.json()
    
    const template = await queryOne(`
      UPDATE marketing_templates 
      SET 
        name = COALESCE($1, name),
        type = COALESCE($2, type),
        category = COALESCE($3, category),
        subject = $4,
        content = COALESCE($5, content),
        variables = COALESCE($6, variables),
        updated_at = NOW()
      WHERE id = $7
      RETURNING *
    `, [
      body.name,
      body.type,
      body.category,
      body.subject || null,
      body.content,
      JSON.stringify(body.variables || []),
      id
    ])

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ template })
  } catch (error) {
    console.error('Error updating template:', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

// DELETE /api/marketing/templates/[id] - Delete template
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  
  try {
    // Check if template is used in any campaigns
    const usedInCampaign = await queryOne(
      'SELECT id FROM marketing_campaigns WHERE template_id = $1 LIMIT 1',
      [id]
    )
    
    if (usedInCampaign) {
      return NextResponse.json({ 
        error: 'Cannot delete template that is used in campaigns' 
      }, { status: 400 })
    }
    
    const result = await query('DELETE FROM marketing_templates WHERE id = $1 RETURNING id', [id])
    
    if (result.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json({ error: 'Failed to delete template' }, { status: 500 })
  }
}
