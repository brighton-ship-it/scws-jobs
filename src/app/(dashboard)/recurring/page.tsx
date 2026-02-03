'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  Plus, 
  Search, 
  MoreVertical,
  Calendar,
  RefreshCw,
  Pause,
  Play,
  User,
  MapPin,
  Clock,
  DollarSign,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

// Mock data - will be replaced with API
const mockRecurringJobs = [
  {
    id: '1',
    title: 'Annual Well Inspection',
    customer_name: 'Johnson Ranch',
    property_address: '45678 Desert View Rd, Borrego Springs',
    frequency: 'annual',
    next_scheduled: '2026-03-15',
    price: 250,
    status: 'active',
    jobs_created: 3,
    assigned_to: 'Travis Sego',
  },
  {
    id: '2',
    title: 'Quarterly Pump Check',
    customer_name: 'Desert Oasis HOA',
    property_address: '12345 Palm Canyon Dr, Palm Desert',
    frequency: 'quarterly',
    next_scheduled: '2026-04-01',
    price: 175,
    status: 'active',
    jobs_created: 8,
    assigned_to: 'Brian Eads',
  },
  {
    id: '3',
    title: 'Monthly Water Quality Test',
    customer_name: 'Sunrise Vineyard',
    property_address: '789 Wine Country Rd, Temecula',
    frequency: 'monthly',
    next_scheduled: '2026-03-01',
    price: 125,
    status: 'active',
    jobs_created: 14,
    assigned_to: 'Austin Tipton',
  },
  {
    id: '4',
    title: 'Biannual Pressure Tank Service',
    customer_name: 'Mountain View Ranch',
    property_address: '5678 High Desert Rd, Julian',
    frequency: 'biannual',
    next_scheduled: '2026-06-01',
    price: 350,
    status: 'paused',
    jobs_created: 2,
    assigned_to: 'Jeff Gezewski',
  },
]

const frequencyLabels: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 Weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  biannual: 'Every 6 Months',
  annual: 'Annually',
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'active':
      return <Badge className="bg-green-100 text-green-800">Active</Badge>
    case 'paused':
      return <Badge className="bg-yellow-100 text-yellow-800">Paused</Badge>
    case 'completed':
      return <Badge className="bg-gray-100 text-gray-800">Completed</Badge>
    case 'cancelled':
      return <Badge variant="destructive">Cancelled</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export default function RecurringJobsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  const filteredJobs = mockRecurringJobs.filter(job => {
    const matchesSearch = 
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.customer_name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || job.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const stats = {
    active: mockRecurringJobs.filter(j => j.status === 'active').length,
    paused: mockRecurringJobs.filter(j => j.status === 'paused').length,
    totalRevenue: mockRecurringJobs
      .filter(j => j.status === 'active')
      .reduce((sum, j) => sum + (j.price * (j.frequency === 'monthly' ? 12 : j.frequency === 'quarterly' ? 4 : j.frequency === 'biannual' ? 2 : 1)), 0),
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recurring Jobs</h1>
          <p className="text-muted-foreground">
            Automatically scheduled maintenance and service agreements
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Recurring Job
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create Recurring Job</DialogTitle>
              <DialogDescription>
                Set up an automatically scheduled job that repeats on a regular basis
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4 max-h-[60vh] overflow-y-auto">
              <div className="grid gap-2">
                <Label htmlFor="customer">Customer</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Johnson Ranch</SelectItem>
                    <SelectItem value="2">Desert Oasis HOA</SelectItem>
                    <SelectItem value="3">Sunrise Vineyard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="title">Job Title</Label>
                <Input id="title" placeholder="e.g., Annual Well Inspection" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" placeholder="What needs to be done..." rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Frequency</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="How often" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="biweekly">Every 2 Weeks</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="biannual">Every 6 Months</SelectItem>
                      <SelectItem value="annual">Annually</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="start_date">Start Date</Label>
                  <Input id="start_date" type="date" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="price">Price</Label>
                  <Input id="price" type="number" placeholder="0.00" />
                </div>
                <div className="grid gap-2">
                  <Label>Assign To</Label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select tech" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="travis">Travis Sego</SelectItem>
                      <SelectItem value="brian">Brian Eads</SelectItem>
                      <SelectItem value="austin">Austin Tipton</SelectItem>
                      <SelectItem value="jeff">Jeff Gezewski</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="notes">Internal Notes</Label>
                <Textarea id="notes" placeholder="Notes for the team..." rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setIsCreateOpen(false)}>
                Create Recurring Job
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Schedules</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active}</div>
            <p className="text-xs text-muted-foreground">Recurring jobs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paused</CardTitle>
            <Pause className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.paused}</div>
            <p className="text-xs text-muted-foreground">Temporarily on hold</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Est. Annual Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.totalRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">From active recurring jobs</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search recurring jobs..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Jobs List */}
      <Card>
        <CardContent className="p-0">
          {filteredJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No recurring jobs found
            </div>
          ) : (
            <div className="divide-y">
              {filteredJobs.map((job) => (
                <div 
                  key={job.id}
                  className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-full bg-primary/10">
                      <RefreshCw className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{job.title}</h4>
                        {getStatusBadge(job.status)}
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {job.customer_name}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {frequencyLabels[job.frequency]}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        {job.property_address}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="font-medium">${job.price}</div>
                      <div className="text-xs text-muted-foreground">per visit</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm">Next: {new Date(job.next_scheduled).toLocaleDateString()}</div>
                      <div className="text-xs text-muted-foreground">{job.jobs_created} jobs created</div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Calendar className="mr-2 h-4 w-4" />
                          Create Job Now
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          Edit Schedule
                        </DropdownMenuItem>
                        {job.status === 'active' ? (
                          <DropdownMenuItem>
                            <Pause className="mr-2 h-4 w-4" />
                            Pause
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem>
                            <Play className="mr-2 h-4 w-4" />
                            Resume
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="text-destructive">
                          Cancel Schedule
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
