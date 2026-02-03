'use client'

import { useState } from 'react'
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
  Calendar,
  Bell,
  Star,
  FileText
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
  TabsContent,
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Mock templates
const mockTemplates = {
  email: [
    {
      id: 'e1',
      name: 'Appointment Reminder - 24hr',
      category: 'reminders',
      subject: 'Reminder: Your well service appointment is tomorrow',
      preview: 'Hi {{customer_name}}, this is a reminder that your appointment with Southern California Well Service is scheduled for tomorrow...',
      variables: ['customer_name', 'appointment_date', 'appointment_time', 'service_type'],
      lastUsed: '2026-02-01',
      timesUsed: 156,
    },
    {
      id: 'e2',
      name: 'Appointment Confirmation',
      category: 'reminders',
      subject: 'Your appointment is confirmed!',
      preview: 'Thank you for scheduling with Southern California Well Service. Your appointment has been confirmed for...',
      variables: ['customer_name', 'appointment_date', 'appointment_time', 'tech_name'],
      lastUsed: '2026-02-02',
      timesUsed: 234,
    },
    {
      id: 'e3',
      name: 'Quote Follow-up',
      category: 'follow-ups',
      subject: 'Following up on your well service quote',
      preview: 'Hi {{customer_name}}, we wanted to follow up on the quote we sent for {{service_type}}. Do you have any questions?',
      variables: ['customer_name', 'service_type', 'quote_amount', 'quote_date'],
      lastUsed: '2026-01-28',
      timesUsed: 89,
    },
    {
      id: 'e4',
      name: 'Annual Maintenance Reminder',
      category: 'promotions',
      subject: "It's time for your annual well inspection",
      preview: "Hi {{customer_name}}, it's been a year since your last well service. Regular maintenance helps prevent costly emergency repairs...",
      variables: ['customer_name', 'last_service_date', 'address'],
      lastUsed: '2026-01-15',
      timesUsed: 1247,
    },
    {
      id: 'e5',
      name: 'Invoice Sent',
      category: 'transactional',
      subject: 'Invoice #{{invoice_number}} from Southern California Well Service',
      preview: 'Hi {{customer_name}}, please find attached your invoice for the recent service at {{address}}...',
      variables: ['customer_name', 'invoice_number', 'amount', 'address'],
      lastUsed: '2026-02-02',
      timesUsed: 2341,
    },
    {
      id: 'e6',
      name: 'Payment Receipt',
      category: 'transactional',
      subject: 'Payment received - Thank you!',
      preview: 'Thank you for your payment of ${{amount}}. This confirms that Invoice #{{invoice_number}} has been paid in full...',
      variables: ['customer_name', 'amount', 'invoice_number', 'payment_date'],
      lastUsed: '2026-02-02',
      timesUsed: 1893,
    },
  ],
  sms: [
    {
      id: 's1',
      name: 'Appointment Reminder - 24hr',
      category: 'reminders',
      preview: 'SCWS Reminder: Your appointment is tomorrow at {{appointment_time}}. Reply CONFIRM or call (760) 440-8520 to reschedule.',
      variables: ['appointment_time'],
      lastUsed: '2026-02-02',
      timesUsed: 456,
    },
    {
      id: 's2',
      name: 'Tech On The Way',
      category: 'reminders',
      preview: '{{tech_name}} from SCWS is on the way! ETA: {{eta}}. Questions? Call (760) 440-8520',
      variables: ['tech_name', 'eta'],
      lastUsed: '2026-02-02',
      timesUsed: 234,
    },
    {
      id: 's3',
      name: 'Quote Ready',
      category: 'follow-ups',
      preview: 'Your quote from SCWS is ready! Total: ${{amount}}. View and approve at: {{quote_link}}',
      variables: ['amount', 'quote_link'],
      lastUsed: '2026-01-30',
      timesUsed: 167,
    },
    {
      id: 's4',
      name: 'Payment Link',
      category: 'transactional',
      preview: 'SCWS Invoice #{{invoice_number}}: ${{amount}} due. Pay securely: {{payment_link}}',
      variables: ['invoice_number', 'amount', 'payment_link'],
      lastUsed: '2026-02-01',
      timesUsed: 312,
    },
    {
      id: 's5',
      name: 'Review Request',
      category: 'follow-ups',
      preview: 'Thanks for choosing SCWS! How was your service? Leave a review: {{review_link}}',
      variables: ['review_link'],
      lastUsed: '2026-02-02',
      timesUsed: 89,
    },
  ],
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
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [newTemplateType, setNewTemplateType] = useState('email')

  const currentTemplates = activeTab === 'email' ? mockTemplates.email : mockTemplates.sms
  const filteredTemplates = currentTemplates.filter(template =>
    template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    template.preview.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Group by category
  const groupedTemplates = filteredTemplates.reduce((acc, template) => {
    if (!acc[template.category]) {
      acc[template.category] = []
    }
    acc[template.category].push(template)
    return acc
  }, {} as Record<string, typeof filteredTemplates>)

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
                <Select value={newTemplateType} onValueChange={setNewTemplateType}>
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
                <Label htmlFor="name">Template Name</Label>
                <Input id="name" placeholder="e.g., Appointment Reminder" />
              </div>
              <div className="grid gap-2">
                <Label>Category</Label>
                <Select>
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
                  <Input id="subject" placeholder="e.g., Your appointment is tomorrow" />
                </div>
              )}
              <div className="grid gap-2">
                <Label htmlFor="content">
                  {newTemplateType === 'email' ? 'Email Body' : 'Message'} 
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
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setIsCreateOpen(false)}>
                Create Template
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
              No templates found
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedTemplates).map(([category, templates]) => {
                const CategoryIcon = categoryIcons[category] || FileText
                return (
                  <div key={category}>
                    <div className="flex items-center gap-2 mb-3">
                      <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                      <h3 className="font-semibold">{categoryLabels[category] || category}</h3>
                      <Badge variant="secondary" className="ml-2">{templates.length}</Badge>
                    </div>
                    <div className="grid gap-3">
                      {templates.map((template) => (
                        <div 
                          key={template.id}
                          className="flex items-start justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium">{template.name}</h4>
                              {activeTab === 'email' && 'subject' in template && (
                                <Badge variant="outline" className="text-xs">
                                  {template.subject}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {template.preview}
                            </p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                              <span>Used {template.timesUsed} times</span>
                              <span>•</span>
                              <span>Last used {new Date(template.lastUsed).toLocaleDateString()}</span>
                              <span>•</span>
                              <span>{template.variables.length} variables</span>
                            </div>
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem>
                                <Copy className="mr-2 h-4 w-4" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive">
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
                <div><code className="bg-muted px-1 rounded">customer_email</code></div>
                <div><code className="bg-muted px-1 rounded">customer_phone</code></div>
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
    </div>
  )
}
