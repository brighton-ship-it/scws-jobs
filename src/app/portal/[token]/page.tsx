'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { 
  DollarSign, 
  FileText, 
  MapPin,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Phone,
  Wrench
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { usePortal } from './layout'

interface DashboardData {
  customer: {
    id: string
    name: string
    email: string | null
    phone: string | null
    billing_address: string | null
  }
  properties: {
    id: string
    address: string
    city: string | null
  }[]
  invoiceSummary: {
    total: number
    outstanding: number
    paid: number
  }
  recentJobs: {
    id: string
    job_type: string
    status: string
    completed_at: string | null
  }[]
}

export default function PortalDashboard() {
  const params = useParams()
  const token = params.token as string
  const { customer, properties } = usePortal()
  
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadDashboard() {
      try {
        const res = await fetch(`/api/portal/${token}`)
        const result = await res.json()
        if (res.ok) {
          setData(result)
        }
      } catch (err) {
        console.error('Failed to load dashboard:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadDashboard()
  }, [token])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        <div className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-32 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  const summary = data?.invoiceSummary || { total: 0, outstanding: 0, paid: 0 }

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div>
        <h2 className="text-2xl font-bold">Welcome back{customer ? `, ${customer.name}` : ''}!</h2>
        <p className="text-muted-foreground">Manage your account, view invoices, and schedule service.</p>
      </div>

      {/* Quick Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.outstanding > 0 ? 'text-red-600' : 'text-green-600'}`}>
              ${summary.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            {summary.outstanding > 0 && (
              <Link href={`/portal/${token}/invoices`}>
                <Button size="sm" className="mt-2 bg-[#4e9271] hover:bg-[#3d7a5c]">
                  Pay Now
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paid This Year</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${summary.paid.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.total} total invoices
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Properties</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{properties?.length || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              on file
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Outstanding Balance Alert */}
      {summary.outstanding > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="font-medium">You have an outstanding balance</p>
                  <p className="text-sm text-muted-foreground">
                    ${summary.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })} due
                  </p>
                </div>
              </div>
              <Link href={`/portal/${token}/invoices`}>
                <Button className="bg-[#4e9271] hover:bg-[#3d7a5c]">
                  View Invoices
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Properties */}
      <Card>
        <CardHeader>
          <CardTitle>Your Properties</CardTitle>
          <CardDescription>Service locations on file</CardDescription>
        </CardHeader>
        <CardContent>
          {properties && properties.length > 0 ? (
            <div className="space-y-3">
              {properties.map((property) => (
                <div 
                  key={property.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                >
                  <MapPin className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{property.address}</p>
                    {property.city && (
                      <p className="text-sm text-muted-foreground">{property.city}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">No properties on file</p>
          )}
        </CardContent>
      </Card>

      {/* Recent Service */}
      {data?.recentJobs && data.recentJobs.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Service</CardTitle>
              <CardDescription>Your latest service activity</CardDescription>
            </div>
            <Link href={`/portal/${token}/history`}>
              <Button variant="outline" size="sm">
                View All
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recentJobs.slice(0, 3).map((job) => (
                <div 
                  key={job.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Wrench className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{job.job_type}</p>
                      {job.completed_at && (
                        <p className="text-sm text-muted-foreground">
                          {new Date(job.completed_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <Badge 
                    variant="outline"
                    className={
                      job.status === 'completed' ? 'bg-green-100 text-green-800 border-green-200' :
                      job.status === 'scheduled' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                      'bg-gray-100'
                    }
                  >
                    {job.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Need Help?</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <a href="tel:+17604408520">
            <Button variant="outline">
              <Phone className="mr-2 h-4 w-4" />
              Call Us
            </Button>
          </a>
          <Link href="/book">
            <Button className="bg-[#1f3b4d] hover:bg-[#2c5268]">
              Book Service
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
