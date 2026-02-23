'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, CheckCircle, Clock, AlertCircle, Download, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

interface QuoteItem {
  id: string;
  description: string;
  item_description?: string;
  quantity: number;
  unit_price: number;
  total: number;
  sort_order?: number;
}

interface Quote {
  id: string;
  quote_number: string;
  status: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  notes?: string;
  valid_until?: string;
  created_at: string;
  approved_at?: string;
  customer: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
  property?: {
    address: string;
    city: string;
    state?: string;
    zip?: string;
  };
  items: QuoteItem[];
}

export default function PortalQuotePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const quoteId = params.id as string;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSignature, setShowSignature] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [approved, setApproved] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    fetchQuote();
  }, [token, quoteId]);

  const fetchQuote = async () => {
    try {
      const res = await fetch(`/api/portal/${token}/quotes/${quoteId}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to load quote');
        return;
      }

      setQuote(data.quote);
      if (data.quote.customer?.name) {
        setSignerName(data.quote.customer.name);
      }
    } catch (err) {
      setError('Failed to load quote');
    } finally {
      setLoading(false);
    }
  };

  // Signature drawing
  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsDrawing(true);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.strokeStyle = '#1f3b4d';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const handleApprove = async () => {
    if (!hasSignature || !signerName.trim()) {
      toast.warning('Please enter your name and sign the quote');
      return;
    }

    setSubmitting(true);
    try {
      const canvas = canvasRef.current;
      const signatureData = canvas?.toDataURL('image/png') || '';

      const res = await fetch(`/api/portal/${token}/quotes/${quoteId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signature: signatureData,
          signerName: signerName.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Failed to approve quote');
        return;
      }

      setApproved(true);
      setShowSignature(false);
      toast.success('Quote approved successfully!');
      // Refresh quote data
      fetchQuote();
    } catch {
      toast.error('Failed to approve quote');
    } finally {
      setSubmitting(false);
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

  const getStatusBadge = (status: string) => {
    const styles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
      draft: { bg: 'bg-gray-100', text: 'text-gray-700', icon: <FileText className="h-4 w-4" /> },
      sent: { bg: 'bg-blue-100', text: 'text-blue-700', icon: <Clock className="h-4 w-4" /> },
      approved: { bg: 'bg-green-100', text: 'text-green-700', icon: <CheckCircle className="h-4 w-4" /> },
      declined: { bg: 'bg-red-100', text: 'text-red-700', icon: <AlertCircle className="h-4 w-4" /> },
      expired: { bg: 'bg-orange-100', text: 'text-orange-700', icon: <AlertCircle className="h-4 w-4" /> },
    };
    const style = styles[status] || styles.draft;
    return (
      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${style.bg} ${style.text}`}>
        {style.icon}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Quote Not Found</h1>
          <p className="text-gray-600">{error || 'This quote could not be loaded.'}</p>
        </div>
      </div>
    );
  }

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();
  const canApprove = quote.status === 'sent' && !isExpired;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#1f3b4d] text-white py-8">
        <div className="max-w-3xl mx-auto px-4">
          <Link href={`/portal/${token}`} className="inline-flex items-center gap-1 text-white/80 hover:text-white text-sm mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to Portal
          </Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold">Quote #{quote.quote_number}</h1>
              <p className="text-white/80 mt-1">Southern California Well Service</p>
            </div>
            {getStatusBadge(quote.status)}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Success message */}
        {approved && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-3">
            <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-green-800">Quote Approved!</p>
              <p className="text-sm text-green-700">Thank you! We&apos;ll be in touch soon to schedule your service.</p>
            </div>
          </div>
        )}

        {/* Quote details card */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {/* Property info */}
          {quote.property && (
            <div className="px-6 py-4 bg-gray-50 border-b">
              <p className="text-sm text-gray-500">Property</p>
              <p className="font-medium text-gray-900">
                {quote.property.address}, {quote.property.city}
                {quote.property.state && `, ${quote.property.state}`}
                {quote.property.zip && ` ${quote.property.zip}`}
              </p>
            </div>
          )}

          {/* Line items */}
          <div className="px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quote Details</h2>
            <div className="space-y-3">
              {quote.items
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                .map((item) => (
                  <div key={item.id} className="flex justify-between py-3 border-b border-gray-100 last:border-0">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{item.description}</p>
                      {item.item_description && (
                        <p className="text-sm text-gray-500 mt-0.5">{item.item_description}</p>
                      )}
                      <p className="text-sm text-gray-500 mt-1">
                        {item.quantity} × {formatCurrency(item.unit_price)}
                      </p>
                    </div>
                    <p className="font-medium text-gray-900 ml-4">{formatCurrency(item.total)}</p>
                  </div>
                ))}
            </div>
          </div>

          {/* Totals */}
          <div className="px-6 py-4 bg-gray-50 border-t">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Subtotal</span>
                <span className="text-gray-900">{formatCurrency(quote.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Tax ({quote.tax_rate}%)</span>
                <span className="text-gray-900">{formatCurrency(quote.tax_amount)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold pt-2 border-t">
                <span className="text-gray-900">Total</span>
                <span className="text-[#1f3b4d]">{formatCurrency(quote.total)}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {quote.notes && (
            <div className="px-6 py-4 border-t bg-amber-50">
              <p className="text-sm font-medium text-amber-800">Notes</p>
              <p className="text-sm text-amber-700 mt-1">{quote.notes}</p>
            </div>
          )}

          {/* Valid until */}
          {quote.valid_until && (
            <div className={`px-6 py-3 border-t text-sm ${isExpired ? 'bg-red-50 text-red-700' : 'text-gray-600'}`}>
              {isExpired ? (
                <span className="flex items-center gap-1.5">
                  <AlertCircle className="h-4 w-4" />
                  This quote expired on {formatDate(quote.valid_until)}
                </span>
              ) : (
                `Valid until ${formatDate(quote.valid_until)}`
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          {canApprove && !showSignature && (
            <button
              onClick={() => setShowSignature(true)}
              className="flex-1 bg-[#4e9271] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#3d7a5c] transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle className="h-5 w-5" />
              Approve Quote
            </button>
          )}
          <a
            href={`/api/quotes/${quote.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <Download className="h-5 w-5" />
            Download PDF
          </a>
          <a
            href="tel:7604408520"
            className="flex-1 bg-[#1f3b4d] text-white px-6 py-3 rounded-lg font-semibold hover:bg-[#2a4d63] transition-colors text-center"
          >
            Call (760) 440-8520
          </a>
        </div>

        {/* Signature modal */}
        {showSignature && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Approve Quote #{quote.quote_number}</h3>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                <input
                  type="text"
                  value={signerName}
                  onChange={(e) => setSignerName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#4e9271] focus:border-transparent"
                  placeholder="Enter your full name"
                />
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Signature</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg bg-gray-50 relative">
                  <canvas
                    ref={canvasRef}
                    width={400}
                    height={150}
                    className="w-full touch-none cursor-crosshair"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                  />
                  {!hasSignature && (
                    <p className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
                      Sign here
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={clearSignature}
                  className="text-sm text-gray-500 hover:text-gray-700 mt-2"
                >
                  Clear signature
                </button>
              </div>

              <p className="text-xs text-gray-500 mb-4">
                By signing, you agree to the terms of this quote and authorize Southern California Well Service to proceed with the work as described.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowSignature(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleApprove}
                  disabled={submitting || !hasSignature || !signerName.trim()}
                  className="flex-1 px-4 py-2 bg-[#4e9271] text-white rounded-lg hover:bg-[#3d7a5c] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Approve & Sign'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Questions? Call us at (760) 440-8520</p>
          <p className="mt-1">Southern California Well Service • 1077 Main St, Ramona, CA 92065</p>
        </div>
      </div>
    </div>
  );
}
