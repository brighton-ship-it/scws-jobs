'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  Mail, 
  MessageSquare, 
  Plus, 
  Search, 
  Filter,
  MoreVertical,
  Send,
  Clock,
  CheckCircle,
  XCircle,
  Users,
  TrendingUp,
  Calendar,
  ChevronRight
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

// Mock data - will be replaced with Supabase
const mockCampaigns = [
  {
    id: '1',
    name: 'January Maintenance Reminder',
    type: 'email',
    status: 'sent',
    sentAt: '2026-01-15T10:00:00',
    recipients: 1247,
    opened: 456,
    clicked: 89,
    segment: 'All Customers',
  },
  {
    id: '2',
    name: 'Spring Well Check Promo',
    type: 'email',
    status: 'scheduled',
    scheduledFor: '2026-03-01T09:00:00',
    recipients: 2500,
    segment: 'Last Service > 6 months',
  },
  {
    id: '3',
    name: 'Appointment Reminder - Tomorrow',
    type: 'sms',
    status: 'active',
    sentAt: '2026-02-01T08:00:00',
    recipients: 12,
    delivered: 12,
    segment: 'Tomorrow Appointments',
  },
  {
    id: '4',
    name: 'Holiday Hours Notice',
    type: 'email',
    status: 'draft',
    recipients: 0,
    segment: 'All Customers',
  },
  {
    id: '5',
    name: 'Quote Follow-up',
    type: 'sms',
    status: 'sent',
    sentAt: '2026-02-01T14:00:00',
    recipients: 34,
    delivered: 32,
    replied: 8,
    segment: 'Open Quotes > 7 days',
  },
]

const mockStats = {
  totalCampaigns: 47,
  totalSent: 15234,
  avgOpenRate: 36.5,
  avgClickRate: 8.2,
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'sent':
      return <Badge variant="default" className="bg-green-100 text-green-800">Sent</Badge>
    case 'scheduled':
      return <Badge variant="default" className="bg-blue-100 text-blue-800">Scheduled</Badge>
    case 'active':
      return <Badge variant="default" className="bg-purple-100 text-purple-800">Active</Badge>
    case 'draft':
      return <Badge variant="secondary">Draft</Badge>
    case 'failed':
      return <Badge variant="destructive">Failed</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function getTypeIcon(type: string) {
  return type === 'email' ? (
    <Mail className="h-4 w-4 text-blue-600" />
  ) : (
    <MessageSquare className="h-4 w-4 text-green-600" />
  )
}

export default function MarketingPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState('all')

  const filteredCampaigns = mockCampaigns.filter(campaign => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTab = activeTab === 'all' || campaign.type === activeTab
    return matchesSearch && matchesTab
  })

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Marketing</h1>
          <p className="text-muted-foreground">
            Email & SMS campaigns to keep customers engaged
          </p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Campaign
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href="/marketing/campaigns/new?type=email">
                  <Mail className="mr-2 h-4 w-4" />
                  Email Campaign
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/marketing/campaigns/new?type=sms">
                  <MessageSquare className="mr-2 h-4 w-4" />
                  SMS Campaign
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Campaigns</CardTitle>
            <Send className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.totalCampaigns}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages Sent</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.totalSent.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">This year</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Open Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.avgOpenRate}%</div>
            <p className="text-xs text-muted-foreground">Email campaigns</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Click Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockStats.avgClickRate}%</div>
            <p className="text-xs text-muted-foreground">Email campaigns</p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/marketing/templates">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Templates</CardTitle>
                <CardDescription>Manage email & SMS templates</CardDescription>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
        <Link href="/marketing/segments">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Segments</CardTitle>
                <CardDescription>Customer targeting groups</CardDescription>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
        <Link href="/marketing/automations">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Automations</CardTitle>
                <CardDescription>Automated message flows</CardDescription>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Campaigns List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <CardTitle>Campaigns</CardTitle>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search campaigns..."
                  className="pl-8 w-[250px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="email">
                <Mail className="mr-1 h-3 w-3" /> Email
              </TabsTrigger>
              <TabsTrigger value="sms">
                <MessageSquare className="mr-1 h-3 w-3" /> SMS
              </TabsTrigger>
            </TabsList>
            <TabsContent value={activeTab} className="mt-4">
              <div className="space-y-2">
                {filteredCampaigns.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No campaigns found
                  </div>
                ) : (
                  filteredCampaigns.map((campaign) => (
                    <Link 
                      key={campaign.id} 
                      href={`/marketing/campaigns/${campaign.id}`}
                      className="block"
                    >
                      <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-full bg-muted">
                            {getTypeIcon(campaign.type)}
                          </div>
                          <div>
                            <div className="font-medium">{campaign.name}</div>
                            <div className="text-sm text-muted-foreground flex items-center gap-2">
                              <Users className="h-3 w-3" />
                              {campaign.segment}
                              {campaign.sentAt && (
                                <>
                                  <span>•</span>
                                  <span>Sent {new Date(campaign.sentAt).toLocaleDateString()}</span>
                                </>
                              )}
                              {campaign.scheduledFor && (
                                <>
                                  <span>•</span>
                                  <Clock className="h-3 w-3" />
                                  <span>Scheduled {new Date(campaign.scheduledFor).toLocaleDateString()}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {campaign.recipients > 0 && (
                            <div className="text-right text-sm">
                              <div className="font-medium">{campaign.recipients.toLocaleString()}</div>
                              <div className="text-muted-foreground">recipients</div>
                            </div>
                          )}
                          {campaign.opened !== undefined && (
                            <div className="text-right text-sm">
                              <div className="font-medium">{((campaign.opened / campaign.recipients) * 100).toFixed(1)}%</div>
                              <div className="text-muted-foreground">opened</div>
                            </div>
                          )}
                          {getStatusBadge(campaign.status)}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={(e) => e.preventDefault()}>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>View Details</DropdownMenuItem>
                              <DropdownMenuItem>Duplicate</DropdownMenuItem>
                              {campaign.status === 'draft' && (
                                <DropdownMenuItem>Delete</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
