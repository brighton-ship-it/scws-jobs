import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { logCommunication, logCall, logNote } from '@/lib/communications'
import type { Communication, CommunicationType, CommunicationDirection } from '@/types/database'

interface GetParams {
  customerId?: string
  jobId?: string
  type?: CommunicationType
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}

// GET /api/communications - Get communications with filters
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const customerId = searchParams.get('customerId')
    const jobId = searchParams.get('jobId')
    const type = searchParams.get('type') as CommunicationType | null
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = parseInt(searchParams.get('offset') || '0')

    if (!customerId) {
      return NextResponse.json(
        { error: 'customerId is required' },
        { status: 400 }
      )
    }

    // Build query with filters
    let sql = `
      SELECT 
        c.*,
        u.name as sent_by_name,
        u.email as sent_by_email
      FROM communications c
      LEFT JOIN users u ON c.sent_by = u.id
      WHERE c.customer_id = $1
    `
    const params: any[] = [customerId]
    let paramIndex = 2

    if (jobId) {
      sql += ` AND c.job_id = $${paramIndex}`
      params.push(jobId)
      paramIndex++
    }

    if (type) {
      sql += ` AND c.type = $${paramIndex}`
      params.push(type)
      paramIndex++
    }

    if (startDate) {
      sql += ` AND c.sent_at >= $${paramIndex}`
      params.push(startDate)
      paramIndex++
    }

    if (endDate) {
      sql += ` AND c.sent_at <= $${paramIndex}`
      params.push(endDate)
      paramIndex++
    }

    sql += ` ORDER BY c.sent_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`
    params.push(limit, offset)

    const communications = await query(sql, params)

    // Get total count
    let countSql = `SELECT COUNT(*) as total FROM communications WHERE customer_id = $1`
    const countParams: any[] = [customerId]
    let countParamIndex = 2

    if (jobId) {
      countSql += ` AND job_id = $${countParamIndex}`
      countParams.push(jobId)
      countParamIndex++
    }

    if (type) {
      countSql += ` AND type = $${countParamIndex}`
      countParams.push(type)
      countParamIndex++
    }

    if (startDate) {
      countSql += ` AND sent_at >= $${countParamIndex}`
      countParams.push(startDate)
      countParamIndex++
    }

    if (endDate) {
      countSql += ` AND sent_at <= $${countParamIndex}`
      countParams.push(endDate)
    }

    const countResult = await query<{ total: string }>(countSql, countParams)
    const total = parseInt(countResult[0]?.total || '0')

    return NextResponse.json({
      communications,
      total,
      limit,
      offset,
    })
  } catch (error: any) {
    console.error('[Communications API] Error fetching:', error)
    return NextResponse.json(
      { error: 'Failed to fetch communications', details: error.message },
      { status: 500 }
    )
  }
}

// POST /api/communications - Create a new communication (manual log)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { customerId, jobId, type, direction, subject, content, sentBy, phone, duration } = body

    if (!customerId || !type || !content) {
      return NextResponse.json(
        { error: 'customerId, type, and content are required' },
        { status: 400 }
      )
    }

    let id: string | null = null

    // Use appropriate helper based on type
    if (type === 'call') {
      id = await logCall({
        customerId,
        jobId,
        direction: direction || 'outbound',
        notes: content,
        duration,
        sentBy,
      })
    } else if (type === 'note') {
      id = await logNote({
        customerId,
        jobId,
        note: content,
        sentBy,
      })
    } else {
      // Generic communication log for email/sms manual entries
      id = await logCommunication({
        customerId,
        jobId,
        type,
        direction: direction || 'outbound',
        subject,
        body: content,
        sentBy,
        metadata: { phone, manual: true }
      })
    }

    if (!id) {
      return NextResponse.json(
        { error: 'Failed to create communication' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    console.error('[Communications API] Error creating:', error)
    return NextResponse.json(
      { error: 'Failed to create communication', details: error.message },
      { status: 500 }
    )
  }
}
