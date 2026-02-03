'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/feedback/Modal';
import { TextArea } from '@/components/forms/TextArea';
import { Input } from '@/components/forms/Input';
import { CreditCard, MessageSquare, Check, DollarSign, Send } from 'lucide-react';
import type { QuoteWithDetails } from '@/types/database';

interface DepositSidebarProps {
  quote: QuoteWithDetails;
  onApproveAndPay?: () => void;
  onRequestChanges?: (message: string, name: string, email: string) => Promise<void>;
}

export function DepositSidebar({ quote, onApproveAndPay, onRequestChanges }: DepositSidebarProps) {
  const [showRequestChangesModal, setShowRequestChangesModal] = useState(false);
  const [changeMessage, setChangeMessage] = useState('');
  const [customerName, setCustomerName] = useState(quote.customer.name);
  const [customerEmail, setCustomerEmail] = useState(quote.customer.email || '');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const handleRequestChanges = async () => {
    if (!changeMessage.trim()) return;
    
    setSubmitting(true);
    try {
      if (onRequestChanges) {
        await onRequestChanges(changeMessage, customerName, customerEmail);
      }
      setSubmitted(true);
      setTimeout(() => {
        setShowRequestChangesModal(false);
        setSubmitted(false);
        setChangeMessage('');
      }, 2000);
    } finally {
      setSubmitting(false);
    }
  };

  // Don't show for draft or already accepted/declined quotes
  if (quote.status === 'draft' || quote.status === 'accepted' || quote.status === 'declined') {
    return null;
  }

  const depositAmount = quote.required_deposit || 0;
  const hasDeposit = depositAmount > 0;

  return (
    <>
      {/* Sticky Sidebar */}
      <div className="sticky top-6 space-y-4">
        <Card className="border-2 border-green-200 bg-gradient-to-br from-green-50 to-white shadow-lg">
          <CardContent className="p-6">
            {hasDeposit ? (
              <>
                {/* Deposit Header */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Deposit Required</h3>
                    <p className="text-xs text-gray-500">To begin work on this project</p>
                  </div>
                </div>

                {/* Large Deposit Amount */}
                <div className="mb-6 py-4 px-4 bg-white rounded-xl border border-green-100">
                  <p className="text-sm text-gray-500 mb-1">Deposit Amount</p>
                  <p className="text-3xl font-bold text-gray-900">{formatCurrency(depositAmount)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    of {formatCurrency(quote.total)} total
                  </p>
                </div>

                {/* Approve & Pay Button */}
                <Button 
                  className="w-full mb-3 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-base shadow-md"
                  onClick={onApproveAndPay}
                >
                  <CreditCard className="h-5 w-5" />
                  Approve & Pay Deposit
                </Button>
              </>
            ) : (
              <>
                {/* No Deposit - Just Approve */}
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">Ready to Approve?</h3>
                    <p className="text-xs text-gray-500">Accept this quote to proceed</p>
                  </div>
                </div>

                <div className="mb-6 py-4 px-4 bg-white rounded-xl border border-green-100">
                  <p className="text-sm text-gray-500 mb-1">Quote Total</p>
                  <p className="text-3xl font-bold text-gray-900">{formatCurrency(quote.total)}</p>
                </div>

                <Button 
                  className="w-full mb-3 bg-green-600 hover:bg-green-700 text-white font-semibold py-3 text-base shadow-md"
                  onClick={onApproveAndPay}
                >
                  <Check className="h-5 w-5" />
                  Approve Quote
                </Button>
              </>
            )}

            {/* Request Changes Button */}
            <Button 
              variant="outline"
              className="w-full border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={() => setShowRequestChangesModal(true)}
            >
              <MessageSquare className="h-4 w-4" />
              Request Changes
            </Button>

            {/* Help Text */}
            <p className="text-xs text-gray-400 text-center mt-4">
              Questions? Call us at (760) 555-0100
            </p>
          </CardContent>
        </Card>

        {/* Quote Summary Card */}
        <Card className="bg-gray-50 border-gray-200">
          <CardContent className="p-4">
            <h4 className="text-sm font-medium text-gray-700 mb-3">Quote Summary</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal</span>
                <span className="text-gray-900">{formatCurrency(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Tax ({quote.tax_rate}%)</span>
                <span className="text-gray-900">{formatCurrency(quote.tax_amount)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-gray-200 pt-2">
                <span className="text-gray-700">Total</span>
                <span className="text-gray-900">{formatCurrency(quote.total)}</span>
              </div>
              {hasDeposit && (
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Deposit Due</span>
                  <span>{formatCurrency(depositAmount)}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Request Changes Modal */}
      <Modal
        isOpen={showRequestChangesModal}
        onClose={() => {
          if (!submitting) {
            setShowRequestChangesModal(false);
            setSubmitted(false);
          }
        }}
        title="Request Changes"
        description="Let us know what changes you'd like to make to this quote."
        size="lg"
        footer={
          submitted ? null : (
            <>
              <Button 
                variant="outline" 
                onClick={() => setShowRequestChangesModal(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleRequestChanges} 
                disabled={submitting || !changeMessage.trim()}
              >
                {submitting ? (
                  <>Sending...</>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send Request
                  </>
                )}
              </Button>
            </>
          )
        }
      >
        {submitted ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Request Sent!</h3>
            <p className="text-gray-500">We'll review your request and get back to you shortly.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Your Name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Your name"
              />
              <Input
                label="Email"
                type="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="your@email.com"
              />
            </div>
            <TextArea
              label="What changes would you like?"
              value={changeMessage}
              onChange={(e) => setChangeMessage(e.target.value)}
              placeholder="Please describe the changes you'd like to make to this quote. For example: different materials, adjusted scope, pricing questions, scheduling concerns, etc."
              rows={5}
            />
            <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
              <p className="text-sm text-blue-700">
                <strong>Tip:</strong> Be as specific as possible about what you'd like changed. 
                We'll review your request and send you an updated quote.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export default DepositSidebar;
