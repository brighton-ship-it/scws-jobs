'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Mail, 
  MessageSquare, 
  Plus, 
  Search,
  MoreVertical,
  Copy,
  Edit,
  Trash,
  Clock,
  Bell,
  Star,
  FileText,
  Loader2,
  AlertCircle
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

interface Template {
  id: string
  name: string
  type: 'email' | 'sms'
  category: string
  subject?: string
  content: string
  variables: string[]
  times_used: number
  last_used_at?: string
  created_at: string
  updated_at: string
}

const categoryIcons: Record<string, any> = {
  reminders: Clock,
  'follow-ups': Bell,
  promotions: Star,
  transactional: FileText,
}

const categoryLabels: Record<string, string> = {
  reminders: 'Reminders',
  'follow-ups': 'Follow-ups',
  promotions: 'Promotions',
  transactional: 'Transactional',
}

export default function TemplatesPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('email')
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Create dialog state
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newTemplateType, setNewTemplateType] = useState<'email' | 'sms'>('email')
  const [newTemplate, setNewTemplate] = useState({
    name: '',
    category: '',
    subject: '',
    content: '',
  })
  const [creating, setCreating] = useState(false)
  
  // Edit dialog state
  const [editTemplate, setEditTemplate] = useState<Template | null>(null)
  const [editData, setEditData] = useState({
    name: '',
    category: '',
    subject: '',
    content: '',
  })
  const [saving, setSaving] = useState(false)
  
  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Fetch templates
  useEffect(() => {
    async function fetchTemplates() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/marketing/templates')
        if (!res.ok) throw new Error('Failed to fetch templates')
        const data = await res.json()
        setTemplates(data.templates || [])
      } catch (err: any) {
        console.error('Error fetching templates:', err)
        setError(err.message || 'Failed to load templates')
      } finally {
        setLoading(false)
      }
    }
    fetchTemplates()
  }, [])

  // Extract variables from content
  const extractVariables = (content: string): string[] => {
    const matches = content.match(/\{\{(\w+)\}\}/g) || []
    return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))]
  }

  // Create template
  const handleCreate = async () => {
    if (!newTemplate.name || !newTemplate.category || !newTemplate.content) {
      toast.error('Please fill in all required fields')
      return
    }
    
    setCreating(true)
    try {
      const variables = extractVariables(newTemplate.content)
      const res = await fetch('/api/marketing/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newTemplate.name,
          type: newTemplateType,
          category: newTemplate.category,
          subject: newTemplateType === 'email' ? newTemplate.subject : null,
          content: newTemplate.content,
          variables,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create template')
      }
      
      const data = await res.json()
      setTemplates([data.template, ...templates])
      setIsCreateOpen(false)
      setNewTemplate({ name: '', category: '', subject: '', content: '' })
      toast.success('Template created')
    } catch (err: any) {
      toast.error(err.message || 'Failed to create template')
    } finally {
      setCreating(false)
    }
  }

  // Edit template
  const handleEdit = async () => {
    if (!editTemplate) return
    
    setSaving(true)
    try {
      const variables = extractVariables(editData.content)
      const res = await fetch(`/api/marketing/templates/${editTemplate.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editData.name,
          category: editData.category,
          subject: editTemplate.type === 'email' ? editData.subject : null,
          content: editData.content,
          variables,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update template')
      }
      
      const data = await res.json()
      setTemplates(templates.map(t => t.id === editTemplate.id ? data.template : t))
      setEditTemplate(null)
      toast.success('Template updated')
    } catch (err: any) {
      toast.error(err.message || 'Failed to update template')
    } finally {
      setSaving(false)
    }
  }

  // Delete template
  const handleDelete = async () => {
    if (!deleteId) return
    
    setDeleting(true)
    try {
      const res = await fetch(`/api/marketing/templates/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete template')
      }
      setTemplates(templates.filter(t => t.id !== deleteId))
      toast.success('Template deleted')
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete template')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  // Duplicate template
  const handleDuplicate = async (template: Template) => {
    try {
      const res = await fetch('/api/marketing/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${template.name} (Copy)`,
          type: template.type,
          category: template.category,
          subject: template.subject,
          content: template.content,
          variables: template.variables,
        }),
      })
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to duplicate template')
      }
      
      const data = await res.json()
      setTemplates([data.template, ...templates])
      toast.success('Template duplicated')
    } catch (err: any) {
      toast.error(err.message || 'Failed to duplicate template')
    }
  }

  const openEditDialog = (template: Template) => {
    setEditTemplate(template)
    setEditData({
      name: template.name,
      category: template.category,
      subject: template.subject || '',
      content: template.content,
    })
  }

  const currentTemplates = templates.filter(t => t.type === activeTab)
  const filteredTemplates = currentTemplates.filter(template =>
    template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    template.content.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Group by category
  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    if (!acc[template.category]) {
      acc[template.category] = []
    }
    acc[template.category].push(template)
    return acc
  }, {} as Record<string, Template[]>)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-muted-foreground">{error}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/marketing" className="text-muted-foreground hover:text-foreground">
              Marketing
            </Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="text-3xl font-bold tracking-tight">Templates</h1>
          </div>
          <p className="text-muted-foreground">
            Reusable email and SMS templates for campaigns
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Template
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create Template</DialogTitle>
              <DialogDescription>
                Create a new reusable template for your campaigns
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Template Type</Label>
                <Select value={newTemplateType} onValueChange={(v: 'email' | 'sms') => setNewTemplateType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        Email
                      </div>
                    </SelectItem>
                    <SelectItem value="sms">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" />
                        SMS
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">Template Name *</Label>
                <Input 
                  id="name" 
                  placeholder="e.g., Appointment Reminder" 
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Category *</Label>
                <Select 
                  value={newTemplate.category} 
                  onValueChange={(v) => setNewTemplate({ ...newTemplate, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reminders">Reminders</SelectItem>
                    <SelectItem value="follow-ups">Follow-ups</SelectItem>
                    <SelectItem value="promotions">Promotions</SelectItem>
                    <SelectItem value="transactional">Transactional</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newTemplateType === 'email' && (
                <div className="grid gap-2">
                  <Label htmlFor="subject">Subject Line</Label>
                  <Input 
                    id="subject" 
                    placeholder="e.g., Your appointment is tomorrow"
                    value={newTemplate.subject}
                    onChange={(e) => setNewTemplate({ ...newTemplate, subject: e.target.value })}
                  />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="content">
                  {newTemplateType === 'email' ? 'Email Body' : 'Message'} *
                  <span className="text-muted-foreground text-xs ml-2">
                    Use {'{{variable_name}}'} for dynamic content
                  </span>
                </Label>
                <Textarea 
                  id="content" 
                  placeholder={newTemplateType === 'email' 
                    ? "Hi {{customer_name}},\n\nThis is a reminder about your upcoming appointment..."
                    : "SCWS: Your appointment is tomorrow at {{appointment_time}}. Reply CONFIRM or call (760) 440-8520"
                  }
                  rows={6}
                  value={newTemplate.content}
                  onChange={(e) => setNewTemplate({ ...newTemplate, content: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Template'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search and Tabs */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="email">
                  <Mail className="mr-1 h-4 w-4" /> Email Templates
                </TabsTrigger>
                <TabsTrigger value="sms">
                  <MessageSquare className="mr-1 h-4 w-4" /> SMS Templates
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                className="pl-8 w-[250px]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {Object.keys(groupedTemplates).length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {currentTemplates.length === 0 ? (
                <div className="space-y-2">
                  <p>No {activeTab} templates yet</p>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      setNewTemplateType(activeTab as 'email' | 'sms')
                      setIsCreateOpen(true)
                    }}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Create your first template
                  </Button>
                </div>
              ) : (
                'No templates found'
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedTemplates).map(([category, categoryTemplates]) => {
                const CategoryIcon = categoryIcons[category] || FileText
                return (
                  <div key={category}>
                    <div className="flex items-center gap-2 mb-3">
                      <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-semibold">{categoryLabels[category] || category}</h3>
                      <Badge variant="secondary" className="ml-2">{categoryTemplates.length}</Badge>
                    </div>
                    <div className="grid gap-3">
                      {categoryTemplates.map((template) => (
                        <div 
                          key={template.id}
                          className="flex items-start justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{template.name}</h4>
                              {activeTab === 'email' && template.subject && (
                                <Badge variant="outline" className="text-xs">
                                  {template.subject}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {template.content}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span>Used {template.times_used || 0} times</span>
                              {template.last_used_at && (
                                <>
                                  <span>•</span>
                                  <span>Last used {new Date(template.last_used_at).toLocaleDateString()}</span>
                                </>
                              )}
                              <span>•</span>
                              <span>{(template.variables || []).length} variables</span>
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditDialog(template)}>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDuplicate(template)}>
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                className="text-destructive"
                                onClick={() => setDeleteId(template.id)}
                              >
                                <Trash className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Variables Reference */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Available Variables</CardTitle>
          <CardDescription>
            Use these in your templates with {'{{variable_name}}'} syntax
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <h4 className="font-medium mb-2">Customer</h4>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div><code className="bg-muted px-1 rounded">customer_name</code></div>
                <div><code className="bg-muted px-1 rounded">first_name</code></div>
                <div><code className="bg-muted px-1 rounded">email</code></div>
                <div><code className="bg-muted px-1 rounded">phone</code></div>
                <div><code className="bg-muted px-1 rounded">address</code></div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Appointment</h4>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div><code className="bg-muted px-1 rounded">appointment_date</code></div>
                <div><code className="bg-muted px-1 rounded">appointment_time</code></div>
                <div><code className="bg-muted px-1 rounded">service_type</code></div>
                <div><code className="bg-muted px-1 rounded">tech_name</code></div>
              </div>
            </div>
            <div>
              <h4 className="font-medium mb-2">Financial</h4>
              <div className="space-y-1 text-sm text-muted-foreground">
                <div><code className="bg-muted px-1 rounded">quote_amount</code></div>
                <div><code className="bg-muted px-1 rounded">invoice_number</code></div>
                <div><code className="bg-muted px-1 rounded">amount</code></div>
                <div><code className="bg-muted px-1 rounded">payment_link</code></div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editTemplate} onOpenChange={(open) => !open && setEditTemplate(null)}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Update the template details
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Template Name</Label>
              <Input 
                id="edit-name" 
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select 
                value={editData.category} 
                onValueChange={(v) => setEditData({ ...editData, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="reminders">Reminders</SelectItem>
                  <SelectItem value="follow-ups">Follow-ups</SelectItem>
                  <SelectItem value="promotions">Promotions</SelectItem>
                  <SelectItem value="transactional">Transactional</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editTemplate?.type === 'email' && (
              <div className="grid gap-2">
                <Label htmlFor="edit-subject">Subject Line</Label>
                <Input 
                  id="edit-subject"
                  value={editData.subject}
                  onChange={(e) => setEditData({ ...editData, subject: e.target.value })}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="edit-content">
                {editTemplate?.type === 'email' ? 'Email Body' : 'Message'}
              </Label>
              <Textarea 
                id="edit-content" 
                rows={6}
                value={editData.content}
                onChange={(e) => setEditData({ ...editData, content: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTemplate(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The template will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete} 
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
