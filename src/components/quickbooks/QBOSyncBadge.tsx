'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/forms/Button';
import { Loader2, CloudOff, Cloud, RefreshCw } from 'lucide-react';

interface QBOSyncBadgeProps {
  qbId?: string | null;
  entityType: 'invoice' | 'customer' | 'payment';
  entityId: string;
  onSync?: (qbId: string) => void;
  showSyncButton?: boolean;
}

export function QBOSyncBadge({ 
  qbId, 
  entityType, 
  entityId, 
  onSync,
  showSyncButton = true 
}: QBOSyncBadgeProps) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedId, setSyncedId] = useState(qbId);

  const handleSync = async () => {
    setSyncing(true);
    setError(null);

    try {
      const res = await fetch(`/api/quickbooks/sync/${entityType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          [`${entityType}Id`]: entityId 
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Sync failed');
      }

      const newQbId = data.qbCustomerId || data.qbInvoiceId || data.qbPaymentId;
      setSyncedId(newQbId);
      onSync?.(newQbId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  if (syncedId) {
    return (
      <Badge variant="success" className="flex items-center gap-1">
        <Cloud className="h-3 w-3" />
        <span>QBO: {syncedId}</span>
      </Badge>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="danger" className="flex items-center gap-1">
          <CloudOff className="h-3 w-3" />
          <span>Sync Error</span>
        </Badge>
        {showSyncButton && (
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleSync}
            disabled={syncing}
            leftIcon={<RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />}
          >
            Retry
          </Button>
        )}
      </div>
    );
  }

  if (syncing) {
    return (
      <Badge variant="info" className="flex items-center gap-1">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Syncing...</span>
      </Badge>
    );
  }

  if (showSyncButton) {
    return (
      <Button 
        variant="outline" 
        size="sm" 
        onClick={handleSync}
        disabled={syncing}
        leftIcon={<Cloud className="h-3 w-3" />}
      >
        Sync to QBO
      </Button>
    );
  }

  return (
    <Badge variant="default" className="flex items-center gap-1">
      <CloudOff className="h-3 w-3" />
      <span>Not Synced</span>
    </Badge>
  );
}

export default QBOSyncBadge;
