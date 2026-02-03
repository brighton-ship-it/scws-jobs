'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
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
  CheckCircle
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

interface Segment {
  id: string
  name: string
  customer_count: number
}

// Mock templates
const mockTemplates = {
  email: [
    { id: 'e1', name: 'Appointment Reminder - 24hr', subject: 'Reminder: Your well service appointment is tomorrow' },
    { id: 'e2', name: 'Quote Follow-up', subject: 'Following up on your well service quote' },
    { id: 'e3', name: 'Annual Maintenance Reminder', subject: "It's time for your annual well inspection" },
    { id: 'e4', name: 'Custom (blank)', subject: '' },
  ],
  sms: [
    { id: 's1', name: 'Appointment Reminder - 24hr', preview: 'SCWS Reminder: Your appointment is tomorrow...' },
    { id: 's2', name: 'Tech On The Way', preview: '{{tech_name}} from SCWS is on the way...' },
    { id: 's3', name: 'Quote Ready', preview: 'Your quote from SCWS is ready...' },
    { id: 's4', name: 'Custom (blank)', preview: '' },
  ],
}

export default function CampaignPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isNew = params.id === 'new'
  const campaignType = searchParams.get('type') || 'email'

  const [type, setType] = useState<'email' | 'sms'>(campaignType as 'email' | 'sms')
  const [name, setName] = useState('')
  const [segment, setSegment] = useState('')
  const [template, setTemplate] = useState('')
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [showScheduleDialog, setShowScheduleDialog] = useState(false)
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [showSendConfirm, setShowSendConfirm] = useState(false)
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [segments, setSegments] = useState<Segment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null)

  // Load segments and campaign data on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load segments
        const segRes = await fetch('/api/marketing/segments')
        if (segRes.ok) {
          const data = await segRes.json()
          setSegments(data.segments || [])
        }

        // Check provider status
        const statusRes = await fetch('/api/marketing/status')
        if (statusRes.ok) {
          const status = await statusRes.json()
          setProviderConfigured(type === 'sms' ? status.smsReady : status.emailReady)
        }

        // Load existing campaign if editing
        if (!isNew) {
          const campRes = await fetch(`/api/marketing/campaigns?limit=100`)
          if (campRes.ok) {
            const { campaigns } = await campRes.json()
            const campaign = campaigns.find((c: any) => c.id === params.id)
            if (campaign) {
              setName(campaign.name)
              setType(campaign.type)
              setSubject(campaign.subject || '')
              setContent(campaign.content || '')
              setSegment(campaign.segment?.id || '')
            }
          }
        }
      } catch (error) {
        console.error('Failed to load data:', error)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadData()
  }, [isNew, params.id, type])

  const selectedSegment = segments.find(s => s.id === segment)
  const recipientCount = selectedSegment?.customer_count || 0

  const handleTemplateSelect = (templateId: string) => {
    setTemplate(templateId)
    const templates = type === 'email' ? mockTemplates.email : mockTemplates.sms
    const selected = templates.find(t => t.id === templateId)
    if (selected && 'subject' in selected) {
      setSubject(selected.subject)
    }
  }

  const handleSaveDraft = async () => {
    try {
      if (isNew) {
        // Create new campaign
        const res = await fetch('/api/marketing/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name || `${type} Campaign - ${new Date().toLocaleDateString()}`,
            type,
            status: 'draft',
            subject: type === 'email' ? subject : null,
            content,
            segment_id: segment,
            recipient_count: recipientCount,
          }),
        })
        
        if (!res.ok) {
          throw new Error('Failed to save campaign')
        }
      } else {
        // Update existing campaign
        const res = await fetch(`/api/marketing/campaigns/${params.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            subject: type === 'email' ? subject : null,
            content,
            segment_id: segment,
            recipient_count: recipientCount,
          }),
        })
        
        if (!res.ok) {
          throw new Error('Failed to update campaign')
        }
      }
      
      router.push('/marketing')
    } catch (error: any) {
      console.error('Save error:', error)
      alert(`Failed to save: ${error.message}`)
    }
  }

  const handleSendNow = async () => {
    setIsSending(true)
    try {
      // First save/create the campaign if new
      let campaignIdToSend = params.id as string
      
      if (isNew) {
        // Create campaign first
        const createRes = await fetch('/api/marketing/campaigns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name || `${type} Campaign - ${new Date().toLocaleDateString()}`,
            type,
            status: 'draft',
            subject: type === 'email' ? subject : null,
            content,
            segment_id: segment,
            recipient_count: recipientCount,
          }),
        })
        
        if (!createRes.ok) {
          throw new Error('Failed to create campaign')
        }
        
        const { campaign } = await createRes.json()
        campaignIdToSend = campaign.id
      }

      // Send the campaign
      const sendRes = await fetch(`/api/marketing/campaigns/${campaignIdToSend}/send`, {
        method: 'POST',
      })
      
      const data = await sendRes.json()
      
      if (!sendRes.ok) {
        alert(`Failed to send: ${data.error}${data.details ? '\n' + data.details : ''}`)
        return
      }
      
      alert(`Campaign sent successfully!\n${data.stats.sent} delivered, ${data.stats.failed} failed`)
      router.push('/marketing')
    } catch (error: any) {
      console.error('Send error:', error)
      alert(`Failed to send campaign: ${error.message}`)
    } finally {
      setIsSending(false)
      setShowSendConfirm(false)
    }
  }

  const handleSchedule = () => {
    // TODO: Schedule via API
    console.log('Scheduling for', scheduledDate, scheduledTime)
    setShowScheduleDialog(false)
    router.push('/marketing')
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
          <h1 className="text-3xl font-bold tracking-tight">
            {isNew ? 'New Campaign' : 'Edit Campaign'}
          </h1>
          <p className="text-muted-foreground">
            {type === 'email' ? 'Email' : 'SMS'} campaign
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSaveDraft}>
            <Save className="mr-2 h-4 w-4" />
            Save Draft
          </Button>
          <Button variant="outline" onClick={() => setShowScheduleDialog(true)}>
            <Clock className="mr-2 h-4 w-4" />
            Schedule
          </Button>
          <Button onClick={() => setShowSendConfirm(true)} disabled={!segment || !content}>
            <Send className="mr-2 h-4 w-4" />
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
          {/* Campaign Type Toggle */}
          {isNew && (
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
          )}

          {/* Campaign Details */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Campaign Name</Label>
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
                <Select value={template} onValueChange={handleTemplateSelect}>
                  <SelectTrigger>
                    <SelectValue placeholder="Start from template or blank" />
                  </SelectTrigger>
                  <SelectContent>
                    {(type === 'email' ? mockTemplates.email : mockTemplates.sms).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {type === 'email' && (
                <div className="grid gap-2">
                  <Label htmlFor="subject">Subject Line</Label>
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
                  {type === 'email' ? 'Email Body' : 'Message'}
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
                <Label>Target Segment</Label>
                <Select value={segment} onValueChange={setSegment}>
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

              {segment && (
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

          {/* Available Variables */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Available Variables</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-xs">
                <div><code className="bg-muted px-1 rounded">{'{{customer_name}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{address}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{last_service_date}}'}</code></div>
                <div><code className="bg-muted px-1 rounded">{'{{phone}}'}</code></div>
                {type === 'email' && (
                  <div><code className="bg-muted px-1 rounded">{'{{unsubscribe_link}}'}</code></div>
                )}
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
            <Button onClick={handleSchedule}>
              <Calendar className="mr-2 h-4 w-4" />
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
            <Button variant="outline" onClick={() => setShowSendConfirm(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendNow} disabled={isSending}>
              {isSending ? (
                <>Sending...</>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Send Now
                </>
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
                    {subject.replace(/\{\{customer_name\}\}/g, 'John Smith')}
                  </div>
                </div>
                <div className="whitespace-pre-wrap text-sm">
                  {content
                    .replace(/\{\{customer_name\}\}/g, 'John Smith')
                    .replace(/\{\{address\}\}/g, '123 Main St, Ramona, CA')
                    .replace(/\{\{last_service_date\}\}/g, 'January 15, 2025')
                    .replace(/\{\{phone\}\}/g, '(760) 555-1234')
                  }
                </div>
              </div>
            ) : (
              <div className="p-3 bg-green-100 rounded-lg max-w-[280px]">
                <div className="text-sm">
                  {content
                    .replace(/\{\{customer_name\}\}/g, 'John')
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
