'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Navigation, Clock, Check, AlertCircle, Loader2 } from 'lucide-react';

interface OnMyWayButtonProps {
  jobId: string;
  customerName: string;
  customerPhone: string | null;
  techName: string;
  onSuccess?: () => void;
}

export function OnMyWayButton({ 
  jobId, 
  customerName, 
  customerPhone, 
  techName,
  onSuccess 
}: OnMyWayButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [eta, setEta] = useState('15');
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSend = async () => {
    if (!customerPhone) {
      setStatus('error');
      setErrorMessage('No phone number on file');
      return;
    }

    setIsSending(true);
    setStatus('idle');
    
    try {
      const response = await fetch('/api/sms/on-my-way', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          customerName,
          customerPhone,
          techName,
          eta: eta || '15',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send');
      }

      setStatus('success');
      setIsOpen(false);
      onSuccess?.();
      
      // Reset after 3 seconds
      setTimeout(() => setStatus('idle'), 3000);
      
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'Failed to send SMS');
    } finally {
      setIsSending(false);
    }
  };

  if (status === 'success') {
    return (
      <Button variant="outline" className="text-green-600 border-green-200 bg-green-50" disabled>
        <Check className="h-4 w-4 mr-2" />
        On My Way Sent!
      </Button>
    );
  }

  if (!isOpen) {
    return (
      <Button 
        variant="primary" 
        onClick={() => setIsOpen(true)}
        disabled={!customerPhone}
        title={!customerPhone ? 'No phone number on file' : 'Send On My Way text to customer'}
      >
        <Navigation className="h-4 w-4 mr-2" />
        On My Way
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <Navigation className="h-5 w-5 text-blue-600 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-blue-800 font-medium">Send "On My Way" to {customerName?.split(' ')[0]}</p>
        <div className="flex items-center gap-2 mt-1">
          <Clock className="h-3 w-3 text-blue-600" />
          <span className="text-xs text-blue-700">ETA:</span>
          <select 
            value={eta} 
            onChange={(e) => setEta(e.target.value)}
            className="text-xs border border-blue-300 rounded px-2 py-1 bg-white"
          >
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="20">20 min</option>
            <option value="30">30 min</option>
            <option value="45">45 min</option>
            <option value="60">1 hour</option>
          </select>
        </div>
        {status === 'error' && (
          <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {errorMessage}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button 
          size="sm" 
          variant="outline" 
          onClick={() => setIsOpen(false)}
          disabled={isSending}
        >
          Cancel
        </Button>
        <Button 
          size="sm" 
          variant="primary" 
          onClick={handleSend}
          disabled={isSending}
        >
          {isSending ? (
            <>
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              Sending...
            </>
          ) : (
            'Send'
          )}
        </Button>
      </div>
    </div>
  );
}
