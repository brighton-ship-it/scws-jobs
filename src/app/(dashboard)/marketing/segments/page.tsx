'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  Users, 
  Plus, 
  Search,
  MoreVertical,
  Copy,
  Edit,
  Trash,
  MapPin,
  Calendar,
  Wrench,
  DollarSign,
  Clock,
  Filter,
  RefreshCw
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

// Mock segments
const mockSegments = [
  {
    id: '1',
    name: 'All Customers',
    description: 'Every customer in your database',
    type: 'system',
    count: 16826,
    conditions: [],
    lastUpdated: '2026-02-02T00:00:00',
  },
  {
    id: '2',
    name: 'Active Customers',
    description: 'Customers with service in the past 12 months',
    type: 'system',
    count: 4521,
    conditions: [
      { field: 'last_service', operator: 'within', value: '12 months' }
    ],
    lastUpdated: '2026-02-02T00:00:00',
  },
  {
    id: '3',
    name: 'Last Service > 6 Months',
    description: 'Customers due for maintenance',
    type: 'custom',
    count: 2847,
    conditions: [
      { field: 'last_service', operator: 'more_than', value: '6 months ago' }
    ],
    lastUpdated: '2026-02-02T00:00:00',
  },
  {
    id: '4',
    name: 'Ramona Area',
    description: 'Customers in Ramona and surrounding areas',
    type: 'location',
    count: 3456,
    conditions: [
      { field: 'city', operator: 'in', value: 'Ramona, San Diego County' }
    ],
    lastUpdated: '2026-02-01T00:00:00',
  },
  {
    id: '5',
    name: 'High Value Customers',
    description: 'Total spend over $5,000',
    type: 'custom',
    count: 892,
    conditions: [
      { field: 'total_spend', operator: 'greater_than', value: '$5,000' }
    ],
    lastUpdated: '2026-02-01T00:00:00',
  },
  {
    id: '6',
    name: 'Anza Service Area',
    description: 'Customers in Anza and Cahuilla',
    type: 'location',
    count: 1234,
    conditions: [
      { field: 'city', operator: 'in', value: 'Anza, Cahuilla' }
    ],
    lastUpdated: '2026-02-01T00:00:00',
  },
  {
    id: '7',
    name: 'Open Quotes > 7 Days',
    description: 'Quotes pending for over a week',
    type: 'custom',
    count: 34,
    conditions: [
      { field: 'quote_status', operator: 'equals', value: 'pending' },
      { field: 'quote_age', operator: 'greater_than', value: '7 days' }
    ],
    lastUpdated: '2026-02-02T00:00:00',
  },
  {
    id: '8',
    name: 'Well Drilling Customers',
    description: 'Customers who had well drilling services',
    type: 'service',
    count: 567,
    conditions: [
      { field: 'service_type', operator: 'includes', value: 'Well Drilling' }
    ],
    lastUpdated: '2026-02-01T00:00:00',
  },
  {
    id: '9',
    name: 'Pump Repair Customers',
    description: 'Customers who had pump repair/replacement',
    type: 'service',
    count: 2341,
    conditions: [
      { field: 'service_type', operator: 'includes', value: 'Pump Repair' }
    ],
    lastUpdated: '2026-02-01T00:00:00',
  },
  {
    id: '10',
    name: 'Tomorrow Appointments',
    description: 'Customers with appointments tomorrow',
    type: 'dynamic',
    count: 8,
    conditions: [
      { field: 'next_appointment', operator: 'equals', value: 'tomorrow' }
    ],
    lastUpdated: '2026-02-02T00:00:00',
  },
]

const typeIcons: Record<string, any> = {
  system: Users,
  custom: Filter,
  location: MapPin,
  service: Wrench,
  dynamic: RefreshCw,
}

const typeColors: Record<string, string> = {
  system: 'bg-gray-100 text-gray-800',
  custom: 'bg-blue-100 text-blue-800',
  location: 'bg-green-100 text-green-800',
  service: 'bg-orange-100 text-orange-800',
  dynamic: 'bg-purple-100 text-purple-800',
}

