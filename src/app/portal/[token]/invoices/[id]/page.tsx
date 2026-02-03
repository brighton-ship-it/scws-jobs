'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft,
  Download,
  CreditCard,
  CheckCircle,
  Calendar,
  MapPin,
  Loader2,
  AlertCircle,
  Banknote,
  Building2,
  Check
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface InvoiceItem {
  id: string
  description: string
  item_description: string | null
  quantity: number
  unit_price: number
  total: number
  item_type: string | null
}

interface Payment {
  id: string
  amount: number
  payment_method: string | null
  payment_date: string
  reference_number: string | null
}

interface InvoiceDetail {
  id: string
  invoice_number: number
  status: string
  issue_date: string
  due_date: string | null
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  amount_paid: number
  notes: string | null
  paid_at: string | null
  items: InvoiceItem[]
  payments: Payment[]
  job: {
    id: string
    job_type: string
    description: string | null
    completed_at: string | null
    scheduled_date: string | null
    property: {
      id: string
      address: string
      city: string | null
      zip: string | null
    } | null
  } | null
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

export default function InvoiceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string
  const invoiceId = params.id as string
  
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessingPayment, setIsProcessingPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'ach'>('card')
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)

  useEffect(() => {
    async function loadInvoice() {
      try {
        const res = await fetch(`/api/portal/${token}/invoices/${invoiceId}`)
        const data = await res.json()
        if (res.ok) {
          setInvoice(data.invoice)
        }
      } catch (err) {
        console.error('Failed to load invoice:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadInvoice()
  }, [token, invoiceId])

  const handlePayment = async () => {
    if (!invoice) return
    
    setIsProcessingPayment(true)
    setPaymentError(null)
    
    const amountDue = Number(invoice.total) - Number(invoice.amount_paid)
    // Add 3% processing fee for card payments
    const processingFee = paymentMethod === 'card' ? amountDue * 0.03 : 0
    const totalPayment = amountDue + processingFee
    
    try {
      const res = await fetch(`/api/portal/${token}/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod,
          amount: amountDue,
          processingFee: processingFee,
          totalCharged: totalPayment,
        }),
      })
      
      const data = await res.json()
      
      if (res.ok && data.success) {
        setPaymentSuccess(true)
        // Refresh invoice data
        const refreshRes = await fetch(`/api/portal/${token}/invoices/${invoiceId}`)
        const refreshData = await refreshRes.json()
        if (refreshRes.ok) {
          setInvoice(refreshData.invoice)
        }
      } else {
        setPaymentError(data.error || 'Payment failed')
      }
    } catch (err) {
      setPaymentError('An error occurred processing your payment')
      console.error(err)
    } finally {
      setIsProcessingPayment(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#1f3b4d]" />
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 mx-auto text-red-500 mb-4" />
        <h2 className="text-xl font-bold">Invoice Not Found</h2>
        <p className="text-muted-foreground mt-2">This invoice could not be loaded.</p>
        <Link href={`/portal/${token}/invoices`}>
          <Button className="mt-4">Back to Invoices</Button>
        </Link>
      </div>
    )
  }

  const amountDue = Number(invoice.total) - Number(invoice.amount_paid)
  const isPaid = invoice.status === 'paid' || amountDue <= 0

  return (
    <div className="space-y-6">
      {/* Back Link */}
      <Link href={`/portal/${token}/invoices`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Invoices
      </Link>

      {/* Invoice Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold">Invoice #{invoice.invoice_number}</h1>
            {getStatusBadge(invoice.status, invoice.due_date)}
          </div>
          <p className="text-muted-foreground">
            Issued: {new Date(invoice.issue_date).toLocaleDateString()}
            {invoice.due_date && ` • Due: ${new Date(invoice.due_date).toLocaleDateString()}`}
          </p>
        </div>
        {!isPaid && (
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Amount Due</div>
            <div className="text-3xl font-bold text-red-600">
              ${amountDue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          </div>
        )}
      </div>

      {/* Payment Success */}
      {paymentSuccess && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="h-6 w-6 text-green-600" />
              <div>
                <p className="font-medium text-green-800">Payment Successful!</p>
                <p className="text-sm text-green-700">Thank you for your payment.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job/Property Info */}
      {invoice.job?.property && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <MapPin className="h-5 w-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="font-medium">{invoice.job.property.address}</p>
                {invoice.job.property.city && (
                  <p className="text-sm text-muted-foreground">
                    {invoice.job.property.city}
                    {invoice.job.property.zip && `, ${invoice.job.property.zip}`}
                  </p>
                )}
                <p className="text-sm text-muted-foreground mt-1">
                  Service: {invoice.job.job_type}
                  {invoice.job.completed_at && (
                    <> • Completed: {new Date(invoice.job.completed_at).toLocaleDateString()}</>
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Line Items */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-4 font-medium">Description</th>
                  <th className="text-right p-4 font-medium">Qty</th>
                  <th className="text-right p-4 font-medium">Price</th>
                  <th className="text-right p-4 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoice.items.map((item) => (
                  <tr key={item.id}>
                    <td className="p-4">
                      <div>{item.description}</div>
                      {item.item_description && (
                        <div className="text-sm text-muted-foreground">{item.item_description}</div>
                      )}
                    </td>
                    <td className="p-4 text-right">{Number(item.quantity)}</td>
                    <td className="p-4 text-right">${Number(item.unit_price).toFixed(2)}</td>
                    <td className="p-4 text-right font-medium">${Number(item.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30">
                <tr>
                  <td colSpan={3} className="p-4 text-right font-medium">Subtotal</td>
                  <td className="p-4 text-right">${Number(invoice.subtotal).toFixed(2)}</td>
                </tr>
                {Number(invoice.tax_amount) > 0 && (
                  <tr>
                    <td colSpan={3} className="p-4 text-right text-muted-foreground">
                      Tax ({Number(invoice.tax_rate)}%)
                    </td>
                    <td className="p-4 text-right">${Number(invoice.tax_amount).toFixed(2)}</td>
                  </tr>
                )}
                <tr className="font-bold">
                  <td colSpan={3} className="p-4 text-right">Total</td>
                  <td className="p-4 text-right">${Number(invoice.total).toFixed(2)}</td>
                </tr>
                {Number(invoice.amount_paid) > 0 && (
                  <>
                    <tr className="text-green-600">
                      <td colSpan={3} className="p-4 text-right">Paid</td>
                      <td className="p-4 text-right">-${Number(invoice.amount_paid).toFixed(2)}</td>
                    </tr>
                    <tr className="font-bold text-lg">
                      <td colSpan={3} className="p-4 text-right">Balance Due</td>
                      <td className="p-4 text-right text-red-600">${amountDue.toFixed(2)}</td>
                    </tr>
                  </>
                )}
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      {invoice.notes && (
        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground whitespace-pre-wrap">{invoice.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Payment History */}
      {invoice.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Payment History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invoice.payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg bg-green-50 border border-green-100">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium">${Number(payment.amount).toFixed(2)}</p>
                      <p className="text-sm text-muted-foreground">
                        {payment.payment_method} • {new Date(payment.payment_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {payment.reference_number && (
                    <span className="text-xs text-muted-foreground">Ref: {payment.reference_number}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Form */}
      {!isPaid && (
        <Card className="border-[#4e9271]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Pay Now
            </CardTitle>
            <CardDescription>
              Securely pay your invoice online
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {paymentError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  <span>{paymentError}</span>
                </div>
              </div>
            )}

            {/* Payment Method Selection */}
            <div className="space-y-3">
              <Label>Payment Method</Label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('card')}
                  className={`p-4 rounded-lg border-2 transition-colors ${
                    paymentMethod === 'card' 
                      ? 'border-[#4e9271] bg-[#4e9271]/5' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <CreditCard className={`h-6 w-6 mx-auto mb-2 ${paymentMethod === 'card' ? 'text-[#4e9271]' : 'text-gray-400'}`} />
                  <div className="font-medium">Credit Card</div>
                  <div className="text-xs text-muted-foreground">3% processing fee</div>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('ach')}
                  className={`p-4 rounded-lg border-2 transition-colors ${
                    paymentMethod === 'ach' 
                      ? 'border-[#4e9271] bg-[#4e9271]/5' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <Building2 className={`h-6 w-6 mx-auto mb-2 ${paymentMethod === 'ach' ? 'text-[#4e9271]' : 'text-gray-400'}`} />
                  <div className="font-medium">Bank Transfer</div>
                  <div className="text-xs text-muted-foreground">No fee</div>
                </button>
              </div>
            </div>

            {/* Payment Summary */}
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span>Invoice Amount</span>
                <span>${amountDue.toFixed(2)}</span>
              </div>
              {paymentMethod === 'card' && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Processing Fee (3%)</span>
                  <span>${(amountDue * 0.03).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
                <span>Total</span>
                <span>
                  ${paymentMethod === 'card' 
                    ? (amountDue * 1.03).toFixed(2) 
                    : amountDue.toFixed(2)
                  }
                </span>
              </div>
            </div>

            {/* Demo Notice */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-800 text-sm">
              <p className="font-medium">Demo Mode</p>
              <p>Payment processing is in demo mode. Click "Pay Now" to simulate a successful payment.</p>
            </div>

            {/* Pay Button */}
            <Button 
              onClick={handlePayment}
              disabled={isProcessingPayment}
              className="w-full bg-[#4e9271] hover:bg-[#3d7a5c] h-12 text-lg"
            >
              {isProcessingPayment ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Check className="h-5 w-5 mr-2" />
                  Pay ${paymentMethod === 'card' 
                    ? (amountDue * 1.03).toFixed(2) 
                    : amountDue.toFixed(2)
                  }
                </>
              )}
            </Button>

            <p className="text-xs text-center text-muted-foreground">
              Payments are processed securely. Your payment information is never stored on our servers.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Contact */}
      <div className="text-center text-sm text-muted-foreground">
        <p>Questions about this invoice?</p>
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
