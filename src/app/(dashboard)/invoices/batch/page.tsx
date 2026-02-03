'use client'

import { useState } from 'react'
import Link from 'next/link'
import { 
  ArrowLeft,
  FileText, 
  Check,
  CheckSquare,
  Square,
  DollarSign,
  Calendar,
  User,
  Send,
  Download
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Mock completed jobs ready to invoice
const mockCompletedJobs = [
  {
    id: '1',
    job_type: 'Well Pump Repair',
    customer_name: 'Robert Johnson',
    property_address: '12345 Desert View Rd, Ramona',
    completed_at: '2026-02-01',
    estimated_amount: 1250.00,
    assigned_to: 'Travis Sego',
  },
  {
    id: '2',
    job_type: 'Pressure Tank Replacement',
    customer_name: 'Maria Garcia',
    property_address: '5678 Mountain Top Ln, Julian',
    completed_at: '2026-02-01',
    estimated_amount: 850.00,
    assigned_to: 'Brian Eads',
  },
  {
    id: '3',
    job_type: 'Well Inspection',
    customer_name: 'Desert Oasis HOA',
    property_address: '789 Palm Canyon Dr, Borrego Springs',
    completed_at: '2026-02-01',
    estimated_amount: 250.00,
    assigned_to: 'Austin Tipton',
  },
  {
    id: '4',
    job_type: 'Well Pump Replacement',
    customer_name: 'James Wilson',
    property_address: '456 Valley View Rd, Valley Center',
    completed_at: '2026-01-31',
    estimated_amount: 3200.00,
    assigned_to: 'Jeff Gezewski',
  },
  {
    id: '5',
    job_type: 'Water Quality Test',
    customer_name: 'Sunrise Vineyard',
    property_address: '321 Wine Country Rd, Temecula',
    completed_at: '2026-01-31',
    estimated_amount: 175.00,
    assigned_to: 'Dakota Cole',
  },
]

export default function BatchInvoicePage() {
  const [selectedJobs, setSelectedJobs] = useState<string[]>([])
  const [dateFilter, setDateFilter] = useState('all')

  const toggleJob = (id: string) => {
    setSelectedJobs(prev => 
      prev.includes(id) 
        ? prev.filter(j => j !== id)
        : [...prev, id]
    )
  }

  const toggleAll = () => {
    if (selectedJobs.length === mockCompletedJobs.length) {
      setSelectedJobs([])
    } else {
      setSelectedJobs(mockCompletedJobs.map(j => j.id))
    }
  }

  const selectedTotal = mockCompletedJobs
    .filter(j => selectedJobs.includes(j.id))
    .reduce((sum, j) => sum + j.estimated_amount, 0)

  const handleCreateInvoices = () => {
    // TODO: Create invoices for selected jobs
    console.log('Creating invoices for:', selectedJobs)
    alert(`Creating ${selectedJobs.length} invoices totaling $${selectedTotal.toLocaleString()}`)
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/invoices">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Batch Invoicing</h1>
            <p className="text-muted-foreground">
              Create invoices for multiple completed jobs at once
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={selectedJobs.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export Selected
          </Button>
          <Button 
            onClick={handleCreateInvoices}
            disabled={selectedJobs.length === 0}
            className="bg-green-600 hover:bg-green-700"
          >
            <Send className="mr-2 h-4 w-4" />
            Create {selectedJobs.length} Invoice{selectedJobs.length !== 1 ? 's' : ''}
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs to Invoice</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{mockCompletedJobs.length}</div>
            <p className="text-xs text-muted-foreground">Completed jobs without invoices</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Selected</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{selectedJobs.length}</div>
            <p className="text-xs text-muted-foreground">Jobs selected for invoicing</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Selected Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${selectedTotal.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total invoice amount</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center justify-between">
        <div className="flex items-center gap-4">
          <Button 
            variant="outline" 
            onClick={toggleAll}
            className="gap-2"
          >
            {selectedJobs.length === mockCompletedJobs.length ? (
              <CheckSquare className="h-4 w-4" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            {selectedJobs.length === mockCompletedJobs.length ? 'Deselect All' : 'Select All'}
          </Button>
        </div>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Dates</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="yesterday">Yesterday</SelectItem>
            <SelectItem value="week">This Week</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Jobs List */}
      <Card>
        <CardContent className="p-0">
          {mockCompletedJobs.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No completed jobs ready for invoicing
            </div>
          ) : (
            <div className="divide-y">
              {mockCompletedJobs.map((job) => (
                <div 
                  key={job.id}
                  onClick={() => toggleJob(job.id)}
                  className={`flex items-center justify-between p-4 cursor-pointer transition-colors ${
                    selectedJobs.includes(job.id) 
                      ? 'bg-primary/5' 
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <Checkbox 
                      checked={selectedJobs.includes(job.id)}
                      onCheckedChange={() => toggleJob(job.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{job.job_type}</h4>
                        <Badge variant="outline" className="text-green-600 border-green-600">
                          Completed
                        </Badge>
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {job.customer_name}
                        </span>
                        <span>•</span>
                        <span>{job.property_address}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Completed {new Date(job.completed_at).toLocaleDateString()}
                        </span>
                        <span>•</span>
                        <span>Tech: {job.assigned_to}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold">${job.estimated_amount.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Estimated</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Action Bar (mobile) */}
      {selectedJobs.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t md:hidden">
          <Button 
            className="w-full bg-green-600 hover:bg-green-700"
            onClick={handleCreateInvoices}
          >
            Create {selectedJobs.length} Invoice{selectedJobs.length !== 1 ? 's' : ''} (${selectedTotal.toLocaleString()})
          </Button>
        </div>
      )}
    </div>
  )
}
