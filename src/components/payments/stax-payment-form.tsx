'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  CreditCard, 
  Building2, 
  Loader2, 
  AlertCircle, 
  CheckCircle,
  Lock,
  Info
} from 'lucide-react';

// Stax.js types
declare global {
  interface Window {
    StaxJs: new (webPaymentsToken: string, options?: StaxJsOptions) => StaxJsInstance;
  }
}

interface StaxJsOptions {
  number?: { id: string; placeholder?: string; style?: string };
  cvv?: { id: string; placeholder?: string; style?: string };
}

interface StaxJsInstance {
  showCardForm: () => Promise<void>;
  on: (event: string, callback: (message: any) => void) => void;
  tokenize: (extraDetails: TokenizeDetails) => Promise<TokenizeResponse>;
  pay: (payDetails: PayDetails) => Promise<PayResponse>;
}

interface TokenizeDetails {
  firstname: string;
  lastname: string;
  method: 'card' | 'bank';
  month?: string;
  year?: string;
  phone?: string;
  email?: string;
  address_1?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  validate?: boolean;
  match_customer?: boolean;
  // Bank-specific fields
  bank_type?: 'checking' | 'savings';
  bank_holder_type?: 'personal' | 'business';
  bank_account?: string;
  bank_routing?: string;
}

interface TokenizeResponse {
  id: string;
  customer_id: string;
  customer: {
    id: string;
    firstname: string;
    lastname: string;
    email: string;
  };
  card_last_four?: string;
  card_type?: string;
  method: string;
}

interface PayDetails extends TokenizeDetails {
  total: number;
  meta?: {
    invoice_id?: string;
    reference?: string;
  };
}

interface PayResponse {
  id: string;
  success: boolean;
  message?: string;
  transaction?: {
    id: string;
    total: number;
    success: boolean;
  };
  customer?: {
    id: string;
  };
  payment_method?: {
    id: string;
  };
}

interface StaxPaymentFormProps {
  webPaymentsKey: string | null;
  amount: number;
  invoiceId: string;
  invoiceNumber?: number;
  customerEmail?: string;
  customerName?: string;
  cardFeePercent?: number;
  onPaymentSuccess: (payment: { id: string; amount: number; method: string }) => void;
  onPaymentError: (error: string) => void;
  portalToken?: string;
}

// Dynamic fee rates by card type
const FEE_RATES = {
  debit: 1.0,      // 1% for debit cards
  credit: 2.5,    // 2.5% for credit cards
  unknown: 2.5,   // Default to credit rate until detected
};

