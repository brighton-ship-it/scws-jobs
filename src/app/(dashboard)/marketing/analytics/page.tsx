'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { 
  Mail, 
  MessageSquare, 
  Send,
  Users,
  TrendingUp,
  MousePointer,
  Eye,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
  Calendar
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Stats {
  campaigns: {
    total: number
    draft: number
    scheduled: number
    sending: number
    sent: number
    failed: number
    byType: {
      email: number
      sms: number
    }
  }
  messages: {
    total: number
    sent: number
    delivered: number
    failed: number
    opened: number
    clicked: number
    thisYear: number
  }
  rates: {
    openRate: number
    clickRate: number
    smsDeliveryRate: number
  }
  recentCampaigns: {
    id: string
    name: string
    type: 'email' | 'sms'
    status: string
    sent_at: string
    recipient_count: number
    delivered: number
    opened: number
    clicked: number
  }[]
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

function StatCard({ 
  title, 
  value, 
  icon: Icon, 
  description, 
  trend 
}: { 
  title: string
  value: string | number
  icon: any
  description?: string
  trend?: { value: number; positive: boolean }
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <div className="text-2xl font-bold">{value}</div>
          {trend && (
            <span className={`text-xs flex items-center ${trend.positive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {trend.value}%
            </span>
          )}
        </div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardContent>
    </Card>
  )
}

export default function MarketingAnalyticsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState('all')

  useEffect(() => {
    async function fetchStats() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/marketing/stats')
        if (!res.ok) throw new Error('Failed to fetch stats')
        const data = await res.json()
        setStats(data)
      } catch (err: any) {
        console.error('Error fetching stats:', err)
        setError(err.message || 'Failed to load analytics')
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [])

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

  const deliveryRate = stats?.messages.sent ? 
    ((stats.messages.delivered / stats.messages.sent) * 100).toFixed(1) : '0.0'

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
            <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          </div>
          <p className="text-muted-foreground">
            Campaign performance and send history
          </p>
        </div>
        <Select value={timeRange} onValueChange={setTimeRange}>
          <SelectTrigger className="w-[180px]">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
            <SelectItem value="year">This year</SelectItem>
            <SelectItem value="all">All time</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Overview Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Campaigns"
          value={stats?.campaigns.total || 0}
          icon={Send}
          description={`${stats?.campaigns.sent || 0} sent, ${stats?.campaigns.draft || 0} drafts`}
        />
        <StatCard
          title="Messages Sent"
          value={(stats?.messages.sent || 0).toLocaleString()}
          icon={Users}
          description={`${stats?.messages.thisYear.toLocaleString() || 0} this year`}
        />
        <StatCard
          title="Delivery Rate"
          value={`${deliveryRate}%`}
          icon={CheckCircle}
          description={`${stats?.messages.delivered.toLocaleString() || 0} delivered`}
        />
        <StatCard
          title="Failed"
          value={(stats?.messages.failed || 0).toLocaleString()}
          icon={XCircle}
          description="Messages that couldn't be delivered"
        />
      </div>

      {/* Email vs SMS breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Email Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-blue-600" />
              Email Performance
            </CardTitle>
            <CardDescription>
              {stats?.campaigns.byType.email || 0} email campaigns sent
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Open Rate</p>
                <p className="text-2xl font-bold">{stats?.rates.openRate || 0}%</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Click Rate</p>
                <p className="text-2xl font-bold">{stats?.rates.clickRate || 0}%</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Opened</span>
                <span className="font-medium">{(stats?.messages.opened || 0).toLocaleString()}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-blue-600 h-2 rounded-full" 
                  style={{ width: `${Math.min(stats?.rates.openRate || 0, 100)}%` }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Clicked</span>
                <span className="font-medium">{(stats?.messages.clicked || 0).toLocaleString()}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-green-600 h-2 rounded-full" 
                  style={{ width: `${Math.min(stats?.rates.clickRate || 0, 100)}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SMS Stats */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-green-600" />
              SMS Performance
            </CardTitle>
            <CardDescription>
              {stats?.campaigns.byType.sms || 0} SMS campaigns sent
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Delivery Rate</p>
                <p className="text-2xl font-bold">{stats?.rates.smsDeliveryRate || 0}%</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Sent</p>
                <p className="text-2xl font-bold">{(stats?.messages.sent || 0).toLocaleString()}</p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Delivered</span>
                <span className="font-medium">{(stats?.messages.delivered || 0).toLocaleString()}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-green-600 h-2 rounded-full" 
                  style={{ width: `${Math.min(stats?.rates.smsDeliveryRate || 0, 100)}%` }}
                />
              </div>
            </div>
            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground">
                SMS messages are delivered directly to customers' phones. Delivery rates depend on carrier availability and phone number validity.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Campaigns */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Campaigns</CardTitle>
          <CardDescription>Performance of your latest campaigns</CardDescription>
        </CardHeader>
        <CardContent>
          {!stats?.recentCampaigns || stats.recentCampaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No campaigns sent yet</p>
              <Button asChild variant="outline" size="sm" className="mt-4">
                <Link href="/marketing/campaigns/new?type=email">
                  Create your first campaign
                </Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {stats.recentCampaigns.map((campaign) => {
                const openRate = campaign.delivered > 0 
                  ? ((campaign.opened / campaign.delivered) * 100).toFixed(1) 
                  : '0.0'
                const clickRate = campaign.delivered > 0 
                  ? ((campaign.clicked / campaign.delivered) * 100).toFixed(1) 
                  : '0.0'
                
                return (
                  <Link 
                    key={campaign.id} 
                    href={`/marketing/campaigns/${campaign.id}`}
                    className="block"
                  >
                    <div className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-full bg-muted">
                          {campaign.type === 'email' ? (
                            <Mail className="h-4 w-4 text-blue-600" />
                          ) : (
                            <MessageSquare className="h-4 w-4 text-green-600" />
                          )}
                        </div>
                        <div>
                          <div className="font-medium">{campaign.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {campaign.sent_at 
                              ? `Sent ${new Date(campaign.sent_at).toLocaleDateString()}`
                              : 'Not sent'
                            }
                            {' • '}
                            {campaign.recipient_count.toLocaleString()} recipients
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        {campaign.type === 'email' && (
                          <>
                            <div className="text-right">
                              <div className="flex items-center gap-1 text-sm">
                                <Eye className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium">{openRate}%</span>
                              </div>
                              <div className="text-xs text-muted-foreground">opened</div>
                            </div>
                            <div className="text-right">
                              <div className="flex items-center gap-1 text-sm">
                                <MousePointer className="h-3 w-3 text-muted-foreground" />
                                <span className="font-medium">{clickRate}%</span>
                              </div>
                              <div className="text-xs text-muted-foreground">clicked</div>
                            </div>
                          </>
                        )}
                        {campaign.type === 'sms' && (
                          <div className="text-right">
                            <div className="flex items-center gap-1 text-sm">
                              <CheckCircle className="h-3 w-3 text-muted-foreground" />
                              <span className="font-medium">{campaign.delivered}</span>
                            </div>
                            <div className="text-xs text-muted-foreground">delivered</div>
                          </div>
                        )}
                        {getStatusBadge(campaign.status)}
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign Status Breakdown */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Campaign Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span className="text-sm">Sent</span>
                </div>
                <span className="font-medium">{stats?.campaigns.sent || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span className="text-sm">Scheduled</span>
                </div>
                <span className="font-medium">{stats?.campaigns.scheduled || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <span className="text-sm">Sending</span>
                </div>
                <span className="font-medium">{stats?.campaigns.sending || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-gray-400" />
                  <span className="text-sm">Draft</span>
                </div>
                <span className="font-medium">{stats?.campaigns.draft || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-sm">Failed</span>
                </div>
                <span className="font-medium">{stats?.campaigns.failed || 0}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/marketing/campaigns/new?type=email">
                <Mail className="mr-2 h-4 w-4" />
                Create Email Campaign
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/marketing/campaigns/new?type=sms">
                <MessageSquare className="mr-2 h-4 w-4" />
                Create SMS Campaign
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/marketing/templates">
                <TrendingUp className="mr-2 h-4 w-4" />
                Manage Templates
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full justify-start">
              <Link href="/marketing/segments">
                <Users className="mr-2 h-4 w-4" />
                View Segments
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
