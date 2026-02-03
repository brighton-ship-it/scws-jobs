'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft,
  Zap,
  MessageSquare,
  Mail,
  Clock,
  Edit,
  Trash2,
  Plus,
  CheckCircle,
  Star,
  FileText,
  Calendar,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Automation, AutomationTrigger, MessageType, TEMPLATE_VARIABLES, TRIGGER_LABELS } from '@/types/automations'

const triggerLabels: Record<AutomationTrigger, { label: string; icon: any }> = {
  'job_completed': { label: 'Job Completed', icon: CheckCircle },
  'invoice_sent': { label: 'Invoice Sent', icon: FileText },
  'invoice_paid': { label: 'Payment Received', icon: CheckCircle },
  'quote_sent': { label: 'Quote Sent', icon: FileText },
  'quote_approved': { label: 'Quote Approved', icon: CheckCircle },
  'appointment_scheduled': { label: 'Appointment Scheduled', icon: Calendar },
  'custom': { label: 'Custom Trigger', icon: Zap },
}

const templateVariables: Record<AutomationTrigger, string[]> = {
  appointment_scheduled: ['customer_name', 'date', 'time', 'address', 'service_type', 'tech_name'],
  job_completed: ['customer_name', 'service_type', 'address', 'tech_name', 'job_number'],
  quote_sent: ['customer_name', 'service_type', 'amount', 'quote_number', 'valid_until'],
  quote_approved: ['customer_name', 'service_type', 'amount', 'quote_number'],
  invoice_sent: ['customer_name', 'invoice_number', 'amount', 'due_date', 'payment_link'],
  invoice_paid: ['customer_name', 'invoice_number', 'amount', 'payment_method'],
  custom: ['customer_name'],
}

