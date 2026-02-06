'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InvoiceStatusBadge } from '@/components/ui/badge';
import { Input } from '@/components/forms/Input';
import { Select } from '@/components/forms/Select';
import { TextArea } from '@/components/forms/TextArea';
import { Modal } from '@/components/feedback/Modal';
import { 
  ArrowLeft, Edit, Send, Download, Mail, DollarSign,
  Check, X, Clock, Printer, Building2, CreditCard, Trash2,
  AlertTriangle, Loader2
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

// Dynamically import PDF components
const InvoicePDF = dynamic(
  () => import('@/components/pdf/InvoicePDF').then(mod => ({ default: mod.InvoicePDF })),
  { ssr: false }
);

const PDFDownloadLink = dynamic(
  () => import('@react-pdf/renderer').then(mod => mod.PDFDownloadLink),
  { ssr: false }
);

const paymentMethodOptions = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card', label: 'Credit/Debit Card' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
];

export default function InvoiceDetailPage() {
  const router = useRouter();
  const params = useParams();
  const invoiceId = params.id as string;

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  
  // Payment form state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [paymentNotes, setPaymentNotes] = useState('');
  
  // Data state - fetch from API
  const [invoiceData, setInvoiceData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch invoice data
  useEffect(() => {
    async function fetchInvoice() {
      try {
        setLoading(true);
        const res = await fetch(`/api/invoices/${invoiceId}`);
        if (!res.ok) throw new Error('Invoice not found');
        const data = await res.json();
        setInvoiceData(data.invoice);
        if (data.invoice?.customer?.email) {
          setSendEmail(data.invoice.customer.email);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoice');
      } finally {
        setLoading(false);
      }
    }
    fetchInvoice();
  }, [invoiceId]);

  // Calculate derived values (must be before early return for hooks consistency)
  const balanceDue = invoiceData ? invoiceData.total - (invoiceData.amount_paid || 0) : 0;

  const openPaymentModal = useCallback(() => {
    setPaymentAmount(balanceDue.toFixed(2));
    setShowPaymentModal(true);
  }, [balanceDue]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading invoice...</span>
      </div>
    );
  }

  if (error || !invoiceData) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Invoice not found</h2>
        <p className="text-gray-500 mt-2">{error || "The invoice you're looking for doesn't exist."}</p>
        <Button href="/invoices" variant="outline" className="mt-4">
          Back to Invoices
        </Button>
      </div>
    );
  }

  const { customer, items, payments = [] } = invoiceData;
  const daysOverdue = invoiceData.due_date && invoiceData.status !== 'paid'
    ? differenceInDays(new Date(), new Date(invoiceData.due_date))
    : 0;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleSendInvoice = async () => {
    setSending(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    // TODO: Implement actual send logic
    setSending(false);
    setShowSendModal(false);
  };

  const handleRecordPayment = async () => {
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      alert('Please enter a valid payment amount');
      return;
    }

    setSavingPayment(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // TODO: Implement actual payment recording logic

    setSavingPayment(false);
    setShowPaymentModal(false);
    
    // Reset form
    setPaymentAmount('');
    setPaymentMethod('');
    setPaymentReference('');
    setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
    setPaymentNotes('');
    
    // In a real app, this would refresh the data
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/invoices" className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">Invoice #{invoiceData.invoice_number}</h2>
              <InvoiceStatusBadge status={invoiceData.status} />
              {daysOverdue > 0 && invoiceData.status !== 'paid' && (
                <span className="flex items-center gap-1 text-sm text-red-600 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  {daysOverdue} days overdue
                </span>
              )}
            </div>
            <p className="text-gray-600">Created {format(new Date(invoiceData.created_at), 'MMMM d, yyyy')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {invoiceData.status === 'draft' && (
            <>
              <Button variant="outline" href={`/invoices/${invoiceId}/edit`}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              <Button onClick={() => {
                setSendEmail(customer.email || '');
                setShowSendModal(true);
              }}>
                <Send className="h-4 w-4" />
                Send Invoice
              </Button>
            </>
          )}
          {invoiceData.status !== 'paid' && invoiceData.status !== 'void' && invoiceData.status !== 'draft' && (
            <>
              <Button variant="outline" onClick={() => {
                setSendEmail(customer.email || '');
                setShowSendModal(true);
              }}>
                <Mail className="h-4 w-4" />
                Resend
              </Button>
              <Button onClick={openPaymentModal}>
                <DollarSign className="h-4 w-4" />
                Record Payment
              </Button>
            </>
          )}
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      {/* Status Timeline */}
      <Card className="print:hidden">
        <CardContent className="py-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                invoiceData.status !== 'draft' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
              }`}>
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">Created</p>
                <p className="text-gray-500">{format(new Date(invoiceData.created_at), 'MMM d, yyyy')}</p>
              </div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4" />
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                invoiceData.sent_at ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
              }`}>
                <Send className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">Sent</p>
                <p className="text-gray-500">
                  {invoiceData.sent_at ? format(new Date(invoiceData.sent_at), 'MMM d, yyyy') : 'Not sent'}
                </p>
              </div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4" />
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                invoiceData.status === 'paid' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
              }`}>
                <DollarSign className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">Paid</p>
                <p className="text-gray-500">
                  {invoiceData.paid_at ? format(new Date(invoiceData.paid_at), 'MMM d, yyyy') : 
                   invoiceData.status === 'paid' ? 'Paid' : 'Pending'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Balance Due Banner */}
      {invoiceData.status !== 'paid' && invoiceData.status !== 'void' && balanceDue > 0 && (
        <Card className={`print:hidden ${daysOverdue > 0 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  daysOverdue > 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                }`}>
                  <DollarSign className="h-5 w-5" />
                </div>
                <div>
                  <p className={`text-lg font-bold ${daysOverdue > 0 ? 'text-red-900' : 'text-amber-900'}`}>
                    Balance Due: {formatCurrency(balanceDue)}
                  </p>
                  <p className={`text-sm ${daysOverdue > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                    {invoiceData.due_date 
                      ? `Due ${format(new Date(invoiceData.due_date), 'MMMM d, yyyy')}`
                      : 'No due date set'}
                  </p>
                </div>
              </div>
              <Button onClick={openPaymentModal}>
                <CreditCard className="h-4 w-4" />
                Record Payment
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Invoice Preview */}
        <div className="lg:col-span-2">
          <Card className="print:shadow-none print:border-none">
            <CardContent className="p-8">
              {/* Header */}
              <div className="flex justify-between items-start mb-8">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">INVOICE</h1>
                  <p className="text-lg text-gray-600">#{invoiceData.invoice_number}</p>
                </div>
                <div className="text-right">
                  <h2 className="text-xl font-bold text-blue-600">SCWS</h2>
                  <p className="text-gray-600">So Cal Well Service</p>
                  <p className="text-sm text-gray-500">
                    123 Main Street<br />
                    Palm Desert, CA 92260<br />
                    (760) 555-0100
                  </p>
                </div>
              </div>

              {/* Customer & Invoice Info */}
              <div className="grid grid-cols-2 gap-8 mb-8">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Bill To</h3>
                  <div className="flex items-start gap-2">
                    <Building2 className="h-4 w-4 text-gray-400 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">{customer.name}</p>
                      {customer.billing_address && (
                        <p className="text-gray-600 text-sm">{customer.billing_address}</p>
                      )}
                      {customer.email && (
                        <p className="text-gray-600 text-sm">{customer.email}</p>
                      )}
                      {customer.phone && (
                        <p className="text-gray-600 text-sm">{customer.phone}</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm text-gray-500">Invoice Date</p>
                      <p className="font-medium">{format(new Date(invoiceData.issue_date), 'MMMM d, yyyy')}</p>
                    </div>
                    {invoiceData.due_date && (
                      <div>
                        <p className="text-sm text-gray-500">Due Date</p>
                        <p className={`font-medium ${daysOverdue > 0 && invoiceData.status !== 'paid' ? 'text-red-600' : ''}`}>
                          {format(new Date(invoiceData.due_date), 'MMMM d, yyyy')}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div className="mb-8">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-3 text-sm font-medium text-gray-500 uppercase">Description</th>
                      <th className="text-right py-3 text-sm font-medium text-gray-500 uppercase w-20">Qty</th>
                      <th className="text-right py-3 text-sm font-medium text-gray-500 uppercase w-28">Unit Price</th>
                      <th className="text-right py-3 text-sm font-medium text-gray-500 uppercase w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b border-gray-100">
                        <td className="py-3">
                          <p className="text-gray-900">{item.description}</p>
                          {item.item_type && (
                            <p className="text-xs text-gray-500 capitalize">{item.item_type}</p>
                          )}
                        </td>
                        <td className="text-right py-3 text-gray-600">{item.quantity}</td>
                        <td className="text-right py-3 text-gray-600">{formatCurrency(item.unit_price)}</td>
                        <td className="text-right py-3 font-medium text-gray-900">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-72 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="font-medium">{formatCurrency(invoiceData.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Tax ({invoiceData.tax_rate}%)</span>
                    <span className="font-medium">{formatCurrency(invoiceData.tax_amount)}</span>
                  </div>
                  <div className="flex justify-between text-lg border-t border-gray-200 pt-2">
                    <span className="font-semibold">Total</span>
                    <span className="font-bold text-gray-900">{formatCurrency(invoiceData.total)}</span>
                  </div>
                  {invoiceData.amount_paid > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Amount Paid</span>
                      <span className="font-medium">-{formatCurrency(invoiceData.amount_paid)}</span>
                    </div>
                  )}
                  {invoiceData.status === 'paid' ? (
                    <div className="flex justify-between text-lg bg-green-100 p-3 rounded-lg -mx-3">
                      <span className="font-bold text-green-700">PAID IN FULL</span>
                      <span className="font-bold text-green-700">{formatCurrency(0)}</span>
                    </div>
                  ) : balanceDue > 0 && (
                    <div className="flex justify-between text-lg bg-amber-100 p-3 rounded-lg -mx-3">
                      <span className="font-bold text-amber-700">Balance Due</span>
                      <span className="font-bold text-amber-700">{formatCurrency(balanceDue)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {invoiceData.notes && (
                <div className="mt-8 pt-6 border-t border-gray-200">
                  <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Notes</h3>
                  <p className="text-gray-600 whitespace-pre-wrap">{invoiceData.notes}</p>
                </div>
              )}

              {/* Footer */}
              <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                <p className="text-sm text-gray-500">
                  Thank you for your business!
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Questions? Call us at (760) 555-0100 or email info@scwellservice.com
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6 print:hidden">
          {/* Payment History */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-gray-400" />
                Payment History
              </CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-gray-500 text-sm">No payments recorded yet</p>
                  {invoiceData.status !== 'paid' && invoiceData.status !== 'void' && (
                    <Button 
                      variant="outline" 
                      className="mt-3"
                      onClick={openPaymentModal}
                    >
                      <DollarSign className="h-4 w-4" />
                      Record Payment
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {payments.map((payment) => (
                    <div 
                      key={payment.id} 
                      className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-gray-900">
                          {formatCurrency(payment.amount)}
                        </p>
                        <p className="text-sm text-gray-500">
                          {format(new Date(payment.payment_date), 'MMM d, yyyy')}
                          {payment.payment_method && ` • ${payment.payment_method}`}
                        </p>
                        {payment.reference_number && (
                          <p className="text-xs text-gray-400">Ref: {payment.reference_number}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-green-600">
                        <Check className="h-4 w-4" />
                      </div>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-gray-200">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500">Total Paid</span>
                      <span className="font-medium text-green-600">
                        {formatCurrency(invoiceData.amount_paid)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Internal Notes */}
          {invoiceData.internal_notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Internal Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 text-sm">{invoiceData.internal_notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start" onClick={handlePrint}>
                <Printer className="h-4 w-4" />
                Print Invoice
              </Button>
              {invoiceData.status !== 'void' && (
                <Button variant="outline" className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50">
                  <X className="h-4 w-4" />
                  Void Invoice
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Record Payment Modal */}
      <Modal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        title="Record Payment"
        description={`Recording payment for Invoice #${invoiceData.invoice_number}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setShowPaymentModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleRecordPayment} disabled={savingPayment}>
              {savingPayment ? 'Saving...' : 'Record Payment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Balance Due</span>
              <span className="font-bold text-gray-900">{formatCurrency(balanceDue)}</span>
            </div>
          </div>
          
          <Input
            label="Payment Amount"
            type="number"
            step="0.01"
            min="0"
            max={balanceDue}
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            leftIcon={<span className="text-gray-400">$</span>}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="Payment Method"
              options={[{ value: '', label: 'Select method' }, ...paymentMethodOptions]}
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            />
            <Input
              label="Reference #"
              placeholder="Check #, Transaction ID, etc."
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
            />
          </div>

          <Input
            label="Payment Date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            required
          />

          <TextArea
            label="Notes"
            placeholder="Optional payment notes..."
            value={paymentNotes}
            onChange={(e) => setPaymentNotes(e.target.value)}
            rows={2}
          />
        </div>
      </Modal>

      {/* Send Invoice Modal */}
      <Modal
        isOpen={showSendModal}
        onClose={() => setShowSendModal(false)}
        title="Send Invoice"
        description="Send this invoice to the customer via email."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowSendModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendInvoice} disabled={sending || !sendEmail}>
              {sending ? 'Sending...' : 'Send Invoice'}
            </Button>
          </>
        }
      >
        <Input
          label="Email Address"
          type="email"
          value={sendEmail}
          onChange={(e) => setSendEmail(e.target.value)}
          placeholder="customer@example.com"
        />
        <p className="text-sm text-gray-500 mt-3">
          The customer will receive an email with a PDF invoice attached.
        </p>
      </Modal>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:shadow-none, .print\\:shadow-none * {
            visibility: visible;
          }
          .print\\:shadow-none {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
