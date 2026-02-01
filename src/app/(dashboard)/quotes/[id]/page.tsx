'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
// import dynamic from 'next/dynamic';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { QuoteStatusBadge } from '@/components/ui/Badge';
import { Input } from '@/components/forms/Input';
import { Modal } from '@/components/feedback/Modal';
import { getQuoteWithDetails } from '@/lib/mock-data';
import { 
  ArrowLeft, Edit, Send, FileText, Download, Mail, 
  Check, X, Clock, Printer, Building2, MapPin, Loader2
} from 'lucide-react';
import { format } from 'date-fns';

// PDF components temporarily disabled for stability
// TODO: Fix react-pdf compatibility issues
const QuotePDF = null;
const PDFDownloadLink = null;

export default function QuoteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const quoteId = params.id as string;
  const printRef = useRef<HTMLDivElement>(null);
  
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const quoteData = getQuoteWithDetails(quoteId);

  if (!quoteData) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Quote not found</h2>
        <p className="text-gray-500 mt-2">The quote you're looking for doesn't exist.</p>
        <Button href="/quotes" variant="outline" className="mt-4">
          Back to Quotes
        </Button>
      </div>
    );
  }

  const { customer, property, items } = quoteData;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleSendQuote = async () => {
    setSending(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('Sending quote to:', sendEmail);
    setSending(false);
    setShowSendModal(false);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleConvertToInvoice = () => {
    router.push(`/invoices/new?from_quote=${quoteId}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Link href="/quotes" className="p-2 rounded-lg hover:bg-gray-100">
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-gray-900">Quote #{quoteData.quote_number}</h2>
              <QuoteStatusBadge status={quoteData.status} />
            </div>
            <p className="text-gray-600">Created {format(new Date(quoteData.created_at), 'MMMM d, yyyy')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {quoteData.status === 'draft' && (
            <>
              <Button variant="outline" href={`/quotes/${quoteId}/edit`}>
                <Edit className="h-4 w-4" />
                Edit
              </Button>
              <Button onClick={() => {
                setSendEmail(customer.email || '');
                setShowSendModal(true);
              }}>
                <Send className="h-4 w-4" />
                Send Quote
              </Button>
            </>
          )}
          {quoteData.status === 'sent' && (
            <>
              <Button variant="outline" onClick={() => {
                setSendEmail(customer.email || '');
                setShowSendModal(true);
              }}>
                <Mail className="h-4 w-4" />
                Resend
              </Button>
              <Button variant="secondary" onClick={() => {}}>
                <X className="h-4 w-4" />
                Mark Declined
              </Button>
              <Button onClick={() => {}}>
                <Check className="h-4 w-4" />
                Mark Accepted
              </Button>
            </>
          )}
          {quoteData.status === 'accepted' && (
            <Button onClick={handleConvertToInvoice}>
              <FileText className="h-4 w-4" />
              Convert to Invoice
            </Button>
          )}
          {mounted && PDFDownloadLink && (
            <PDFDownloadLink 
              document={<QuotePDF quote={quoteData} />} 
              fileName={`quote-${quoteData.quote_number}.pdf`}
            >
              {({ loading }) =>
                loading ? (
                  <Button disabled variant="outline">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </Button>
                ) : (
                  <Button variant="outline">
                    <Download className="h-4 w-4" />
                    Download PDF
                  </Button>
                )
              }
            </PDFDownloadLink>
          )}
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Print
          </Button>
        </div>
      </div>

      {/* Quote Status Timeline */}
      <Card className="print:hidden">
        <CardContent className="py-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                quoteData.status !== 'draft' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
              }`}>
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">Created</p>
                <p className="text-gray-500">{format(new Date(quoteData.created_at), 'MMM d, yyyy')}</p>
              </div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4" />
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                quoteData.sent_at ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
              }`}>
                <Send className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium">Sent</p>
                <p className="text-gray-500">
                  {quoteData.sent_at ? format(new Date(quoteData.sent_at), 'MMM d, yyyy') : 'Not sent'}
                </p>
              </div>
            </div>
            <div className="flex-1 h-px bg-gray-200 mx-4" />
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                quoteData.status === 'accepted' ? 'bg-green-100 text-green-600' : 
                quoteData.status === 'declined' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-400'
              }`}>
                {quoteData.status === 'accepted' ? <Check className="h-4 w-4" /> : 
                 quoteData.status === 'declined' ? <X className="h-4 w-4" /> : 
                 <Check className="h-4 w-4" />}
              </div>
              <div>
                <p className="font-medium">Response</p>
                <p className="text-gray-500">
                  {quoteData.accepted_at ? format(new Date(quoteData.accepted_at), 'MMM d, yyyy') : 
                   quoteData.status === 'declined' ? 'Declined' : 'Pending'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quote Preview (Print-friendly) */}
      <div ref={printRef} className="print:p-8">
        <Card className="print:shadow-none print:border-none">
          <CardContent className="p-8">
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">QUOTE</h1>
                <p className="text-lg text-gray-600">#{quoteData.quote_number}</p>
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

            {/* Customer & Quote Info */}
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
                {property && (
                  <div className="mt-4">
                    <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Service Location</h3>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-gray-400 mt-0.5" />
                      <div>
                        <p className="text-gray-600 text-sm">
                          {property.address}
                          {property.city && `, ${property.city}`}
                          {property.zip && ` ${property.zip}`}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="space-y-2">
                  <div>
                    <p className="text-sm text-gray-500">Quote Date</p>
                    <p className="font-medium">{format(new Date(quoteData.created_at), 'MMMM d, yyyy')}</p>
                  </div>
                  {quoteData.valid_until && (
                    <div>
                      <p className="text-sm text-gray-500">Valid Until</p>
                      <p className={`font-medium ${new Date(quoteData.valid_until) < new Date() ? 'text-red-600' : ''}`}>
                        {format(new Date(quoteData.valid_until), 'MMMM d, yyyy')}
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
              <div className="w-64 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium">{formatCurrency(quoteData.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tax ({quoteData.tax_rate}%)</span>
                  <span className="font-medium">{formatCurrency(quoteData.tax_amount)}</span>
                </div>
                <div className="flex justify-between text-lg border-t border-gray-200 pt-2">
                  <span className="font-semibold">Total</span>
                  <span className="font-bold text-gray-900">{formatCurrency(quoteData.total)}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {quoteData.notes && (
              <div className="mt-8 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Notes</h3>
                <p className="text-gray-600 whitespace-pre-wrap">{quoteData.notes}</p>
              </div>
            )}

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-gray-200 text-center">
              <p className="text-sm text-gray-500">
                Thank you for choosing So Cal Well Service!
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Questions? Call us at (760) 555-0100 or email info@scwellservice.com
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Internal Notes (not printed) */}
      {quoteData.internal_notes && (
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle className="text-sm">Internal Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 text-sm">{quoteData.internal_notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Send Quote Modal */}
      <Modal
        isOpen={showSendModal}
        onClose={() => setShowSendModal(false)}
        title="Send Quote"
        description="Send this quote to the customer via email."
        footer={
          <>
            <Button variant="outline" onClick={() => setShowSendModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendQuote} disabled={sending || !sendEmail}>
              {sending ? 'Sending...' : 'Send Quote'}
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
          The customer will receive an email with a link to view and accept/decline the quote.
        </p>
      </Modal>

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:p-8, .print\\:p-8 * {
            visibility: visible;
          }
          .print\\:p-8 {
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
