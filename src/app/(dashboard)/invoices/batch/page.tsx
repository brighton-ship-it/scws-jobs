'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  Loader2,
  RefreshCw,
  AlertCircle
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'

interface CompletedJob {
  id: string;
  job_type: string;
  completed_at: string | null;
  scheduled_date: string | null;
  description: string | null;
  property: {
    id: string;
    address: string;
    city: string | null;
    customer: {
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
    };
  } | null;
  assigned_user: {
    id: string;
    name: string;
  } | null;
}

export default function BatchInvoicePage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<CompletedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selectedJobs, setSelectedJobs] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const fetchCompletedJobs = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/jobs?status=requires_invoicing&limit=100')
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
      } else {
        setError('Failed to fetch jobs')
      }
    } catch (err) {
      console.error('Error fetching jobs:', err)
      setError('Failed to fetch jobs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCompletedJobs()
  }, [])

  const toggleJob = (id: string) => {
    setSelectedJobs(prev =>
      prev.includes(id)
        ? prev.filter(j => j !== id)
        : [...prev, id]
    )
  }

  const toggleAll = () => {
    if (selectedJobs.length === jobs.length) {
      setSelectedJobs([])
    } else {
      setSelectedJobs(jobs.map(j => j.id))
    }
  }

  const createInvoices = async () => {
    if (selectedJobs.length === 0) return
    
    setCreating(true)
    try {
      // Create invoices for each selected job
      for (const jobId of selectedJobs) {
        const job = jobs.find(j => j.id === jobId)
        if (!job?.property?.customer) continue
        
        const res = await fetch('/api/invoices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: job.property.customer.id,
            job_id: jobId,
            // Invoice will be created as draft with job details
          }),
        })
        
        if (res.ok) {
          // Update job status to invoiced
          await fetch(`/api/jobs/${jobId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'invoiced' }),
          })
        }
      }
      
      // Refresh and redirect
      router.push('/invoices')
    } catch (err) {
      console.error('Error creating invoices:', err)
      setError('Failed to create some invoices')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/invoices">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Batch Create Invoices</h1>
            <p className="text-gray-500">Create invoices for completed jobs</p>
          </div>
        </div>
        <Button
          onClick={fetchCompletedJobs}
          variant="outline"
          size="sm"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{jobs.length}</div>
                <div className="text-sm text-gray-500">Jobs Ready</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckSquare className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{selectedJobs.length}</div>
                <div className="text-sm text-gray-500">Selected</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Button
              onClick={createInvoices}
              disabled={selectedJobs.length === 0 || creating}
              className="w-full"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Create {selectedJobs.length} Invoice{selectedJobs.length !== 1 ? 's' : ''}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Error message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
          <AlertCircle className="h-5 w-5" />
          {error}
        </div>
      )}

      {/* Jobs List */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle>Completed Jobs</CardTitle>
            {jobs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleAll}
              >
                {selectedJobs.length === jobs.length ? (
                  <>
                    <Square className="h-4 w-4 mr-2" />
                    Deselect All
                  </>
                ) : (
                  <>
                    <CheckSquare className="h-4 w-4 mr-2" />
                    Select All
                  </>
                )}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">Loading jobs...</span>
            </div>
          ) : jobs.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <FileText className="h-12 w-12 mx-auto mb-4 text-gray-300" />
              <p className="font-medium">No completed jobs ready for invoicing</p>
              <p className="text-sm mt-1">Complete some jobs first, then come back here</p>
            </div>
          ) : (
            <div className="divide-y">
              {jobs.map((job) => (
                <div
                  key={job.id}
                  onClick={() => toggleJob(job.id)}
                  className={`p-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedJobs.includes(job.id) ? 'bg-green-50' : ''
                  }`}
                >
                  {/* Checkbox */}
                  <div className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                    selectedJobs.includes(job.id)
                      ? 'bg-green-600 border-green-600 text-white'
                      : 'border-gray-300'
                  }`}>
                    {selectedJobs.includes(job.id) && (
                      <Check className="h-3 w-3" />
                    )}
                  </div>

                  {/* Job Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900">
                        {job.property?.customer?.name || 'Unknown Customer'}
                      </h3>
                      <Badge variant="info">{job.job_type}</Badge>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {job.property?.address}{job.property?.city ? `, ${job.property.city}` : ''}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                      {job.completed_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          Completed {format(new Date(job.completed_at), 'MMM d, yyyy')}
                        </span>
                      )}
                      {job.assigned_user && (
                        <span className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {job.assigned_user.name}
                        </span>
                      )}
                    </div>
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
