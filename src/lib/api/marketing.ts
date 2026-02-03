// Marketing API client functions

export interface Campaign {
  id: string
  name: string
  type: 'email' | 'sms'
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'cancelled'
  template_id?: string
  subject?: string
  content: string
  segment_id?: string
  recipient_count: number
  scheduled_for?: string
  sent_at?: string
  completed_at?: string
  delivered: number
  opened: number
  clicked: number
  bounced: number
  unsubscribed: number
  replied: number
  created_at: string
  updated_at: string
  segment?: Segment
  template?: Template
}

export interface Template {
  id: string
  name: string
  type: 'email' | 'sms'
  category: 'reminders' | 'follow-ups' | 'promotions' | 'transactional'
  subject?: string
  content: string
  variables: string[]
  times_used: number
  last_used_at?: string
  created_at: string
}

export interface Segment {
  id: string
  name: string
  description?: string
  type: 'system' | 'custom' | 'location' | 'service' | 'dynamic'
  conditions: SegmentCondition[]
  customer_count: number
  is_dynamic: boolean
  created_at: string
}

export interface SegmentCondition {
  field: string
  operator: string
  value: string
}

// Campaigns
export async function getCampaigns(params?: { 
  status?: string
  type?: string 
  limit?: number
  offset?: number
}): Promise<{ campaigns: Campaign[], total: number }> {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.type) searchParams.set('type', params.type)
  if (params?.limit) searchParams.set('limit', params.limit.toString())
  if (params?.offset) searchParams.set('offset', params.offset.toString())
  
  const res = await fetch(`/api/marketing/campaigns?${searchParams}`)
  if (!res.ok) throw new Error('Failed to fetch campaigns')
  return res.json()
}

export async function createCampaign(data: Partial<Campaign>): Promise<{ campaign: Campaign }> {
  const res = await fetch('/api/marketing/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create campaign')
  return res.json()
}

export async function sendCampaign(id: string): Promise<{ success: boolean, recipients: number }> {
  const res = await fetch(`/api/marketing/campaigns/${id}/send`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to send campaign')
  return res.json()
}

// Templates
export async function getTemplates(params?: { 
  type?: string
  category?: string 
}): Promise<{ templates: Template[] }> {
  const searchParams = new URLSearchParams()
  if (params?.type) searchParams.set('type', params.type)
  if (params?.category) searchParams.set('category', params.category)
  
  const res = await fetch(`/api/marketing/templates?${searchParams}`)
  if (!res.ok) throw new Error('Failed to fetch templates')
  return res.json()
}

export async function createTemplate(data: Partial<Template>): Promise<{ template: Template }> {
  const res = await fetch('/api/marketing/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create template')
  return res.json()
}

// Segments
export async function getSegments(params?: { 
  type?: string 
}): Promise<{ segments: Segment[] }> {
  const searchParams = new URLSearchParams()
  if (params?.type) searchParams.set('type', params.type)
  
  const res = await fetch(`/api/marketing/segments?${searchParams}`)
  if (!res.ok) throw new Error('Failed to fetch segments')
  return res.json()
}

export async function createSegment(data: Partial<Segment>): Promise<{ segment: Segment }> {
  const res = await fetch('/api/marketing/segments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create segment')
  return res.json()
}

// Stats helper
export function calculateCampaignStats(campaigns: Campaign[]) {
  const totalCampaigns = campaigns.length
  const totalSent = campaigns.reduce((sum, c) => sum + (c.delivered || 0), 0)
  
  const emailCampaigns = campaigns.filter(c => c.type === 'email' && c.status === 'sent')
  const avgOpenRate = emailCampaigns.length > 0
    ? emailCampaigns.reduce((sum, c) => {
        const rate = c.recipient_count > 0 ? (c.opened / c.recipient_count) * 100 : 0
        return sum + rate
      }, 0) / emailCampaigns.length
    : 0
  
  const avgClickRate = emailCampaigns.length > 0
    ? emailCampaigns.reduce((sum, c) => {
        const rate = c.recipient_count > 0 ? (c.clicked / c.recipient_count) * 100 : 0
        return sum + rate
      }, 0) / emailCampaigns.length
    : 0

  return {
    totalCampaigns,
    totalSent,
    avgOpenRate: Math.round(avgOpenRate * 10) / 10,
    avgClickRate: Math.round(avgClickRate * 10) / 10,
  }
}
