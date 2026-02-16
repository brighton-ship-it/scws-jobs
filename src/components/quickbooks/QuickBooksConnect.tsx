'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/forms/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Link2, Unlink, CheckCircle, AlertCircle } from 'lucide-react';

interface QBOStatus {
  connected: boolean;
  companyName?: string;
  environment?: string;
  connectedAt?: string;
  tokenExpired?: boolean;
}

export function QuickBooksConnect() {
  const [status, setStatus] = useState<QBOStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkStatus();
    
    // Check URL for success/error messages
    const params = new URLSearchParams(window.location.search);
    if (params.get('qb_success')) {
      checkStatus();
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('qb_error')) {
      const errorMsg = params.get('qb_error');
      console.error('QuickBooks error:', errorMsg);
      setError(errorMsg);
      // Don't clear URL immediately so we can debug
      setTimeout(() => {
        window.history.replaceState({}, '', window.location.pathname);
      }, 5000);
    }
  }, []);

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/quickbooks/status');
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to check QuickBooks status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    window.location.href = '/api/quickbooks/connect';
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect QuickBooks?')) return;
    
    setDisconnecting(true);
    try {
      await fetch('/api/quickbooks/status', { method: 'DELETE' });
      setStatus({ connected: false });
    } catch (error) {
      console.error('Failed to disconnect:', error);
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            QuickBooks Online
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" fill="#2CA01C"/>
            <path d="M7 12c0-2.76 2.24-5 5-5s5 2.24 5 5-2.24 5-5 5" stroke="white" strokeWidth="2" fill="none"/>
          </svg>
          QuickBooks Online
          {status?.connected ? (
            <Badge variant="success" className="ml-2">
              <CheckCircle className="h-3 w-3 mr-1" />
              Connected
            </Badge>
          ) : (
            <Badge variant="default" className="ml-2">
              Not Connected
            </Badge>
          )}
        </CardTitle>
        <p className="text-sm text-gray-500">
          Sync customers, invoices, and payments with QuickBooks Online
        </p>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <strong>Connection failed:</strong> {error}
            </p>
          </div>
        )}
        {status?.connected ? (
          <div className="space-y-4">
            <div className="text-sm text-gray-600 space-y-1">
              {status.companyName && (
                <p><strong>Company:</strong> {status.companyName}</p>
              )}
              <p><strong>Environment:</strong> {status.environment}</p>
              <p><strong>Connected:</strong> {status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : 'Unknown'}</p>
              {status.tokenExpired && (
                <p className="text-red-600 flex items-center gap-1">
                  <AlertCircle className="h-4 w-4" />
                  Token expired - please reconnect
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                onClick={handleDisconnect}
                disabled={disconnecting}
                leftIcon={disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
              >
                Disconnect
              </Button>
              {status.tokenExpired && (
                <Button 
                  onClick={handleConnect}
                  leftIcon={<Link2 className="h-4 w-4" />}
                >
                  Reconnect
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Connect your QuickBooks Online account to automatically sync:
            </p>
            <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
              <li>Customers</li>
              <li>Invoices</li>
              <li>Payments</li>
            </ul>
            <Button 
              onClick={handleConnect}
              leftIcon={<Link2 className="h-4 w-4" />}
            >
              Connect QuickBooks
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default QuickBooksConnect;
