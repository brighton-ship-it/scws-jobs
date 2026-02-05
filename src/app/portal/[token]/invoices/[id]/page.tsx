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
import { PaymentModal } from '@/components/payments'

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
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [staxWebKey, setStaxWebKey] = useState<string | null>(null)
  const [customerInfo, setCustomerInfo] = useState<{ name: string; email: string | null } | null>(null)

  useEffect(() => {
    async function loadInvoice() {
      try {
        // Load invoice
        const res = await fetch(`/api/portal/${token}/invoices/${invoiceId}`)
        const data = await res.json()
        if (res.ok) {
          setInvoice(data.invoice)
        }
        
        // Load payment info (Stax key)
        const payRes = await fetch(`/api/portal/${token}/invoices/${invoiceId}/pay`)
        const payData = await payRes.json()
        if (payRes.ok) {
          setStaxWebKey(payData.staxWebPaymentsKey)
        }
        
        // Load customer info
        const portalRes = await fetch(`/api/portal/${token}`)
        const portalData = await portalRes.json()
        if (portalRes.ok && portalData.customer) {
          setCustomerInfo({
            name: portalData.customer.name,
            email: portalData.customer.email,
          })
        }
      } catch (err) {
        console.error('Failed to load invoice:', err)
      } finally {
        setIsLoading(false)
      }
    }
    
    loadInvoice()
  }, [token, invoiceId])

  const handlePaymentSuccess = async () => {
    setPaymentSuccess(true)
    setPaymentModalOpen(false)
    
    // Refresh invoice data
    try {
      const res = await fetch(`/api/portal/${token}/invoices/${invoiceId}`)
      const data = await res.json()
      if (res.ok) {
        setInvoice(data.invoice)
      }
    } catch (err) {
      console.error('Failed to refresh invoice:', err)
    }
  }

  // Keep the old handlePayment for backwards compatibility but it now opens the modal
  const handlePayment = () => {
    setPaymentModalOpen(true)
  }

  // Card fee for display
  const CARD_FEE_PERCENT = 3

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

      {/* Pay Now Section */}
      {!isPaid && (
        <Card className="border-[#4e9271]">
          <CardContent className="pt-6">
            <div className="text-center space-y-4">
              <div className="space-y-2">
                <p className="text-2xl font-bold text-red-600">${amountDue.toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">Balance Due</p>
              </div>
              
              <Button 
                onClick={() => setPaymentModalOpen(true)}
                className="w-full sm:w-auto px-8 bg-[#4e9271] hover:bg-[#3d7a5c] h-12 text-lg"
              >
                <CreditCard className="h-5 w-5 mr-2" />
                Pay Now
              </Button>
              
              <p className="text-xs text-muted-foreground">
                Pay securely with ACH bank transfer (no fee) or credit/debit card ({CARD_FEE_PERCENT}% fee)
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Modal */}
      <PaymentModal
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        invoiceId={invoice.id}
        invoiceNumber={invoice.invoice_number}
        amount={amountDue}
        customerName={customerInfo?.name}
        customerEmail={customerInfo?.email || undefined}
        cardFeePercent={CARD_FEE_PERCENT}
        staxWebKey={staxWebKey}
        portalToken={token}
        onPaymentSuccess={handlePaymentSuccess}
      />

      {/* Payment Success Banner */}
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