function formatDelay(hours: number) {
  if (hours < 0) return `${Math.abs(hours)} hours before`
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} after`
  const days = Math.floor(hours / 24)
  return `${days} day${days !== 1 ? 's' : ''} after`
}

interface FormData {
  name: string
  description: string
  trigger: AutomationTrigger
  delay_hours: number
  delay_unit: 'hours' | 'days'
  message_type: MessageType
  message_template: string
  email_subject: string
}

const defaultFormData: FormData = {
  name: '',
  description: '',
  trigger: 'job_completed',
  delay_hours: 24,
  delay_unit: 'hours',
  message_type: 'sms',
  message_template: '',
  email_subject: '',
}

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteOpen, setIsDeleteOpen] = useState(false)
  const [selectedAutomation, setSelectedAutomation] = useState<Automation | null>(null)
  const [formData, setFormData] = useState<FormData>(defaultFormData)
  const [saving, setSaving] = useState(false)

  // Fetch automations on mount
  useEffect(() => {
    fetchAutomations()
  }, [])

  async function fetchAutomations() {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/automations')
      if (!res.ok) throw new Error('Failed to fetch automations')
      const data = await res.json()
      setAutomations(data.automations || [])
    } catch (err) {
      setError('Failed to load automations')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function toggleAutomation(id: string, isActive: boolean) {
    try {
      const res = await fetch(`/api/automations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setAutomations(prev =>
        prev.map(a => a.id === id ? { ...a, is_active: !isActive } : a)
      )
    } catch (err) {
      console.error('Failed to toggle automation:', err)
    }
  }

  async function handleCreate() {
    try {
      setSaving(true)
      const delayHours = formData.delay_unit === 'days' 
        ? formData.delay_hours * 24 
        : formData.delay_hours
      
      // Handle negative delay for appointment reminders
      const finalDelay = formData.trigger === 'appointment_scheduled' 
        ? -Math.abs(delayHours) 
        : Math.abs(delayHours)

      const res = await fetch('/api/automations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          trigger: formData.trigger,
          delay_hours: finalDelay,
          message_type: formData.message_type,
          message_template: formData.message_template,
          email_subject: formData.email_subject || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to create automation')
      
      const { automation } = await res.json()
      setAutomations(prev => [automation, ...prev])
      setIsCreateOpen(false)
      setFormData(defaultFormData)
    } catch (err) {
      console.error('Failed to create automation:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleEdit() {
    if (!selectedAutomation) return
    try {
      setSaving(true)
      const delayHours = formData.delay_unit === 'days' 
        ? formData.delay_hours * 24 
        : formData.delay_hours
      
      const finalDelay = formData.trigger === 'appointment_scheduled' 
        ? -Math.abs(delayHours) 
        : Math.abs(delayHours)

      const res = await fetch(`/api/automations/${selectedAutomation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || null,
          trigger: formData.trigger,
          delay_hours: finalDelay,
          message_type: formData.message_type,
          message_template: formData.message_template,
          email_subject: formData.email_subject || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to update automation')
      
      const { automation } = await res.json()
      setAutomations(prev =>
        prev.map(a => a.id === automation.id ? automation : a)
      )
      setIsEditOpen(false)
      setSelectedAutomation(null)
      setFormData(defaultFormData)
    } catch (err) {
      console.error('Failed to update automation:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedAutomation) return
    try {
      const res = await fetch(`/api/automations/${selectedAutomation.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete')
      setAutomations(prev => prev.filter(a => a.id !== selectedAutomation.id))
      setIsDeleteOpen(false)
      setSelectedAutomation(null)
    } catch (err) {
      console.error('Failed to delete automation:', err)
    }
  }

  function openEdit(automation: Automation) {
    const absDelay = Math.abs(automation.delay_hours)
    const isDay = absDelay >= 24 && absDelay % 24 === 0
    setFormData({
      name: automation.name,
      description: automation.description || '',
      trigger: automation.trigger,
      delay_hours: isDay ? absDelay / 24 : absDelay,
      delay_unit: isDay ? 'days' : 'hours',
      message_type: automation.message_type,
      message_template: automation.message_template,
      email_subject: automation.email_subject || '',
    })
    setSelectedAutomation(automation)
    setIsEditOpen(true)
  }

  function openDelete(automation: Automation) {
    setSelectedAutomation(automation)
    setIsDeleteOpen(true)
  }

  const stats = {
    active: automations.filter(a => a.is_active).length,
    totalSent: automations.reduce((sum, a) => sum + (a.sent_count || 0), 0),
  }

  const availableVariables = templateVariables[formData.trigger] || []

  const AutomationForm = ({ onSubmit, submitLabel }: { onSubmit: () => void; submitLabel: string }) => (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label>Name</Label>
        <Input 
          placeholder="e.g., Post-Service Follow Up"
          value={formData.name}
          onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
        />
      </div>
      <div className="grid gap-2">
        <Label>Description (optional)</Label>
        <Input 
          placeholder="Brief description of what this automation does"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
        />
      </div>
      <div className="grid gap-2">
        <Label>Trigger Event</Label>
        <Select 
          value={formData.trigger}
          onValueChange={(v) => setFormData(prev => ({ ...prev, trigger: v as AutomationTrigger }))}
        >
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
          <Label>
            {formData.trigger === 'appointment_scheduled' ? 'Send Before' : 'Delay'}
          </Label>
          <Input 
            type="number" 
            min="1"
            value={formData.delay_hours}
            onChange={(e) => setFormData(prev => ({ ...prev, delay_hours: parseInt(e.target.value) || 1 }))}
          />
        </div>
        <div className="grid gap-2">
          <Label>Unit</Label>
          <Select 
            value={formData.delay_unit}
            onValueChange={(v) => setFormData(prev => ({ ...prev, delay_unit: v as 'hours' | 'days' }))}
          >
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
        <Select 
          value={formData.message_type}
          onValueChange={(v) => setFormData(prev => ({ ...prev, message_type: v as MessageType }))}
        >
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
      {(formData.message_type === 'email' || formData.message_type === 'both') && (
        <div className="grid gap-2">
          <Label>Email Subject</Label>
          <Input 
            placeholder="e.g., Your Quote from SCWS"
            value={formData.email_subject}
            onChange={(e) => setFormData(prev => ({ ...prev, email_subject: e.target.value }))}
          />
        </div>
      )}
      <div className="grid gap-2">
        <Label>Message</Label>
        <Textarea 
          placeholder="Hi {{customer_name}}, ..."
          rows={4}
          value={formData.message_template}
          onChange={(e) => setFormData(prev => ({ ...prev, message_template: e.target.value }))}
        />
        <p className="text-xs text-muted-foreground">
          Variables: {availableVariables.map(v => `{{${v}}}`).join(', ')}
        </p>
      </div>
    </div>
  )

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
            <Button onClick={() => setFormData(defaultFormData)}>
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
            <AutomationForm onSubmit={handleCreate} submitLabel="Create" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving || !formData.name || !formData.message_template}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Automation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-500" />
          <span className="text-red-700">{error}</span>
          <Button variant="outline" size="sm" className="ml-auto" onClick={fetchAutomations}>
            Retry
          </Button>
        </div>
      )}

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
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground">Tracking coming soon</p>
          </CardContent>
        </Card>
      </div>

      {/* Automations List */}
      <Card>
        <CardContent className="p-0">
          {automations.length === 0 ? (
            <div className="p-8 text-center">
              <Zap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-semibold mb-2">No automations yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first automation to start sending automatic messages
              </p>
              <Button onClick={() => setIsCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Automation
              </Button>
            </div>
          ) : (
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
                            ) : automation.message_type === 'email' ? (
                              <Mail className="h-3 w-3" />
                            ) : (
                              <>
                                <MessageSquare className="h-3 w-3" />
                                <Mail className="h-3 w-3" />
                              </>
                            )}
                            {automation.message_type.toUpperCase()}
                          </Badge>
                        </div>
                        {automation.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {automation.description}
                          </p>
                        )}
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
                            {automation.sent_count || 0} sent
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Switch
                        checked={automation.is_active}
                        onCheckedChange={() => toggleAutomation(automation.id, automation.is_active)}
                      />
                      <Button variant="ghost" size="icon" onClick={() => openEdit(automation)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => openDelete(automation)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Automation</DialogTitle>
            <DialogDescription>
              Update the automation settings
            </DialogDescription>
          </DialogHeader>
          <AutomationForm onSubmit={handleEdit} submitLabel="Save" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={saving || !formData.name || !formData.message_template}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Automation</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedAutomation?.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
