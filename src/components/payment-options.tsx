'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Building2, 
  CreditCard, 
  CheckCircle, 
  Mail,
  Shield,
  Info 
} from 'lucide-react';

interface PaymentOptionsProps {
  invoiceTotal: number;
  invoiceNumber: string;
  customerName: string;
  ccFeePercent?: number;
  achEnabled?: boolean;
  achFee?: number;
  checksEnabled?: boolean;
  onPaymentMethodSelect?: (method: 'ach' | 'card' | 'check', totalAmount: number) => void;
}

export function PaymentOptions({
  invoiceTotal,
  invoiceNumber,
  customerName,
  ccFeePercent = 3,
  achEnabled = true,
  achFee = 0,
  checksEnabled = true,
  onPaymentMethodSelect,
}: PaymentOptionsProps) {
  const [selectedMethod, setSelectedMethod] = useState<'ach' | 'card' | 'check' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const cardFee = (invoiceTotal * ccFeePercent) / 100;
  const cardTotal = invoiceTotal + cardFee;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { 
      style: 'currency', 
      currency: 'USD' 
    }).format(amount);
  };

  const handleMethodSelect = async (method: 'ach' | 'card' | 'check') => {
    setSelectedMethod(method);
    
    if (method === 'check') {
      // For checks, just show info - no payment processing
      return;
    }

    setIsProcessing(true);
    
    const totalAmount = method === 'card' ? cardTotal : invoiceTotal + achFee;
    
    // Call parent callback if provided
    if (onPaymentMethodSelect) {
      await onPaymentMethodSelect(method, totalAmount);
    }
    
    setIsProcessing(false);
  };

  return (
    <div className="space-y-4">
      {/* ACH Option - Recommended */}
      {achEnabled && (
        <Card 
          className={`cursor-pointer transition-all border-2 ${
            selectedMethod === 'ach' 
              ? 'border-[#4e9271] bg-green-50/50' 
              : 'border-gray-200 hover:border-[#4e9271]/40 hover:shadow-md'
          }`}
          onClick={() => !isProcessing && handleMethodSelect('ach')}
        >
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-4 flex-1">
                <div className="w-12 h-12 rounded-full bg-[#4e9271]/10 flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-6 w-6 text-[#4e9271]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg font-semibold text-gray-900">Bank Account (ACH)</h3>
                    <span className="px-2 py-0.5 text-xs font-medium bg-[#4e9271] text-white rounded-full">
                      Recommended
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 mb-2">
                    Direct bank transfer - secure and fee-free
                  </p>
                  <div className="flex items-center gap-3 text-sm">
                    <div className="flex items-center gap-1 text-[#4e9271]">
                      <Shield className="h-4 w-4" />
                      <span className="font-medium">Secure</span>
                    </div>
                    {achFee === 0 && (
                      <div className="flex items-center gap-1 text-[#4e9271]">
                        <CheckCircle className="h-4 w-4" />
                        <span className="font-medium">No Fee</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold text-gray-900">
                  {formatCurrency(invoiceTotal + achFee)}
                </div>
                {achFee > 0 && (
                  <div className="text-xs text-gray-500">
                    + {formatCurrency(achFee)} fee
                  </div>
                )}
              </div>
            </div>
            
            <div className="mt-4">
              <Button 
                className="w-full bg-[#4e9271] hover:bg-[#3d7358] text-white"
                size="lg"
                disabled={isProcessing}
                loading={isProcessing && selectedMethod === 'ach'}
              >
                {isProcessing && selectedMethod === 'ach' ? 'Processing...' : 'Pay with Bank Account'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Credit/Debit Card Option */}
      <Card 
        className={`cursor-pointer transition-all border-2 ${
          selectedMethod === 'card' 
            ? 'border-[#1f3b4d] bg-blue-50/50' 
            : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
        }`}
        onClick={() => !isProcessing && handleMethodSelect('card')}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4 flex-1">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <CreditCard className="h-6 w-6 text-gray-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">
                  Credit or Debit Card
                </h3>
                <p className="text-sm text-gray-600 mb-2">
                  Pay instantly with Visa, Mastercard, Amex, or Discover
                </p>
                {ccFeePercent > 0 && (
                  <div className="flex items-start gap-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 inline-flex">
                    <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>
                      Includes {ccFeePercent}% convenience fee ({formatCurrency(cardFee)})
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-gray-900">
                {formatCurrency(cardTotal)}
              </div>
              {ccFeePercent > 0 && (
                <div className="text-xs text-gray-500">
                  Invoice: {formatCurrency(invoiceTotal)}
                </div>
              )}
            </div>
          </div>
          
          <div className="mt-4">
            <Button 
              className="w-full bg-[#1f3b4d] hover:bg-[#152a38] text-white"
              size="lg"
              variant="secondary"
              disabled={isProcessing}
              loading={isProcessing && selectedMethod === 'card'}
            >
              {isProcessing && selectedMethod === 'card' ? 'Processing...' : `Pay ${formatCurrency(cardTotal)} by Card`}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Check Payment Option - De-emphasized */}
      {checksEnabled && (
        <div className="pt-2">
          <div className="text-center">
            <button
              onClick={() => handleMethodSelect('check')}
              className="text-sm text-gray-500 hover:text-gray-700 underline decoration-dotted inline-flex items-center gap-1.5"
            >
              <Mail className="h-4 w-4" />
              Need to pay by check? Contact us
            </button>
          </div>
          
          {selectedMethod === 'check' && (
            <Card className="mt-3 bg-gray-50 border-gray-200">
              <CardContent className="p-4">
                <h4 className="font-medium text-gray-900 mb-2">Check Payment Instructions</h4>
                <div className="text-sm text-gray-600 space-y-2">
                  <p>Make checks payable to: <strong>So Cal Well Service</strong></p>
                  <p>Mail to:</p>
                  <address className="not-italic pl-3 text-gray-700">
                    SCWS<br />
                    123 Main Street<br />
                    Palm Desert, CA 92260
                  </address>
                  <p className="pt-2">
                    Include Invoice # <strong>{invoiceNumber}</strong> in the memo line.
                  </p>
                  <p className="text-xs text-gray-500 pt-2">
                    Questions? Call us at (760) 555-0100 or email billing@scwellservice.com
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Security Badge */}
      <div className="flex items-center justify-center gap-2 text-xs text-gray-500 pt-2">
        <Shield className="h-4 w-4" />
        <span>Secure payment processing powered by Stax</span>
      </div>
    </div>
  );
}
