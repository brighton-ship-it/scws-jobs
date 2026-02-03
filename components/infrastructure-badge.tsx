'use client';

import { Badge } from '@/components/ui/badge';
import { Droplets, Trash2, HelpCircle, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

interface InfrastructureBadgeProps {
  apn?: string;
  lat?: number;
  lng?: number;
  className?: string;
  showDetails?: boolean;
}

interface InfrastructureData {
  found: boolean;
  infrastructure: {
    apn: string;
    sewer_septic_designation: string;
    nearest_sewer_main_ft?: number;
    nearest_water_main_ft?: number;
    has_existing_well?: boolean;
  } | null;
  waterType: 'SEPTIC' | 'SEWER' | 'UNKNOWN';
}

export function InfrastructureBadge({ 
  apn, 
  lat, 
  lng, 
  className,
  showDetails = false 
}: InfrastructureBadgeProps) {
  const [data, setData] = useState<InfrastructureData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      if (!apn && (!lat || !lng)) {
        setLoading(false);
        return;
      }

      try {
        const params = apn 
          ? `apn=${encodeURIComponent(apn)}`
          : `lat=${lat}&lng=${lng}`;
        
        const res = await fetch(`/api/infrastructure?${params}`);
        const json = await res.json();
        setData(json);
      } catch (error) {
        console.error('Failed to fetch infrastructure:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [apn, lat, lng]);

  if (loading) {
    return (
      <Badge variant="secondary" className={className}>
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Loading...
      </Badge>
    );
  }

  if (!data?.found) {
    return (
      <Badge variant="secondary" className={className}>
        <HelpCircle className="h-3 w-3 mr-1" />
        Unknown
      </Badge>
    );
  }

  const { waterType, infrastructure } = data;

  const badges = {
    SEPTIC: {
      variant: 'default' as const,
      icon: Trash2,
      label: 'Septic',
      color: 'bg-amber-500 hover:bg-amber-600'
    },
    SEWER: {
      variant: 'default' as const,
      icon: Droplets,
      label: 'City Sewer',
      color: 'bg-blue-500 hover:bg-blue-600'
    },
    UNKNOWN: {
      variant: 'secondary' as const,
      icon: HelpCircle,
      label: 'Unknown',
      color: ''
    }
  };

  const badge = badges[waterType];
  const Icon = badge.icon;

  return (
    <div className={className}>
      <Badge variant={badge.variant} className={badge.color}>
        <Icon className="h-3 w-3 mr-1" />
        {badge.label}
      </Badge>
      
      {showDetails && infrastructure && (
        <div className="mt-2 text-xs text-muted-foreground">
          <p>APN: {infrastructure.apn}</p>
          {infrastructure.nearest_sewer_main_ft && (
            <p>Nearest Sewer: {Math.round(infrastructure.nearest_sewer_main_ft)} ft</p>
          )}
          {infrastructure.nearest_water_main_ft && (
            <p>Nearest Water: {Math.round(infrastructure.nearest_water_main_ft)} ft</p>
          )}
          {infrastructure.has_existing_well && (
            <p className="text-green-600">✓ Has Existing Well</p>
          )}
        </div>
      )}
    </div>
  );
}
