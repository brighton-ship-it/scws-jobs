'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { PaymentOptions } from '@/components/payment-options';
import { getInvoiceWithDetails } from '@/lib/mock-data';
import { format } from 'date-fns';
import { 
  FileText, 
  Building2, 
  Calendar,
  DollarSign,
  CheckCircle,
  ArrowLeft
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function InvoicePaymentPage() {
  const params = useParams();
  const router = useRouter();
  const invoiceId = params.id as string;
  
  const [isLoading, setIsLoading] = useState(true);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In production, this would fetch from API
  const invoiceData = getInvoiceWithDetails(invoiceId);

  useEffect(() => {
    // Simulate loading delay
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1f3b4d] mx-auto"></div>
          <p className="text-gray-600 mt-4">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (!invoiceData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Invoice Not Found</h2>
            <p className="text-gray-500">
              The invoice you're looking for doesn't exist or has been removed.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { customer, items } = invoiceData;
  const balanceDue = invoiceData.total - invoiceData.amount_paid;

  // Check if already paid
  if (invoiceData.status === 'paid' || balanceDue <= 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Invoice Already Paid</h2>
            <p className="text-gray-500 mb-6">
              This invoice has been paid in full.
            </p>
            {invoiceData.paid_at && (
              <p className="text-sm text-gray-400">
                Paid on {format(new Date(invoiceData.paid_at), 'MMMM d, yyyy')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if voided
  if (invoiceData.status === 'void') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12">
            <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Invoice Voided</h2>
            <p className="text-gray-500">
              This invoice has been voided and cannot be paid.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD' 
    }).format(amount);
  };

  const handlePaymentMethodSelect = async (
    method: 'ach' | 'card' | 'check',
    totalAmount: number
  ) => {
    try {
      setError(null);

      // For check payments, no API call needed
      if (method === 'check') {
        return;
      }

      // Call payment API to create payment intent
      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          invoiceId,
          paymentMethod: method,
          amount: totalAmount,
          feeAmount: method === 'card' ? totalAmount - balanceDue : 0,
          customerEmail: customer.email,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Payment failed');
      }

      // TODO: In production, redirect to Stax payment form
      // For now, simulate success after delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setPaymentSuccess(true);
      
      // Redirect after showing success message
      setTimeout(() => {
        router.push(`/invoices/${invoiceId}`);
      }, 3000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment processing failed');
      console.error('Payment error:', err);
    }
  };

  if (paymentSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-12">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Payment Successful!</h2>
            <p className="text-gray-500 mb-2">
              Thank you for your payment.
            </p>
            <p className="text-sm text-gray-400">
              Redirecting...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link 
            href={`/invoices/${invoiceId}`}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Invoice
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-[#1f3b4d] rounded-lg flex items-center justify-center">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Pay Invoice</h1>
              <p className="text-gray-600">Invoice #{invoiceData.invoice_number}</p>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Payment Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Payment Methods */}
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Select Payment Method
              </h2>
              <PaymentOptions
                invoiceTotal={balanceDue}
                invoiceNumber={invoiceData.invoice_number}
                customerName={customer.name}
                ccFeePercent={3}
                achEnabled={true}
                achFee={0}
                checksEnabled={true}
                onPaymentMethodSelect={handlePaymentMethodSelect}
              />
            </div>
          </div>

          {/* Invoice Summary Sidebar */}
          <div className="space-y-6">
            {/* Customer Info */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-gray-400" />
                  Customer
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium text-gray-900">{customer.name}</p>
                {customer.email && (
                  <p className="text-sm text-gray-600 mt-1">{customer.email}</p>
                )}
                {customer.phone && (
                  <p className="text-sm text-gray-600">{customer.phone}</p>
                )}
              </CardContent>
            </Card>

            {/* Invoice Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  Invoice Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Issue Date</span>
                  <span className="font-medium">
                    {format(new Date(invoiceData.issue_date), 'MMM d, yyyy')}
                  </span>
                </div>
                {invoiceData.due_date && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Due Date</span>
                    <span className="font-medium">
                      {format(new Date(invoiceData.due_date), 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
                <div className="border-t border-gray-200 pt-3">
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">Subtotal</span>
                    <span>{formatCurrency(invoiceData.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-gray-600">Tax</span>
                    <span>{formatCurrency(invoiceData.tax_amount)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-gray-900 pt-2 border-t border-gray-200">
                    <span>Total</span>
                    <span>{formatCurrency(invoiceData.total)}</span>
                  </div>
                  {invoiceData.amount_paid > 0 && (
                    <>
                      <div className="flex justify-between text-sm text-green-600 mt-2">
                        <span>Paid</span>
                        <span>-{formatCurrency(invoiceData.amount_paid)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-lg text-[#1f3b4d] pt-2 border-t border-gray-200 mt-2">
                        <span>Balance Due</span>
                        <span>{formatCurrency(balanceDue)}</span>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Line Items Summary */}
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-400" />
                  Items ({items.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {items.slice(0, 3).map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="text-gray-600 truncate flex-1 mr-2">
                        {item.description}
                      </span>
                      <span className="font-medium whitespace-nowrap">
                        {formatCurrency(item.total)}
                      </span>
                    </div>
                  ))}
                  {items.length > 3 && (
                    <p className="text-xs text-gray-400 pt-1">
                      + {items.length - 3} more items
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Support */}
            <Card className="bg-gray-50 border-gray-200">
              <CardContent className="pt-4 text-center">
                <p className="text-sm text-gray-600 mb-2">
                  Questions about this invoice?
                </p>
                <p className="text-sm font-medium text-gray-900">
                  (760) 555-0100
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  billing@scwellservice.com
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Powered by SCWS Job Management System</p>
          <p className="mt-1">© {new Date().getFullYear()} So Cal Well Service. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
