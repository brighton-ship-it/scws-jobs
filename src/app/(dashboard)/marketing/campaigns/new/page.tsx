'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { 
  Mail, 
  MessageSquare, 
  ArrowLeft,
  Send,
  Clock,
  Save,
  Users,
  Eye,
  Calendar,
  AlertCircle,
  Loader2
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { toast } from 'sonner'

interface Segment {
  id: string
  name: string
  customer_count: number
}

interface Template {
  id: string
  name: string
  type: 'email' | 'sms'
  subject?: string
  content: string
}

export default function NewCampaignPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialType = (searchParams.get('type') || 'email') as 'email' | 'sms'

  const [type, setType] = useState<'email' | 'sms'>(initialType)
  const [name, setName] = useState('')
  const [segmentId, setSegmentId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  
  const [segments, setSegments] = useState<Segment[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null)
  
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')

  // Load segments, templates, and check provider status
  useEffect(() => {
    async function loadData() {
      setLoading(true)
      try {
        const [segRes, tplRes, statusRes] = await Promise.all([
          fetch('/api/marketing/segments'),
          fetch('/api/marketing/templates'),
          fetch('/api/marketing/status'),
        ])
        
        if (segRes.ok) {
          const data = await segRes.json()
          setSegments(data.segments || [])
        }
        
        if (tplRes.ok) {
          const data = await tplRes.json()
          setTemplates(data.templates || [])
        }
        
        if (statusRes.ok) {
          const status = await statusRes.json()
          setProviderConfigured(type === 'sms' ? status.smsReady : status.emailReady)
        }
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setLoading(false)
      }
    }
    
    loadData()
  }, [type])

  const selectedSegment = segments.find(s => s.id === segmentId)
  const recipientCount = selectedSegment?.customer_count || 0
  const filteredTemplates = templates.filter(t => t.type === type)

  const handleTemplateSelect = (id: string) => {
    setTemplateId(id)
    const selected = templates.find(t => t.id === id)
    if (selected) {
      if (selected.subject) setSubject(selected.subject)
      if (selected.content) setContent(selected.content)
    }
  }

  const handleSaveDraft = async () => {
    if (!name.trim()) {
      toast.error('Please enter a campaign name')
      return
    }
    
    setSaving(true)
    try {
      const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          type,
          status: 'draft',
          subject: type === 'email' ? subject : null,
          content,
          segment_id: segmentId || null,
          template_id: templateId || null,
          recipient_count: recipientCount,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save campaign')
      }
      
      toast.success('Campaign saved as draft')
      router.push('/marketing')
    } catch (error: any) {
      toast.error(error.message || 'Failed to save campaign')
    } finally {
      setSaving(false)
    }
  }

  const handleSendNow = async () => {
    if (!segmentId) {
      toast.error('Please select a recipient segment')
      return
    }
    if (!content.trim()) {
      toast.error('Please enter message content')
      return
    }
    
    setSending(true)
    try {
      // First create the campaign
      const createRes = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || `${type === 'email' ? 'Email' : 'SMS'} Campaign - ${new Date().toLocaleDateString()}`,
          type,
          status: 'draft',
          subject: type === 'email' ? subject : null,
          content,
          segment_id: segmentId,
          template_id: templateId || null,
          recipient_count: recipientCount,
        }),
      })
      
      if (!createRes.ok) {
        const data = await createRes.json()
        throw new Error(data.error || 'Failed to create campaign')
      }
      
      const { campaign } = await createRes.json()
      
      // Then send it
      const sendRes = await fetch(`/api/marketing/campaigns/${campaign.id}/send`, {
        method: 'POST',
      })
      
      const sendData = await sendRes.json()
      
      if (!sendRes.ok) {
        throw new Error(sendData.error || 'Failed to send campaign')
      }
      
      toast.success(`Campaign sent! ${sendData.stats.sent} delivered, ${sendData.stats.failed} failed`)
      router.push('/marketing')
    } catch (error: any) {
      toast.error(error.message || 'Failed to send campaign')
    } finally {
      setSending(false)
      setShowSendConfirm(false)
    }
  }

  const handleSchedule = async () => {
    if (!scheduledDate || !scheduledTime) {
      toast.error('Please select a date and time')
      return
    }
    
    const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`).toISOString()
    
    setSaving(true)
    try {
      const res = await fetch('/api/marketing/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || `${type === 'email' ? 'Email' : 'SMS'} Campaign - ${new Date().toLocaleDateString()}`,
          type,
          status: 'scheduled',
          subject: type === 'email' ? subject : null,
          content,
          segment_id: segmentId,
          template_id: templateId || null,
          recipient_count: recipientCount,
          scheduled_for: scheduledFor,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to schedule campaign')
      }
      
      toast.success(`Campaign scheduled for ${new Date(scheduledFor).toLocaleString()}`)
      router.push('/marketing')
    } catch (error: any) {
      toast.error(error.message || 'Failed to schedule campaign')
    } finally {
      setSaving(false)
      setShowScheduleDialog(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/marketing">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">New Campaign</h1>
          <p className="text-muted-foreground">
            Create a new {type === 'email' ? 'email' : 'SMS'} campaign
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSaveDraft} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Draft
          </Button>
          <Button variant="outline" onClick={() => setShowScheduleDialog(true)} disabled={!segmentId || !content}>
            <Clock className="mr-2 h-4 w-4" />
            Schedule
          </Button>
          <Button onClick={() => setShowSendConfirm(true)} disabled={!segmentId || !content || sending}>
            {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Send Now
          </Button>
        </div>
      </div>

      {providerConfigured === false && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{type === 'sms' ? 'Twilio' : 'Resend'} Not Configured</AlertTitle>
          <AlertDescription>
            {type === 'sms' 
              ? 'SMS sending requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER environment variables.'
              : 'Email sending requires RESEND_API_KEY environment variable.'
            }
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Campaign Type */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign Type</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={type} onValueChange={(v) => setType(v as 'email' | 'sms')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="email">
                    <Mail className="mr-2 h-4 w-4" />
                    Email
                  </TabsTrigger>
                  <TabsTrigger value="sms">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    SMS
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardContent>
          </Card>

          {/* Campaign Details */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Campaign Name *</Label>
                <Input 
                  id="name" 
                  placeholder="e.g., February Maintenance Reminder"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Internal name for tracking - not shown to recipients
                </p>
              </div>

              <div className="grid gap-2">
                <Label>Template (Optional)</Label>
                <Select value={templateId} onValueChange={handleTemplateSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Start from template or blank" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Blank (no template)</SelectItem>
                    {filteredTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {type === 'email' && (
                <div className="grid gap-2">
                  <Label htmlFor="subject">Subject Line *</Label>
                  <Input 
                    id="subject" 
                    placeholder="e.g., It's time for your annual well inspection"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="content">
                  {type === 'email' ? 'Email Body' : 'Message'} *
                  <span className="text-muted-foreground text-xs ml-2">
                    Use {'{{variable}}'} for personalization
                  </span>
                </Label>
                <Textarea 
                  id="content" 
                  placeholder={type === 'email' 
                    ? "Hi {{customer_name}},\n\nWe wanted to reach out..."
                    : "SCWS: Hi {{customer_name}}, this is a reminder..."
                  }
                  rows={type === 'email' ? 12 : 4}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
                {type === 'sms' && (
                  <p className="text-xs text-muted-foreground">
                    {content.length}/160 characters (messages over 160 chars sent as multiple SMS)
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Recipients */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Recipients
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label>Target Segment *</Label>
                <Select value={segmentId} onValueChange={setSegmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a segment" />
                  </SelectTrigger>
                  <SelectContent>
                    {segments.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center justify-between w-full">
                          <span>{s.name}</span>
                          <Badge variant="secondary" className="ml-2">
                            {(s.customer_count || 0).toLocaleString()}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {segmentId && (
                <div className="p-4 bg-muted rounded-lg">
                  <div className="text-3xl font-bold">{recipientCount.toLocaleString()}</div>
                  <div className="text-sm text-muted-foreground">
                    {type === 'email' ? 'emails' : 'SMS messages'} will be sent
                  </div>
                </div>
              )}

              <Link href="/marketing/segments" className="text-sm text-primary hover:underline">
                Manage segments →
              </Link>
            </CardContent>
          </Card>

          {/* Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                Preview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setShowPreviewDialog(true)}
                disabled={!content}
              >
                Preview Message
              </Button>
              <p className="text-xs text-muted-foreground mt-2">
                See how your message will look with sample data
              </p>
            </CardContent>
          </Card>

          {/* Variables */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Available Variables</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-xs">
                <div><code className="bg-muted px-1 rounded">{'{{customer_name}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{first_name}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{address}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{city}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{last_service_date}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{phone}}'}</code></div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Schedule Dialog */}
      <Dialog open={showScheduleDialog} onOpenChange={setShowScheduleDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule Campaign</DialogTitle>
            <DialogDescription>
              Choose when to send this campaign
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="date">Date</Label>
              <Input 
                id="date" 
                type="date" 
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="time">Time</Label>
              <Input 
                id="time" 
                type="time" 
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowScheduleDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSchedule} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Calendar className="mr-2 h-4 w-4" />}
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Confirmation Dialog */}
      <Dialog open={showSendConfirm} onOpenChange={setShowSendConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Campaign Now?</DialogTitle>
            <DialogDescription>
              This will immediately send to all recipients in the selected segment.
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Confirm Send</AlertTitle>
            <AlertDescription>
              You are about to send {recipientCount.toLocaleString()} {type === 'email' ? 'emails' : 'SMS messages'} to the "{selectedSegment?.name}" segment. This action cannot be undone.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendConfirm(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSendNow} disabled={sending}>
              {sending ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...</>
              ) : (
                <><Send className="mr-2 h-4 w-4" /> Send Now</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Message Preview</DialogTitle>
            <DialogDescription>
              Preview with sample customer data
            </DialogDescription>
          </DialogHeader>
          <div className="border rounded-lg p-4 bg-muted/50">
            {type === 'email' ? (
              <div className="space-y-3">
                <div className="border-b pb-2">
                  <div className="text-sm text-muted-foreground">Subject:</div>
                  <div className="font-medium">
                    {subject
                      .replace(/\{\{customer_name\}\}/g, 'John Smith')
                      .replace(/\{\{first_name\}\}/g, 'John')
                    }
                  </div>
                </div>
                <div className="whitespace-pre-wrap text-sm">
                  {content
                    .replace(/\{\{customer_name\}\}/g, 'John Smith')
                    .replace(/\{\{first_name\}\}/g, 'John')
                    .replace(/\{\{address\}\}/g, '123 Main St, Ramona, CA')
                    .replace(/\{\{city\}\}/g, 'Ramona')
                    .replace(/\{\{last_service_date\}\}/g, 'January 15, 2025')
                    .replace(/\{\{phone\}\}/g, '(760) 555-1234')
                  }
                </div>
              </div>
            ) : (
              <div className="p-3 bg-green-100 rounded-lg max-w-[280px]">
                <div className="text-sm">
                  {content
                    .replace(/\{\{customer_name\}\}/g, 'John Smith')
                    .replace(/\{\{first_name\}\}/g, 'John')
                    .replace(/\{\{appointment_time\}\}/g, '10:00 AM')
                    .replace(/\{\{tech_name\}\}/g, 'Travis')
                  }
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setShowPreviewDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
