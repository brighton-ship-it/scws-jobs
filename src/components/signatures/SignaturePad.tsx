'use client';

import { useRef, useState } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eraser, Check, Loader2, PenTool } from 'lucide-react';

interface SignaturePadProps {
  quoteId: string;
  onSignatureComplete?: (data: {
    signature_data: string;
    signer_name: string;
    signer_email?: string;
  }) => void;
  disabled?: boolean;
  existingSignature?: {
    signature_data: string;
    signer_name: string;
    signed_at: string;
  } | null;
}

export function SignaturePad({ 
  quoteId, 
  onSignatureComplete, 
  disabled = false,
  existingSignature 
}: SignaturePadProps) {
  const sigCanvas = useRef<SignatureCanvas>(null);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [hasDrawn, setHasDrawn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // If already signed, show the existing signature
  if (existingSignature) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2 text-green-700">
            <Check className="h-5 w-5" />
            Quote Signed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-white rounded-lg border p-4">
            <img 
              src={existingSignature.signature_data} 
              alt="Customer signature" 
              className="max-h-24 mx-auto"
            />
          </div>
          <div className="text-sm text-gray-600">
            <p><strong>Signed by:</strong> {existingSignature.signer_name}</p>
            <p><strong>Date:</strong> {new Date(existingSignature.signed_at).toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (success) {
    return (
      <Card className="border-green-200 bg-green-50/50">
        <CardContent className="py-8 text-center">
          <Check className="h-12 w-12 text-green-600 mx-auto mb-3" />
          <h3 className="font-semibold text-green-700 mb-1">Signature Saved!</h3>
          <p className="text-sm text-gray-600">Thank you for signing this quote.</p>
        </CardContent>
      </Card>
    );
  }

  const handleClear = () => {
    sigCanvas.current?.clear();
    setHasDrawn(false);
    setError(null);
  };

  const handleEnd = () => {
    if (sigCanvas.current && !sigCanvas.current.isEmpty()) {
      setHasDrawn(true);
    }
  };

  const handleSubmit = async () => {
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      setError('Please draw your signature above');
      return;
    }

    if (!signerName.trim()) {
      setError('Please enter your name');
      return;
    }

    setError(null);
    setSaving(true);

    try {
      // Get signature as base64 PNG
      const signatureData = sigCanvas.current.toDataURL('image/png');
      
      const response = await fetch('/api/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quote_id: quoteId,
          signature_data: signatureData,
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim() || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save signature');
      }

      setSuccess(true);
      
      if (onSignatureComplete) {
        onSignatureComplete({
          signature_data: signatureData,
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim() || undefined,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <PenTool className="h-5 w-5 text-sky-600" />
          Sign Quote
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Signer Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Your Name"
            required
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Enter your full name"
            disabled={disabled || saving}
          />
          <Input
            label="Email (optional)"
            type="email"
            value={signerEmail}
            onChange={(e) => setSignerEmail(e.target.value)}
            placeholder="your@email.com"
            disabled={disabled || saving}
          />
        </div>

        {/* Signature Canvas */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Signature <span className="text-red-500">*</span>
          </label>
          <div className="border-2 border-dashed border-gray-300 rounded-lg bg-white relative">
            <SignatureCanvas
              ref={sigCanvas}
              canvasProps={{
                className: 'w-full h-40 cursor-crosshair',
                style: { width: '100%', height: '160px' },
              }}
              penColor="black"
              onEnd={handleEnd}
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-gray-400 text-sm">Draw your signature here</p>
              </div>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={disabled || saving}
          >
            <Eraser className="h-4 w-4 mr-2" />
            Clear
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={disabled || saving || !hasDrawn || !signerName.trim()}
            className="flex-1"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Sign & Accept Quote
              </>
            )}
          </Button>
        </div>

        {/* Legal Text */}
        <p className="text-xs text-gray-500 text-center">
          By signing above, you agree to the terms and pricing outlined in this quote.
          Your signature is legally binding.
        </p>
      </CardContent>
    </Card>
  );
}