export default function SegmentsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [conditions, setConditions] = useState([{ field: '', operator: '', value: '' }])

  const filteredSegments = mockSegments.filter(segment =>
    segment.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    segment.description.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const totalCustomers = mockSegments.find(s => s.id === '1')?.count || 0

  const addCondition = () => {
    setConditions([...conditions, { field: '', operator: '', value: '' }])
  }

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index))
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
            <h1 className="text-3xl font-bold tracking-tight">Segments</h1>
          </div>
          <p className="text-muted-foreground">
            Target specific groups of customers for your campaigns
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Segment
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Create Segment</DialogTitle>
              <DialogDescription>
                Define conditions to group customers for targeted campaigns
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Segment Name</Label>
                <Input id="name" placeholder="e.g., Customers needing maintenance" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" placeholder="Brief description of this segment" />
              </div>
              
              <div className="space-y-3">
                <Label>Conditions</Label>
                <p className="text-sm text-muted-foreground">
                  Customers matching ALL conditions will be included
                </p>
                {conditions.map((condition, index) => (
                  <div key={index} className="flex gap-2 items-start">
                    <Select>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select field" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="last_service">Last Service Date</SelectItem>
                        <SelectItem value="city">City/Location</SelectItem>
                        <SelectItem value="service_type">Service Type</SelectItem>
                        <SelectItem value="total_spend">Total Spend</SelectItem>
                        <SelectItem value="quote_status">Quote Status</SelectItem>
                        <SelectItem value="next_appointment">Next Appointment</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select>
                      <SelectTrigger className="w-[140px]">
                        <SelectValue placeholder="Operator" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="equals">equals</SelectItem>
                        <SelectItem value="not_equals">not equals</SelectItem>
                        <SelectItem value="greater_than">greater than</SelectItem>
                        <SelectItem value="less_than">less than</SelectItem>
                        <SelectItem value="within">within</SelectItem>
                        <SelectItem value="more_than">more than</SelectItem>
                        <SelectItem value="includes">includes</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input placeholder="Value" className="flex-1" />
                    {conditions.length > 1 && (
                      <Button 
                        variant="ghost" 
                        size="icon"
                        onClick={() => removeCondition(index)}
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Condition
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setIsCreateOpen(false)}>
                Create Segment
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Customers</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCustomers.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">In database</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custom Segments</CardTitle>
            <Filter className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockSegments.filter(s => s.type === 'custom').length}
            </div>
            <p className="text-xs text-muted-foreground">User-defined</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Location Segments</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockSegments.filter(s => s.type === 'location').length}
            </div>
            <p className="text-xs text-muted-foreground">Geographic targeting</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Service Segments</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {mockSegments.filter(s => s.type === 'service').length}
            </div>
            <p className="text-xs text-muted-foreground">By service type</p>
          </CardContent>
        </Card>
      </div>

      {/* Segments List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <CardTitle>All Segments</CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search segments..."
                className="pl-8 w-[250px]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {filteredSegments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No segments found
              </div>
            ) : (
              filteredSegments.map((segment) => {
                const TypeIcon = typeIcons[segment.type] || Users
                return (
                  <div 
                    key={segment.id}
                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-full ${typeColors[segment.type]}`}>
                        <TypeIcon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{segment.name}</h4>
                          {segment.type === 'dynamic' && (
                            <Badge variant="outline" className="text-xs">
                              <RefreshCw className="mr-1 h-3 w-3" />
                              Auto-updates
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{segment.description}</p>
                        {segment.conditions.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {segment.conditions.map((cond, i) => (
                              <Badge key={i} variant="secondary" className="text-xs">
                                {cond.field} {cond.operator} {cond.value}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-2xl font-bold">{segment.count.toLocaleString()}</div>
                        <div className="text-xs text-muted-foreground">
                          {((segment.count / totalCustomers) * 100).toFixed(1)}% of total
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
                            <Users className="mr-2 h-4 w-4" />
                            View Customers
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem>
                            <Copy className="mr-2 h-4 w-4" />
                            Duplicate
                          </DropdownMenuItem>
                          {segment.type !== 'system' && (
                            <DropdownMenuItem className="text-destructive">
                              <Trash className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