export function StaxPaymentForm({
  webPaymentsKey,
  amount,
  invoiceId,
  invoiceNumber,
  customerEmail,
  customerName,
  cardFeePercent = 2.5, // Default, will be overridden by dynamic detection
  onPaymentSuccess,
  onPaymentError,
  portalToken,
}: StaxPaymentFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isStaxLoaded, setIsStaxLoaded] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'ach'>('ach');
  const [cardFormReady, setCardFormReady] = useState(false);
  const [cardFormError, setCardFormError] = useState<string | null>(null);
  
  // Card type detection for dynamic fees
  const [detectedCardType, setDetectedCardType] = useState<'debit' | 'credit' | 'unknown'>('unknown');
  const [cardBrand, setCardBrand] = useState<string | null>(null);
  
  // Form fields
  const [firstName, setFirstName] = useState(customerName?.split(' ')[0] || '');
  const [lastName, setLastName] = useState(customerName?.split(' ').slice(1).join(' ') || '');
  const [email, setEmail] = useState(customerEmail || '');
  
  // Card fields (expiry only - number and CVV are in iframes)
  const [expiryMonth, setExpiryMonth] = useState('');
  const [expiryYear, setExpiryYear] = useState('');
  
  // ACH fields
  const [bankType, setBankType] = useState<'checking' | 'savings'>('checking');
  const [bankHolderType, setBankHolderType] = useState<'personal' | 'business'>('personal');
  const [bankAccount, setBankAccount] = useState('');
  const [bankRouting, setBankRouting] = useState('');
  
  const staxRef = useRef<StaxJsInstance | null>(null);

  // Calculate fees dynamically based on detected card type
  const effectiveFeePercent = FEE_RATES[detectedCardType];
  const cardFee = (amount * effectiveFeePercent) / 100;
  const cardTotal = amount + cardFee;
  const achTotal = amount; // No fee for ACH

  // Load Stax.js script
  useEffect(() => {
    if (!webPaymentsKey) return;
    
    // Check if already loaded
    if (window.StaxJs) {
      setIsStaxLoaded(true);
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://staxjs.staxpayments.com/stax.js';
    script.async = true;
    script.onload = () => {
      setIsStaxLoaded(true);
    };
    script.onerror = () => {
      console.error('Failed to load Stax.js');
      onPaymentError('Failed to load payment form. Please refresh and try again.');
    };
    document.head.appendChild(script);
    
    return () => {
      // Don't remove script on cleanup - it should stay loaded
    };
  }, [webPaymentsKey, onPaymentError]);

  // Initialize Stax for card payments
  useEffect(() => {
    if (!isStaxLoaded || !webPaymentsKey || paymentMethod !== 'card') return;
    
    const initStax = async () => {
      try {
        const stax = new window.StaxJs(webPaymentsKey, {
          number: {
            id: 'stax-card-number',
            placeholder: '•••• •••• •••• ••••',
            style: 'width: 100%; height: 40px; font-size: 16px; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;',
          },
          cvv: {
            id: 'stax-card-cvv',
            placeholder: '•••',
            style: 'width: 100%; height: 40px; font-size: 16px; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px;',
          },
        });

        stax.on('card_form_complete', () => {
          setCardFormReady(true);
          setCardFormError(null);
        });

        stax.on('card_form_uncomplete', (message) => {
          setCardFormReady(false);
          if (message) {
            setCardFormError(typeof message === 'string' ? message : 'Please complete all card fields');
          }
        });

        // Listen for card type detection (BIN lookup)
        stax.on('card_type_change', (data: any) => {
          console.log('Card type detected:', data);
          if (data) {
            // Set card brand (visa, mastercard, amex, discover, etc.)
            if (data.brand || data.type) {
              setCardBrand(data.brand || data.type);
            }
            // Detect debit vs credit
            if (data.funding === 'debit' || data.isDebit === true) {
              setDetectedCardType('debit');
            } else if (data.funding === 'credit' || data.isDebit === false) {
              setDetectedCardType('credit');
            }
          }
        });

        // Alternative event name Stax might use
        stax.on('bin_match', (data: any) => {
          console.log('BIN match:', data);
          if (data) {
            if (data.card_type) setCardBrand(data.card_type);
            if (data.funding === 'debit' || data.prepaid === true) {
              setDetectedCardType('debit');
            } else {
              setDetectedCardType('credit');
            }
          }
        });

        await stax.showCardForm();
        staxRef.current = stax;
      } catch (err) {
        console.error('Error initializing Stax:', err);
        setCardFormError('Failed to initialize payment form');
      }
    };

    // Small delay to ensure DOM elements exist
    const timer = setTimeout(initStax, 100);
    return () => clearTimeout(timer);
  }, [isStaxLoaded, webPaymentsKey, paymentMethod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!firstName || !lastName) {
      onPaymentError('Please enter your name');
      return;
    }

    setIsLoading(true);

    try {
      if (paymentMethod === 'card' && staxRef.current) {
        // Card payment via Stax.js
        if (!expiryMonth || !expiryYear) {
          onPaymentError('Please enter card expiry date');
          setIsLoading(false);
          return;
        }

        // Step 1: Tokenize first to get card details (BIN lookup for debit/credit)
        const tokenResult = await staxRef.current.tokenize({
          firstname: firstName,
          lastname: lastName,
          method: 'card',
          month: expiryMonth.padStart(2, '0'),
          year: expiryYear.length === 2 ? `20${expiryYear}` : expiryYear,
          email: email || undefined,
          validate: true,
        });

        console.log('Tokenize result:', tokenResult);

        // Step 2: Determine card type from tokenize response or BIN lookup
        let isDebit = false;
        const cardLastFour = tokenResult.card_last_four;
        const cardType = tokenResult.card_type?.toLowerCase() || '';
        
        // Check if Stax returned debit info
        if ((tokenResult as any).is_debit === true || (tokenResult as any).funding === 'debit') {
          isDebit = true;
        }
        
        // If not determined, do BIN lookup via our API
        if (!isDebit && tokenResult.id) {
          try {
            const binLookupRes = await fetch(`/api/payments/bin-lookup?payment_method_id=${tokenResult.id}`);
            if (binLookupRes.ok) {
              const binData = await binLookupRes.json();
              if (binData.isDebit) {
                isDebit = true;
              }
            }
          } catch (binErr) {
            console.log('BIN lookup failed, using default rate:', binErr);
          }
        }

        // Step 3: Calculate correct fee based on card type
        const actualFeePercent = isDebit ? FEE_RATES.debit : FEE_RATES.credit;
        const actualFee = (amount * actualFeePercent) / 100;
        const actualTotal = amount + actualFee;

        console.log(`Card type: ${isDebit ? 'debit' : 'credit'}, Fee: ${actualFeePercent}%, Total: $${actualTotal}`);

        // Step 4: Charge via our backend using the tokenized payment method
        const chargeRes = await fetch(
          portalToken 
            ? `/api/portal/${portalToken}/invoices/${invoiceId}/pay`
            : '/api/payments/process',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              invoiceId,
              paymentMethodId: tokenResult.id,
              amount: amount,
              totalCharged: actualTotal,
              processingFee: actualFee,
              paymentMethod: 'card',
              customerEmail: email,
              meta: {
                invoice_number: invoiceNumber,
                card_type: isDebit ? 'debit' : 'credit',
                card_brand: cardType,
                card_last_four: cardLastFour,
              },
            }),
          }
        );

        const chargeResult = await chargeRes.json();

        if (chargeRes.ok && chargeResult.success) {
          onPaymentSuccess({
            id: chargeResult.transactionId || chargeResult.payment?.id,
            amount: amount,
            method: 'card',
          });
        } else {
          throw new Error(chargeResult.error || 'Payment failed');
        }
      } else if (paymentMethod === 'ach') {
        // ACH payment - validate fields
        if (!bankAccount || !bankRouting) {
          onPaymentError('Please enter your bank account details');
          setIsLoading(false);
          return;
        }

        if (bankRouting.length !== 9) {
          onPaymentError('Routing number must be 9 digits');
          setIsLoading(false);
          return;
        }

        // For ACH, we need to tokenize then charge via backend
        // since ACH payments need to go through our server
        const response = await fetch(
          portalToken 
            ? `/api/portal/${portalToken}/invoices/${invoiceId}/pay`
            : `/api/payments/ach`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              paymentMethod: 'ach',
              amount: achTotal,
              processingFee: 0,
              totalCharged: achTotal,
              firstName,
              lastName,
              email,
              bankType,
              bankHolderType,
              bankAccount,
              bankRouting,
              invoiceId,
            }),
          }
        );

        const result = await response.json();

        if (response.ok && result.success) {
          onPaymentSuccess({
            id: result.payment?.id || result.transactionId,
            amount: amount,
            method: 'ach',
          });
        } else {
          throw new Error(result.error || 'ACH payment failed');
        }
      }
    } catch (err) {
      console.error('Payment error:', err);
      onPaymentError(err instanceof Error ? err.message : 'Payment processing failed');
    } finally {
      setIsLoading(false);
    }
  };

  const recordPayment = async (paymentData: {
    staxTransactionId: string;
    amount: number;
    totalCharged: number;
    processingFee: number;
    paymentMethod: string;
  }) => {
    const endpoint = portalToken
      ? `/api/portal/${portalToken}/invoices/${invoiceId}/pay`
      : `/api/payments/process`;

    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...paymentData,
        invoiceId,
        // Mark as already charged - don't charge again!
        alreadyCharged: true,
        transactionId: paymentData.staxTransactionId,
      }),
    });
  };

  // Demo mode if no Stax key
  if (!webPaymentsKey) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Info className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-800">Payment Processing Not Configured</p>
              <p className="text-sm text-amber-700 mt-1">
                Online payments are not available at this time. Please contact us to pay by phone or check.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Payment Method Selection */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Payment Method</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => {
              setPaymentMethod('ach');
              // Reset card detection when switching
              setDetectedCardType('unknown');
              setCardBrand(null);
            }}
            className={`p-4 rounded-lg border-2 transition-all ${
              paymentMethod === 'ach'
                ? 'border-[#4e9271] bg-[#4e9271]/5 shadow-sm'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <Building2 className={`h-6 w-6 mx-auto mb-2 ${
              paymentMethod === 'ach' ? 'text-[#4e9271]' : 'text-gray-400'
            }`} />
            <div className="font-medium text-sm">Bank Transfer (ACH)</div>
            <div className="text-xs text-green-600 font-medium mt-1">No fee ✓</div>
          </button>
          <button
            type="button"
            onClick={() => {
              setPaymentMethod('card');
              // Reset card detection when switching
              setDetectedCardType('unknown');
              setCardBrand(null);
            }}
            className={`p-4 rounded-lg border-2 transition-all ${
              paymentMethod === 'card'
                ? 'border-[#1f3b4d] bg-[#1f3b4d]/5 shadow-sm'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <CreditCard className={`h-6 w-6 mx-auto mb-2 ${
              paymentMethod === 'card' ? 'text-[#1f3b4d]' : 'text-gray-400'
            }`} />
            <div className="font-medium text-sm">Credit/Debit Card</div>
            <div className="text-xs text-muted-foreground mt-1">
              {detectedCardType === 'debit' ? '1%' : detectedCardType === 'credit' ? '2.5%' : '1-2.5%'} fee
            </div>
          </button>
        </div>
      </div>

      {/* Name Fields */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="John"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last Name *</Label>
          <Input
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Doe"
            required
          />
        </div>
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label htmlFor="email">Email (for receipt)</Label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="john@example.com"
        />
      </div>

      {/* Card Form */}
      {paymentMethod === 'card' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Card Number *</Label>
            <div 
              id="stax-card-number" 
              className="min-h-[42px] bg-white rounded-md"
            />
          </div>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="expiryMonth">Month *</Label>
              <Input
                id="expiryMonth"
                value={expiryMonth}
                onChange={(e) => setExpiryMonth(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder="MM"
                maxLength={2}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="expiryYear">Year *</Label>
              <Input
                id="expiryYear"
                value={expiryYear}
                onChange={(e) => setExpiryYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="YYYY"
                maxLength={4}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>CVV *</Label>
              <div 
                id="stax-card-cvv" 
                className="min-h-[42px] bg-white rounded-md"
              />
            </div>
          </div>

          {cardFormError && (
            <p className="text-sm text-red-600">{cardFormError}</p>
          )}
        </div>
      )}

      {/* ACH Form */}
      {paymentMethod === 'ach' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Account Type *</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={bankType === 'checking' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setBankType('checking')}
                  className={bankType === 'checking' ? 'bg-[#4e9271] hover:bg-[#3d7358]' : ''}
                >
                  Checking
                </Button>
                <Button
                  type="button"
                  variant={bankType === 'savings' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setBankType('savings')}
                  className={bankType === 'savings' ? 'bg-[#4e9271] hover:bg-[#3d7358]' : ''}
                >
                  Savings
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Holder Type *</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={bankHolderType === 'personal' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setBankHolderType('personal')}
                  className={bankHolderType === 'personal' ? 'bg-[#4e9271] hover:bg-[#3d7358]' : ''}
                >
                  Personal
                </Button>
                <Button
                  type="button"
                  variant={bankHolderType === 'business' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setBankHolderType('business')}
                  className={bankHolderType === 'business' ? 'bg-[#4e9271] hover:bg-[#3d7358]' : ''}
                >
                  Business
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bankRouting">Routing Number *</Label>
            <Input
              id="bankRouting"
              value={bankRouting}
              onChange={(e) => setBankRouting(e.target.value.replace(/\D/g, '').slice(0, 9))}
              placeholder="9 digits"
              maxLength={9}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bankAccount">Account Number *</Label>
            <Input
              id="bankAccount"
              value={bankAccount}
              onChange={(e) => setBankAccount(e.target.value.replace(/\D/g, ''))}
              placeholder="Account number"
              required
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-xs text-blue-800">
              <strong>ACH transfers</strong> typically take 2-3 business days to process.
              Your invoice will be marked as paid once the transfer completes.
            </p>
          </div>
        </div>
      )}

      {/* Payment Summary */}
      <div className="bg-muted/50 rounded-lg p-4 space-y-2">
        <div className="flex justify-between">
          <span>Invoice Amount</span>
          <span>${amount.toFixed(2)}</span>
        </div>
        {paymentMethod === 'card' && (
          <>
            <div className="flex justify-between text-muted-foreground">
              <span className="flex items-center gap-2">
                Processing Fee ({effectiveFeePercent}%)
                {cardBrand && (
                  <span className="text-xs bg-gray-200 px-1.5 py-0.5 rounded capitalize">
                    {cardBrand} {detectedCardType !== 'unknown' ? `• ${detectedCardType}` : ''}
                  </span>
                )}
              </span>
              <span>${cardFee.toFixed(2)}</span>
            </div>
            {detectedCardType === 'unknown' && (
              <p className="text-xs text-muted-foreground">
                💡 Fee adjusts based on card type: Debit 1% • Credit 2.5%
              </p>
            )}
          </>
        )}
        {paymentMethod === 'ach' && (
          <div className="flex justify-between text-green-600">
            <span>Processing Fee</span>
            <span>$0.00</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-lg border-t pt-2 mt-2">
          <span>Total</span>
          <span>${paymentMethod === 'card' ? cardTotal.toFixed(2) : achTotal.toFixed(2)}</span>
        </div>
      </div>

      {/* Submit Button */}
      <Button
        type="submit"
        disabled={isLoading || (paymentMethod === 'card' && !isStaxLoaded)}
        className="w-full h-12 text-lg bg-[#4e9271] hover:bg-[#3d7358]"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Lock className="h-5 w-5 mr-2" />
            Pay ${paymentMethod === 'card' ? cardTotal.toFixed(2) : achTotal.toFixed(2)}
          </>
        )}
      </Button>

      {/* Security Badge */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" />
        <span>Secure payment powered by Stax</span>
      </div>
    </form>
  );
}
