'use client';

import { useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { QuoteStatusBadge } from '@/components/ui/Badge';
import { Input } from '@/components/forms/Input';
import { Modal } from '@/components/feedback/Modal';
import { QuotePDFButton } from '@/components/pdf/QuotePDFButton';
import { DepositSidebar } from '@/components/quotes/DepositSidebar';
import { getQuoteWithDetails, mockQuoteChangeRequests } from '@/lib/mock-data';
import { 
  ArrowLeft, Edit, Send, FileText, Mail, 
  Check, X, Clock, Printer, Building2, MapPin, DollarSign, Receipt
} from 'lucide-react';
import { format } from 'date-fns';

// Company info - could be fetched from settings in a real app
const COMPANY_INFO = {
  name: 'Southern California Well Service',
  subtitle: 'Professional Well & Pump Services',
  address: '74309 Highway 111, Palm Desert, CA 92260',
  phone: '(760) 346-0086',
  email: 'info@socalwellservice.com',
};

export default function QuoteDetailPage() {
  const router = useRouter();
  const params = useParams();
  const quoteId = params.id as string;
  const printRef = useRef<HTMLDivElement>(null);
  
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sending, setSending] = useState(false);

  const quoteData = getQuoteWithDetails(quoteId);

  if (!quoteData) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Quote not found</h2>
        <p className="text-gray-500 mt-2">The quote you&apos;re looking for doesn&apos;t exist.</p>
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
    // TODO: Implement actual send logic
    setSending(false);
    setShowSendModal(false);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleConvertToInvoice = () => {
    router.push(`/invoices/new?from_quote=${quoteId}`);
  };

  const handleApproveAndPay = () => {
    // TODO: Implement payment flow
    alert('Payment flow would open here. This will redirect to a payment processor.');
  };

  const handleRequestChanges = async (message: string, name: string, email: string) => {
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // In real implementation, this would save to database and notify the team
    const newRequest = {
      id: `qcr${mockQuoteChangeRequests.length + 1}`,
      quote_id: quoteId,
      customer_name: name,
      customer_email: email,
      message: message,
      status: 'pending' as const,
      created_at: new Date().toISOString(),
      reviewed_at: null,
    };
    
    mockQuoteChangeRequests.push(newRequest);
    console.log('Change request submitted:', newRequest);
    
    // TODO: Send notification to team (email/slack/etc)
  };

  // Show sidebar for sent/expired quotes (customer-facing view)
  const showDepositSidebar = quoteData.status === 'sent' || quoteData.status === 'expired';

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
              {quoteData.required_deposit && quoteData.required_deposit > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 text-xs font-medium rounded-full">
                  <DollarSign className="h-3 w-3" />
                  {formatCurrency(quoteData.required_deposit)} deposit
                </span>
              )}
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
          <QuotePDFButton quote={quoteData} companyInfo={COMPANY_INFO} />
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

      {/* Main Content with Sidebar */}
      <div className={`flex gap-6 ${showDepositSidebar ? 'flex-row' : 'flex-col'}`}>
        {/* Quote Preview (Print-friendly) */}
        <div ref={printRef} className={`print:p-8 ${showDepositSidebar ? 'flex-1' : 'w-full'}`}>
        <Card className="print:shadow-none print:border-none">
          <CardContent className="p-8">
            {/* Header with Logo */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">QUOTE</h1>
                <p className="text-lg text-gray-600">#{quoteData.quote_number}</p>
              </div>
              <div className="text-right">
                {/* Company Logo */}
                <div className="mb-3">
                  <Image 
                    src="/logo.png" 
                    alt="Southern California Well Service" 
                    width={140} 
                    height={70}
                    className="ml-auto"
                    priority
                  />
                </div>
                <p className="text-sm text-gray-600 font-medium">{COMPANY_INFO.address}</p>
                <p className="text-sm text-gray-500">{COMPANY_INFO.phone}</p>
                <p className="text-sm text-gray-500">{COMPANY_INFO.email}</p>
              </div>
            </div>

            {/* Customer & Quote Info */}
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Prepared For</h3>
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
                  <tr className="border-b-2 border-sky-500">
                    <th className="text-left py-3 text-sm font-medium text-gray-500 uppercase bg-gray-50 px-3">Description</th>
                    <th className="text-right py-3 text-sm font-medium text-gray-500 uppercase w-20 bg-gray-50 px-3">Qty</th>
                    <th className="text-right py-3 text-sm font-medium text-gray-500 uppercase w-28 bg-gray-50 px-3">Rate</th>
                    <th className="text-right py-3 text-sm font-medium text-gray-500 uppercase w-28 bg-gray-50 px-3">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={item.id} className={`border-b border-gray-100 ${index % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <p className="text-gray-900">{item.description}</p>
                          {item.taxable === false && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 print:bg-amber-50">
                              <Receipt className="h-3 w-3" />
                              Non-taxable
                            </span>
                          )}
                        </div>
                        {item.item_description && (
                          <p className="text-sm text-gray-600 mt-1">{item.item_description}</p>
                        )}
                        {item.item_type && (
                          <p className="text-xs text-gray-400 capitalize mt-0.5">{item.item_type}</p>
                        )}
                      </td>
                      <td className="text-right py-3 text-gray-600 px-3 align-top">{item.quantity}</td>
                      <td className="text-right py-3 text-gray-600 px-3 align-top">{formatCurrency(item.unit_price)}</td>
                      <td className="text-right py-3 font-medium text-gray-900 px-3 align-top">{formatCurrency(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-72 bg-gray-50 rounded-lg p-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Subtotal</span>
                    <span className="font-medium">{formatCurrency(quoteData.subtotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Tax ({quoteData.tax_rate}%)</span>
                    <span className="font-medium">{formatCurrency(quoteData.tax_amount)}</span>
                  </div>
                  <div className="flex justify-between text-lg border-t-2 border-sky-500 pt-3 mt-2">
                    <span className="font-bold">Total</span>
                    <span className="font-bold text-sky-600">{formatCurrency(quoteData.total)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Notes */}
            {quoteData.notes && (
              <div className="mt-8 pt-6 border-t border-gray-200">
                <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">Notes & Terms</h3>
                <p className="text-gray-600 whitespace-pre-wrap">{quoteData.notes}</p>
              </div>
            )}

            {/* Footer */}
            <div className="mt-8 pt-6 border-t border-gray-200 text-center">
              <p className="text-sm font-medium text-gray-600">
                Thank you for considering Southern California Well Service!
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Questions? Call us at {COMPANY_INFO.phone} or email {COMPANY_INFO.email}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Internal Notes (not printed) */}
        {quoteData.internal_notes && (
          <Card className="print:hidden mt-6">
            <CardHeader>
              <CardTitle className="text-sm">Internal Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600 text-sm">{quoteData.internal_notes}</p>
            </CardContent>
          </Card>
        )}
        </div>

        {/* Deposit Sidebar */}
        {showDepositSidebar && (
          <div className="w-80 print:hidden shrink-0">
            <DepositSidebar 
              quote={quoteData}
              onApproveAndPay={handleApproveAndPay}
              onRequestChanges={handleRequestChanges}
            />
          </div>
        )}
      </div>

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
