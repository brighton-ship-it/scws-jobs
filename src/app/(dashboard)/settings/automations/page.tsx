'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft,
  Zap,
  MessageSquare,
  Mail,
  Clock,
  Play,
  Pause,
  Edit,
  Trash2,
  Plus,
  CheckCircle,
  Star,
  FileText,
  Calendar
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Mock automation rules
const mockAutomations = [
  {
    id: '1',
    name: 'Post-Service Review Request',
    description: 'Ask for Google review 24 hours after job completion',
    trigger: 'job_completed',
    delay_hours: 24,
    message_type: 'sms',
    message: 'Hi {{customer_name}}! Thanks for choosing Southern California Well Service. Leave us a review: https://g.page/r/scwellservice/review',
    is_active: true,
    sent_count: 156,
    last_sent: '2026-02-02T14:30:00',
  },
  {
    id: '2',
    name: 'Quote Follow-Up',
    description: 'Follow up on quotes after 3 days if not approved',
    trigger: 'quote_sent',
    delay_hours: 72,
    message_type: 'sms',
    message: 'Hi {{customer_name}}, following up on the quote we sent for {{service_type}}. Questions? (760) 440-8520',
    is_active: true,
    sent_count: 89,
    last_sent: '2026-02-01T10:15:00',
  },
  {
    id: '3',
    name: 'Payment Confirmation',
    description: 'Thank customer after payment received',
    trigger: 'invoice_paid',
    delay_hours: 1,
    message_type: 'sms',
    message: 'Hi {{customer_name}}, we received your payment of ${{amount}}. Thank you! - Southern California Well Service',
    is_active: true,
    sent_count: 234,
    last_sent: '2026-02-02T16:45:00',
  },
  {
    id: '4',
    name: 'Appointment Reminder',
    description: 'Remind customer day before appointment',
    trigger: 'appointment_scheduled',
    delay_hours: -24,
    message_type: 'sms',
    message: 'Reminder: Your well service appointment is tomorrow at {{time}}. Our tech will call when on the way. Questions? (760) 440-8520',
    is_active: true,
    sent_count: 312,
    last_sent: '2026-02-02T09:00:00',
  },
  {
    id: '5',
    name: 'Annual Maintenance Reminder',
    description: 'Remind customers about annual well inspection',
    trigger: 'custom',
    delay_hours: 8760, // 1 year
    message_type: 'email',
    message: 'It\'s been a year since your last well inspection. Schedule your annual checkup to prevent costly repairs.',
    is_active: false,
    sent_count: 45,
    last_sent: '2026-01-15T10:00:00',
  },
]

const triggerLabels: Record<string, { label: string; icon: any }> = {
  'job_completed': { label: 'Job Completed', icon: CheckCircle },
  'invoice_sent': { label: 'Invoice Sent', icon: FileText },
  'invoice_paid': { label: 'Payment Received', icon: CheckCircle },
  'quote_sent': { label: 'Quote Sent', icon: FileText },
  'quote_approved': { label: 'Quote Approved', icon: CheckCircle },
  'appointment_scheduled': { label: 'Appointment Scheduled', icon: Calendar },
  'custom': { label: 'Custom Trigger', icon: Zap },
}

function formatDelay(hours: number) {
  if (hours < 0) return `${Math.abs(hours)} hours before`
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} after`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''} after`
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState(mockAutomations)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const toggleAutomation = (id: string) => {
    setAutomations(prev => 
      prev.map(a => a.id === id ? {...a, is_active: !a.is_active} : a)
    )
  }

  const stats = {
    active: automations.filter(a => a.is_active).length,
    totalSent: automations.reduce((sum, a) => sum + a.sent_count, 0),
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/settings">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Automations</h1>
            <p className="text-muted-foreground">
              Automated follow-ups, reminders, and notifications
            </p>
          </div>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Automation
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Create Automation</DialogTitle>
              <DialogDescription>
                Set up an automated message triggered by an event
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Name</Label>
                <Input placeholder="e.g., Post-Service Follow Up" />
              </div>
              <div className="grid gap-2">
                <Label>Trigger Event</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="When should this send?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="job_completed">Job Completed</SelectItem>
                    <SelectItem value="invoice_sent">Invoice Sent</SelectItem>
                    <SelectItem value="invoice_paid">Payment Received</SelectItem>
                    <SelectItem value="quote_sent">Quote Sent</SelectItem>
                    <SelectItem value="appointment_scheduled">Appointment Scheduled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Delay</Label>
                  <Input type="number" placeholder="24" />
                </div>
                <div className="grid gap-2">
                  <Label>Unit</Label>
                  <Select defaultValue="hours">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hours">Hours</SelectItem>
                      <SelectItem value="days">Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Send Via</Label>
                <Select defaultValue="sms">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Message</Label>
                <Textarea 
                  placeholder="Hi {{customer_name}}, ..."
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Variables: {'{{customer_name}}, {{service_type}}, {{amount}}, {{time}}'}
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setIsCreateOpen(false)}>
                Create Automation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Automations</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
            <p className="text-xs text-muted-foreground">Running automatically</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages Sent</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalSent}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Reviews Generated</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">47</div>
            <p className="text-xs text-muted-foreground">From automated requests</p>
          </CardContent>
        </Card>
      </div>

      {/* Automations List */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {automations.map((automation) => {
              const TriggerIcon = triggerLabels[automation.trigger]?.icon || Zap
              return (
                <div 
                  key={automation.id}
                  className="flex items-center justify-between p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-full ${automation.is_active ? 'bg-green-100' : 'bg-gray-100'}`}>
                      <Zap className={`h-5 w-5 ${automation.is_active ? 'text-green-600' : 'text-gray-400'}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{automation.name}</h4>
                        <Badge variant={automation.is_active ? 'default' : 'secondary'}>
                          {automation.is_active ? 'Active' : 'Paused'}
                        </Badge>
                        <Badge variant="outline" className="gap-1">
                          {automation.message_type === 'sms' ? (
                            <MessageSquare className="h-3 w-3" />
                          ) : (
                            <Mail className="h-3 w-3" />
                          )}
                          {automation.message_type.toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {automation.description}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <TriggerIcon className="h-3 w-3" />
                          {triggerLabels[automation.trigger]?.label}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDelay(automation.delay_hours)}
                        </span>
                        <span>
                          {automation.sent_count} sent
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Switch
                      checked={automation.is_active}
                      onCheckedChange={() => toggleAutomation(automation.id)}
                    />
                    <Button variant="ghost" size="icon">
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
