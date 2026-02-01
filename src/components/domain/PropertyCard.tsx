import React from 'react';
import { StatusBadge } from '../data-display/StatusBadge';

export interface Well {
  id: string;
  name: string;
  type: string;
  depth?: number;
  lastService?: string;
  status: 'active' | 'inactive' | 'needs-service';
}

export interface Property {
  id: string;
  name?: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  county?: string;
  acreage?: number;
  wells?: Well[];
  notes?: string;
  lastJobDate?: string;
}

export interface PropertyCardProps {
  property: Property;
  onClick?: () => void;
  onAddJob?: () => void;
  onViewWells?: () => void;
  showWells?: boolean;
  className?: string;
}

const wellStatusStyles = {
  active: { bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
  inactive: { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' },
  'needs-service': { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
};

export function PropertyCard({
  property,
  onClick,
  onAddJob,
  onViewWells,
  showWells = true,
  className = '',
}: PropertyCardProps) {
  const fullAddress = `${property.address}, ${property.city}, ${property.state} ${property.zipCode}`;
  const wellsNeedingService = property.wells?.filter(w => w.status === 'needs-service').length || 0;

  return (
    <div
      onClick={onClick}
      className={`
        bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden
        ${onClick ? 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all duration-200' : ''}
        ${className}
      `}
    >
      <div className="p-4">
        {/* Header with warning if wells need service */}
        {wellsNeedingService > 0 && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-amber-50 rounded-lg text-amber-700 text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {wellsNeedingService} well{wellsNeedingService > 1 ? 's' : ''} need service
          </div>
        )}

        {/* Property Name & Address */}
        <div className="mb-3">
          {property.name && (
            <h3 className="text-lg font-semibold text-slate-800 mb-1">{property.name}</h3>
          )}
          <div className="flex items-start gap-2 text-slate-600">
            <svg className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <div>
              <p className="font-medium">{property.address}</p>
              <p className="text-sm text-slate-500">
                {property.city}, {property.state} {property.zipCode}
              </p>
            </div>
          </div>
        </div>

        {/* Property Details */}
        <div className="flex flex-wrap gap-4 text-sm mb-3">
          {property.county && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span>{property.county} County</span>
            </div>
          )}
          {property.acreage && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span>{property.acreage} acres</span>
            </div>
          )}
          {property.lastJobDate && (
            <div className="flex items-center gap-1.5 text-slate-500">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span>Last service: {new Date(property.lastJobDate).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Wells List */}
        {showWells && property.wells && property.wells.length > 0 && (
          <div className="border-t border-slate-100 pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400 uppercase tracking-wide font-medium">
                Wells ({property.wells.length})
              </span>
              {onViewWells && (
                <button
                  onClick={(e) => { e.stopPropagation(); onViewWells(); }}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  View all
                </button>
              )}
            </div>
            <div className="space-y-2">
              {property.wells.slice(0, 3).map((well) => {
                const statusStyle = wellStatusStyles[well.status];
                return (
                  <div
                    key={well.id}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg ${statusStyle.bg}`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${statusStyle.dot}`} />
                      <span className={`text-sm font-medium ${statusStyle.text}`}>{well.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                      <span>{well.type}</span>
                      {well.depth && <span>{well.depth} ft</span>}
                    </div>
                  </div>
                );
              })}
              {property.wells.length > 3 && (
                <p className="text-xs text-slate-400 text-center py-1">
                  +{property.wells.length - 3} more wells
                </p>
              )}
            </div>
          </div>
        )}

        {/* Notes */}
        {property.notes && (
          <div className="border-t border-slate-100 pt-3 mt-3">
            <p className="text-sm text-slate-500 line-clamp-2">{property.notes}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {onAddJob && (
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200">
          <button
            onClick={(e) => { e.stopPropagation(); onAddJob(); }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create Job
          </button>
        </div>
      )}
    </div>
  );
}

export default PropertyCard;
