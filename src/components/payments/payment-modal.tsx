'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { StaxPaymentForm } from './stax-payment-form';
import { CheckCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: number;
  amount: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerCity?: string;
  customerState?: string;
  customerZip?: string;
  cardFeePercent?: number;
  staxWebKey: string | null;
  portalToken?: string;
  onPaymentSuccess?: () => void;
}

export function PaymentModal({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  amount,
  customerName,
  customerEmail,
  customerPhone,
  customerAddress,
  customerCity,
  customerState,
  customerZip,
  cardFeePercent = 3,
  staxWebKey,
  portalToken,
  onPaymentSuccess,
}: PaymentModalProps) {
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePaymentSuccess = (payment: { id: string; amount: number; method: string }) => {
    setPaymentSuccess(true);
    setError(null);
  };

  const handlePaymentError = (err: string) => {
    setError(err);
    setPaymentSuccess(false);
  };

  const handleClose = () => {
    if (paymentSuccess && onPaymentSuccess) {
      onPaymentSuccess();
    }
    setPaymentSuccess(false);
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle>
                {paymentSuccess ? 'Payment Complete' : `Pay Invoice #${invoiceNumber}`}
              </DialogTitle>
              {!paymentSuccess && (
                <DialogDescription>
                  Amount due: ${amount.toFixed(2)}
                </DialogDescription>
              )}
            </div>
            <button
              onClick={handleClose}
              className="rounded-full p-1 hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          </div>
        </DialogHeader>

        <div className="mt-4">
          {paymentSuccess ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-green-800 mb-2">
                Payment Successful!
              </h3>
              <p className="text-green-700 mb-6">
                Thank you for your payment. A receipt has been sent to your email.
              </p>
              <Button onClick={handleClose} className="bg-[#4e9271] hover:bg-[#3d7358]">
                Close
              </Button>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {error}
                </div>
              )}
              <StaxPaymentForm
                webPaymentsKey={staxWebKey}
                amount={amount}
                invoiceId={invoiceId}
                invoiceNumber={invoiceNumber}
                customerEmail={customerEmail}
                customerName={customerName}
                customerPhone={customerPhone}
                customerAddress={customerAddress}
                customerCity={customerCity}
                customerState={customerState}
                customerZip={customerZip}
                cardFeePercent={cardFeePercent}
                onPaymentSuccess={handlePaymentSuccess}
                onPaymentError={handlePaymentError}
                portalToken={portalToken}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
