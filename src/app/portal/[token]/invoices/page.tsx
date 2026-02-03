'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { 
  FileText, 
  Download,
  CreditCard,
  CheckCircle,
  Clock,
  AlertCircle,
  DollarSign,
  Calendar,
  Loader2,
  Eye
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface Invoice {
  id: string
  invoice_number: number
  status: string
  issue_date: string
  due_date: string | null
  subtotal: number
  tax_amount: number
  total: number
  amount_paid: number
  paid_at: string | null
  job: {
    id: string
    job_type: string
    status: string
    completed_at: string | null
    property: {
      id: string
      address: string
      city: string | null
    } | null
  } | null
}

interface InvoiceSummary {
  total: number
  outstanding: number
  paid: number
  unpaidCount: number
}

function getStatusBadge(status: string, dueDate: string | null) {
  const isOverdue = status !== 'paid' && dueDate && new Date(dueDate) < new Date()
  
  if (isOverdue) {
    return <Badge className="bg-red-100 text-red-800 border-red-200">Overdue</Badge>
  }
  
  switch (status) {
    case 'paid':
      return <Badge className="bg-green-100 text-green-800 border-green-200">Paid</Badge>
    case 'sent':
    case 'viewed':
      return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Payment Due</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

export default function PortalInvoicesPage() {
  const params = useParams()
  const token = params.token as string
  
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [summary, setSummary] = useState<InvoiceSummary>({ total: 0, outstanding: 0, paid: 0, unpaidCount: 0 })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadInvoices() {
      try {
        const res = await fetch(`/api/portal/${token}/invoices`)
        const data = await res.json()
        if (res.ok) {
          setInvoices(data.invoices || [])
          setSummary(data.summary || { total: 0, outstanding: 0, paid: 0, unpaidCount: 0 })
        }
      } catch (err) {
        console.error('Failed to load invoices:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadInvoices()
  }, [token])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#1f3b4d]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Invoices</h2>
        <p className="text-muted-foreground">View and pay your invoices</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Outstanding Balance</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${summary.outstanding > 0 ? 'text-red-600' : ''}`}>
              ${summary.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
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
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
          </CardContent>
        </Card>
      </div>

      {/* Outstanding Invoice Alert */}
      {summary.outstanding > 0 && (
        <Card className="border-yellow-200 bg-yellow-50">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-yellow-600" />
                <div>
                  <p className="font-medium">You have {summary.unpaidCount} unpaid invoice{summary.unpaidCount !== 1 ? 's' : ''}</p>
                  <p className="text-sm text-muted-foreground">
                    ${summary.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })} total due
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoices List */}
      <Card>
        <CardHeader>
          <CardTitle>Your Invoices</CardTitle>
          <CardDescription>Click on an invoice to view details and pay</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {invoices.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              No invoices found
            </div>
          ) : (
            <div className="divide-y">
              {invoices.map((invoice) => {
                const amountDue = Number(invoice.total) - Number(invoice.amount_paid)
                
                return (
                  <Link 
                    key={invoice.id}
                    href={`/portal/${token}/invoices/${invoice.id}`}
                  >
                    <div className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-full ${
                          invoice.status === 'paid' ? 'bg-green-100' : 'bg-yellow-100'
                        }`}>
                          {invoice.status === 'paid' ? (
                            <CheckCircle className="h-5 w-5 text-green-600" />
                          ) : (
                            <Clock className="h-5 w-5 text-yellow-600" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-medium">Invoice #{invoice.invoice_number}</h4>
                            {getStatusBadge(invoice.status, invoice.due_date)}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {invoice.job?.job_type || 'Service'}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(invoice.issue_date).toLocaleDateString()}
                            {invoice.status !== 'paid' && invoice.due_date && (
                              <>
                                <span>•</span>
                                <span>Due: {new Date(invoice.due_date).toLocaleDateString()}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="font-bold">
                            ${Number(invoice.total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </div>
                          {invoice.status === 'paid' ? (
                            <div className="text-xs text-green-600">Paid in full</div>
                          ) : (
                            <div className="text-xs text-red-600">
                              ${amountDue.toLocaleString('en-US', { minimumFractionDigits: 2 })} due
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button variant="ghost" size="icon" className="hidden sm:flex">
                            <Eye className="h-4 w-4" />
                          </Button>
                          {invoice.status !== 'paid' && (
                            <Button size="sm" className="bg-[#4e9271] hover:bg-[#3d7a5c]">
                              <CreditCard className="h-4 w-4 sm:mr-2" />
                              <span className="hidden sm:inline">Pay</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact */}
      <div className="text-center text-sm text-muted-foreground">
        <p>Questions about an invoice?</p>
        <a href="tel:+17604408520" className="text-[#1f3b4d] font-medium">
          (760) 440-8520
        </a>
        <span className="mx-2">•</span>
        <a href="mailto:billing@scwellservice.com" className="text-[#1f3b4d] font-medium">
          billing@scwellservice.com
        </a>
      </div>
    </div>
  )
}
