// Communication logging helper
import { query } from './db'
import type { CommunicationType, CommunicationDirection } from '@/types/database'

interface LogCommunicationParams {
  customerId: string
  jobId?: string | null
  type: CommunicationType
  direction: CommunicationDirection
  subject?: string | null
  body: string
  sentBy?: string | null
  metadata?: Record<string, any>
}

/**
 * Log a communication to the database
 */
export async function logCommunication(params: LogCommunicationParams): Promise<string | null> {
  try {
    const result = await query<{ id: string }>(`
      INSERT INTO communications (customer_id, job_id, type, direction, subject, body, sent_by, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      params.customerId,
      params.jobId || null,
      params.type,
      params.direction,
      params.subject || null,
      params.body,
      params.sentBy || null,
      JSON.stringify(params.metadata || {})
    ])
    
    return result[0]?.id || null
  } catch (error) {
    console.error('[Communications] Failed to log communication:', error)
    return null
  }
}

/**
 * Log an outbound SMS
 */
export async function logSMS(params: {
  customerId: string
  jobId?: string | null
  message: string
  phone: string
  sentBy?: string | null
  messageId?: string
}) {
  return logCommunication({
    customerId: params.customerId,
    jobId: params.jobId,
    type: 'sms',
    direction: 'outbound',
    body: params.message,
    sentBy: params.sentBy,
    metadata: {
      phone: params.phone,
      messageId: params.messageId,
    }
  })
}

/**
 * Log an outbound email
 */
export async function logEmail(params: {
  customerId: string
  jobId?: string | null
  subject: string
  body: string
  email: string
  sentBy?: string | null
  messageId?: string
}) {
  return logCommunication({
    customerId: params.customerId,
    jobId: params.jobId,
    type: 'email',
    direction: 'outbound',
    subject: params.subject,
    body: params.body,
    sentBy: params.sentBy,
    metadata: {
      email: params.email,
      messageId: params.messageId,
    }
  })
}

/**
 * Log a phone call
 */
export async function logCall(params: {
  customerId: string
  jobId?: string | null
  direction: CommunicationDirection
  notes: string
  duration?: number
  sentBy?: string | null
}) {
  return logCommunication({
    customerId: params.customerId,
    jobId: params.jobId,
    type: 'call',
    direction: params.direction,
    subject: params.direction === 'inbound' ? 'Incoming Call' : 'Outgoing Call',
    body: params.notes,
    sentBy: params.sentBy,
    metadata: {
      duration: params.duration,
    }
  })
}

/**
 * Log a note
 */
export async function logNote(params: {
  customerId: string
  jobId?: string | null
  note: string
  sentBy?: string | null
}) {
  return logCommunication({
    customerId: params.customerId,
    jobId: params.jobId,
    type: 'note',
    direction: 'outbound',
    subject: 'Internal Note',
    body: params.note,
    sentBy: params.sentBy,
  })
}
