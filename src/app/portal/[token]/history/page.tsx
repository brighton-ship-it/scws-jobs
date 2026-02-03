'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { 
  Wrench,
  Calendar,
  MapPin,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  FileText,
  ChevronRight
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { usePortal } from '../layout'

interface Job {
  id: string
  job_type: string
  status: string
  description: string | null
  scheduled_date: string | null
  completed_at: string | null
  property: {
    id: string
    address: string
    city: string | null
  }
  invoice: {
    id: string
    invoice_number: number
    status: string
    total: number
  } | null
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'completed':
    case 'invoiced':
      return <Badge className="bg-green-100 text-green-800 border-green-200">Completed</Badge>
    case 'scheduled':
      return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Scheduled</Badge>
    case 'in_progress':
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">In Progress</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
    case 'invoiced':
      return <CheckCircle className="h-5 w-5 text-green-600" />
    case 'scheduled':
      return <Clock className="h-5 w-5 text-blue-600" />
    case 'in_progress':
      return <Wrench className="h-5 w-5 text-yellow-600" />
    default:
      return <AlertCircle className="h-5 w-5 text-gray-400" />
  }
}

export default function ServiceHistoryPage() {
  const params = useParams()
  const token = params.token as string
  const { properties } = usePortal()
  
  const [jobs, setJobs] = useState<Job[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadHistory() {
      try {
        // Get portal data which includes recent jobs
        const res = await fetch(`/api/portal/${token}`)
        const data = await res.json()
        
        if (res.ok && data.recentJobs) {
          // For now we get limited data from the main endpoint
          // In a full implementation, we'd have a dedicated history endpoint
          setJobs(data.recentJobs || [])
        }
      } catch (err) {
        console.error('Failed to load history:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadHistory()
  }, [token])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#1f3b4d]" />
      </div>
    )
  }

  // Group jobs by property
  const jobsByProperty: Record<string, Job[]> = {}
  if (properties) {
    properties.forEach(prop => {
      jobsByProperty[prop.id] = []
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Service History</h2>
        <p className="text-muted-foreground">View your past and upcoming service appointments</p>
      </div>

      {/* Properties with Service History */}
      {properties && properties.length > 0 ? (
        <div className="space-y-6">
          {properties.map((property) => (
            <Card key={property.id}>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <CardTitle className="text-lg">{property.address}</CardTitle>
                    {property.city && (
                      <CardDescription>{property.city}</CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {jobs.length > 0 ? (
                  <div className="space-y-3">
                    {jobs.map((job) => (
                      <div 
                        key={job.id}
                        className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted/70 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`p-2 rounded-full ${
                            job.status === 'completed' || job.status === 'invoiced' 
                              ? 'bg-green-100' 
                              : job.status === 'scheduled' 
                                ? 'bg-blue-100'
                                : 'bg-yellow-100'
                          }`}>
                            {getStatusIcon(job.status)}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-medium">{job.job_type}</h4>
                              {getStatusBadge(job.status)}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                              <Calendar className="h-3 w-3" />
                              {job.completed_at 
                                ? `Completed: ${new Date(job.completed_at).toLocaleDateString()}`
                                : job.scheduled_date
                                  ? `Scheduled: ${new Date(job.scheduled_date).toLocaleDateString()}`
                                  : 'Date pending'
                              }
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-4">
                    No service history for this property yet.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">No Properties Found</h3>
              <p className="text-muted-foreground mt-2">
                We don&apos;t have any properties on file for your account.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-green-100">
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {jobs.filter(j => j.status === 'completed' || j.status === 'invoiced').length}
                </div>
                <div className="text-sm text-muted-foreground">Completed Services</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-blue-100">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {jobs.filter(j => j.status === 'scheduled').length}
                </div>
                <div className="text-sm text-muted-foreground">Upcoming Appointments</div>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-gray-100">
                <MapPin className="h-5 w-5 text-gray-600" />
              </div>
              <div>
                <div className="text-2xl font-bold">{properties?.length || 0}</div>
                <div className="text-sm text-muted-foreground">Properties on File</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CTA */}
      <Card className="bg-[#1f3b4d] text-white">
        <CardContent className="py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-medium">Need service?</h3>
              <p className="text-white/70">Schedule your next well service appointment</p>
            </div>
            <Link href="/book">
              <Button variant="secondary" className="whitespace-nowrap">
                Book Service
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* Contact */}
      <div className="text-center text-sm text-muted-foreground">
        <p>Questions about your service history?</p>
        <a href="tel:+17604408520" className="text-[#1f3b4d] font-medium">
          (760) 440-8520
        </a>
        <span className="mx-2">•</span>
        <a href="mailto:info@scwellservice.com" className="text-[#1f3b4d] font-medium">
          info@scwellservice.com
        </a>
      </div>
    </div>
  )
}
