'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Mail, 
  MessageSquare, 
  Plus, 
  Search, 
  MoreVertical,
  Send,
  Clock,
  Users,
  TrendingUp,
  ChevronRight,
  Loader2,
  AlertCircle,
  Trash
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

interface Campaign {
  id: string
  name: string
  type: 'email' | 'sms'
  status: string
  subject?: string
  content: string
  recipient_count: number
  scheduled_for?: string
  sent_at?: string
  completed_at?: string
  delivered?: number
  opened?: number
  clicked?: number
  bounced?: number
  segment?: {
    id: string
    name: string
    customer_count: number
  } | null
  template?: {
    id: string
    name: string
  } | null
  created_at: string
}

interface Stats {
  campaigns: {
    total: number
    sent: number
  }
  messages: {
    thisYear: number
    sent: number
  }
  rates: {
    openRate: number
    clickRate: number
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'sent':
      return <Badge variant="default" className="bg-green-100 text-green-800">Sent</Badge>
    case 'scheduled':
      return <Badge variant="default" className="bg-blue-100 text-blue-800">Scheduled</Badge>
    case 'sending':
      return <Badge variant="default" className="bg-purple-100 text-purple-800">Sending</Badge>
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Fetch campaigns and stats
  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [campaignsRes, statsRes] = await Promise.all([
          fetch('/api/marketing/campaigns'),
          fetch('/api/marketing/stats')
        ])
        
        if (!campaignsRes.ok) throw new Error('Failed to fetch campaigns')
        if (!statsRes.ok) throw new Error('Failed to fetch stats')
        
        const campaignsData = await campaignsRes.json()
        const statsData = await statsRes.json()
        
        setCampaigns(campaignsData.campaigns || [])
        setStats(statsData)
      } catch (err: any) {
        console.error('Error fetching marketing data:', err)
        setError(err.message || 'Failed to load data')
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
  }, [])

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/marketing/campaigns/${deleteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete')
      }
      setCampaigns(campaigns.filter(c => c.id !== deleteId))
      toast.success('Campaign deleted')
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete campaign')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const filteredCampaigns = campaigns.filter(campaign => {
    const matchesSearch = campaign.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesTab = activeTab === 'all' || campaign.type === activeTab
    return matchesSearch && matchesTab
  })

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
            <div className="text-2xl font-bold">{stats?.campaigns.total || 0}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Messages Sent</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{(stats?.messages.thisYear || 0).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">This year</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Open Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.rates.openRate || 0}%</div>
            <p className="text-xs text-muted-foreground">Email campaigns</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Click Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.rates.clickRate || 0}%</div>
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
        <Link href="/marketing/analytics">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg">Analytics</CardTitle>
                <CardDescription>Campaign performance & history</CardDescription>
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
                    {campaigns.length === 0 ? (
                      <div className="space-y-2">
                        <p>No campaigns yet</p>
                        <Button asChild variant="outline" size="sm">
                          <Link href="/marketing/campaigns/new?type=email">
                            <Plus className="mr-2 h-4 w-4" />
                            Create your first campaign
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      'No campaigns found'
                    )}
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
                              {campaign.segment?.name || 'No segment'}
                              {campaign.sent_at && (
                                <>
                                  <span>•</span>
                                  <span>Sent {new Date(campaign.sent_at).toLocaleDateString()}</span>
                                </>
                              )}
                              {campaign.scheduled_for && campaign.status === 'scheduled' && (
                                <>
                                  <span>•</span>
                                  <Clock className="h-3 w-3" />
                                  <span>Scheduled {new Date(campaign.scheduled_for).toLocaleDateString()}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {campaign.recipient_count > 0 && (
                            <div className="text-right text-sm">
                              <div className="font-medium">{campaign.recipient_count.toLocaleString()}</div>
                              <div className="text-muted-foreground">recipients</div>
                            </div>
                          )}
                          {campaign.opened !== undefined && campaign.delivered && campaign.delivered > 0 && (
                            <div className="text-right text-sm">
                              <div className="font-medium">{((campaign.opened / campaign.delivered) * 100).toFixed(1)}%</div>
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
                              <DropdownMenuItem asChild>
                                <Link href={`/marketing/campaigns/${campaign.id}`}>
                                  View Details
                                </Link>
                              </DropdownMenuItem>
                              {campaign.status === 'draft' && (
                                <DropdownMenuItem 
                                  className="text-destructive"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    setDeleteId(campaign.id)
                                  }}
                                >
                                  <Trash className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The campaign will be permanently deleted.
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
