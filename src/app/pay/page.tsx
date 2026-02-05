'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StaxPaymentForm } from '@/components/payments/stax-payment-form';
import { 
  FileText, 
  Search, 
  Loader2, 
  AlertCircle, 
  CheckCircle,
  ArrowLeft,
  Building,
  Calendar,
  DollarSign
} from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';

interface InvoiceData {
  id: string;
  invoice_number: number;
  customer_name: string;
  customer_email: string | null;
  total: number;
  amount_paid: number;
  balance_due: number;
  issue_date: string;
  due_date: string | null;
  status: string;
  items_count: number;
}

export default function PayPage() {
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [staxWebKey, setStaxWebKey] = useState<string | null>(null);

  // Load Stax web payments key
  useEffect(() => {
    setStaxWebKey(process.env.NEXT_PUBLIC_STAX_WEB_PAYMENTS_KEY || null);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!invoiceNumber.trim()) {
      setSearchError('Please enter an invoice number');
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    setInvoice(null);

    try {
      const response = await fetch(`/api/pay/lookup?invoice=${encodeURIComponent(invoiceNumber.trim())}`);
      const data = await response.json();

      if (response.ok && data.invoice) {
        setInvoice(data.invoice);
      } else {
        setSearchError(data.error || 'Invoice not found');
      }
    } catch (err) {
      console.error('Search error:', err);
      setSearchError('Failed to search for invoice. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handlePaymentSuccess = (payment: { id: string; amount: number; method: string }) => {
    setPaymentSuccess(true);
    setPaymentError(null);
  };

  const handlePaymentError = (error: string) => {
    setPaymentError(error);
    setPaymentSuccess(false);
  };

  const handleStartOver = () => {
    setInvoice(null);
    setInvoiceNumber('');
    setPaymentSuccess(false);
    setPaymentError(null);
    setSearchError(null);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Payment success view
  if (paymentSuccess && invoice) {
    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-md mx-auto">
          <Card className="border-green-200 bg-green-50">
            <CardContent className="pt-8 pb-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-green-800 mb-2">Payment Successful!</h2>
              <p className="text-green-700 mb-4">
                Thank you for your payment on Invoice #{invoice.invoice_number}.
              </p>
              <p className="text-sm text-green-600 mb-6">
                A receipt has been sent to your email address.
              </p>
              <Button onClick={handleStartOver} variant="outline">
                Pay Another Invoice
              </Button>
            </CardContent>
          </Card>

          {/* Company Info */}
          <div className="text-center mt-8 text-sm text-muted-foreground">
            <p className="font-medium text-gray-700">So Cal Well Service</p>
            <p>(760) 440-8520 • billing@scwellservice.com</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-4">
            <div className="flex items-center justify-center gap-3">
              <div className="w-12 h-12 bg-[#1f3b4d] rounded-lg flex items-center justify-center">
                <Building className="h-6 w-6 text-white" />
              </div>
              <div className="text-left">
                <h1 className="text-xl font-bold text-[#1f3b4d]">So Cal Well Service</h1>
                <p className="text-xs text-gray-500">Online Payment Portal</p>
              </div>
            </div>
          </Link>
        </div>

        {/* Search Form - Show when no invoice loaded */}
        {!invoice && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Pay Your Invoice
              </CardTitle>
              <CardDescription>
                Enter your invoice number to make a payment
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSearch} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="invoiceNumber">Invoice Number</Label>
                  <div className="flex gap-2">
                    <Input
                      id="invoiceNumber"
                      type="text"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      placeholder="e.g., 1001 or INV-1001"
                      className="flex-1"
                      autoFocus
                    />
                    <Button 
                      type="submit" 
                      disabled={isSearching}
                      className="bg-[#1f3b4d] hover:bg-[#152a38]"
                    >
                      {isSearching ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {searchError && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-red-700">
                      {searchError}
                    </div>
                  </div>
                )}
              </form>

              <div className="mt-6 pt-6 border-t">
                <p className="text-sm text-muted-foreground">
                  <strong>Can't find your invoice number?</strong> Check the top of your invoice 
                  document or the email we sent you. The invoice number looks like "1001" or "INV-1001".
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invoice Details & Payment Form */}
        {invoice && !paymentSuccess && (
          <>
            {/* Back Button */}
            <button
              onClick={handleStartOver}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
            >
              <ArrowLeft className="h-4 w-4" />
              Search for different invoice
            </button>

            {/* Invoice Summary */}
            <Card className="mb-6">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>Invoice #{invoice.invoice_number}</CardTitle>
                    <CardDescription>{invoice.customer_name}</CardDescription>
                  </div>
                  <div className="text-right">
                    {invoice.status === 'paid' ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle className="h-3 w-3" />
                        Paid
                      </span>
                    ) : invoice.due_date && new Date(invoice.due_date) < new Date() ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        Overdue
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        Payment Due
                      </span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      Issued
                    </div>
                    <div className="font-medium">{formatDate(invoice.issue_date)}</div>
                  </div>
                  {invoice.due_date && (
                    <div>
                      <div className="text-muted-foreground flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        Due
                      </div>
                      <div className="font-medium">{formatDate(invoice.due_date)}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-muted-foreground flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      Total
                    </div>
                    <div className="font-medium">{formatCurrency(invoice.total)}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground flex items-center gap-1">
                      <DollarSign className="h-3 w-3" />
                      Balance Due
                    </div>
                    <div className="font-bold text-lg text-red-600">
                      {formatCurrency(invoice.balance_due)}
                    </div>
                  </div>
                </div>

                {invoice.amount_paid > 0 && (
                  <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                    Previous payments: {formatCurrency(invoice.amount_paid)}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Payment Form or Already Paid Message */}
            {invoice.status === 'paid' || invoice.balance_due <= 0 ? (
              <Card className="border-green-200 bg-green-50">
                <CardContent className="pt-6 text-center">
                  <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-green-800">
                    This invoice has been paid in full
                  </h3>
                  <p className="text-green-700 mt-2">
                    Thank you for your payment!
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Make a Payment</CardTitle>
                  <CardDescription>
                    Pay securely online with ACH bank transfer (no fee) or credit/debit card
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {paymentError && (
                    <div className="mb-6 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="text-sm text-red-700">{paymentError}</div>
                    </div>
                  )}

                  <StaxPaymentForm
                    webPaymentsKey={staxWebKey}
                    amount={invoice.balance_due}
                    invoiceId={invoice.id}
                    invoiceNumber={invoice.invoice_number}
                    customerEmail={invoice.customer_email || undefined}
                    customerName={invoice.customer_name}
                    cardFeePercent={3}
                    onPaymentSuccess={handlePaymentSuccess}
                    onPaymentError={handlePaymentError}
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p className="mb-2">Questions about your invoice?</p>
          <p>
            <a href="tel:+17604408520" className="text-[#1f3b4d] font-medium hover:underline">
              (760) 440-8520
            </a>
            <span className="mx-2">•</span>
            <a href="mailto:billing@scwellservice.com" className="text-[#1f3b4d] font-medium hover:underline">
              billing@scwellservice.com
            </a>
          </p>
          <p className="mt-4 text-xs">
            © {new Date().getFullYear()} So Cal Well Service. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}
