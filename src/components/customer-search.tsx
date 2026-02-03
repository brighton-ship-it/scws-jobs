'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, X, User, MapPin, Loader2, ChevronDown } from 'lucide-react';
import type { Customer, Property } from '@/types/database';

interface CustomerWithProperties extends Customer {
  properties: Property[];
}

interface CustomerSearchProps {
  value: string;
  onChange: (customerId: string, customer?: CustomerWithProperties) => void;
  onPropertiesLoaded?: (properties: Property[]) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
}

export function CustomerSearch({
  value,
  onChange,
  onPropertiesLoaded,
  label,
  placeholder = 'Search customers...',
  required,
  error,
  disabled,
}: CustomerSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState<CustomerWithProperties[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerWithProperties | null>(null);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch customers with search
  const fetchCustomers = useCallback(async (searchTerm: string) => {
    setLoading(true);
    try {
      const url = searchTerm 
        ? `/api/customers?search=${encodeURIComponent(searchTerm)}&limit=20`
        : '/api/customers?limit=20';
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setCustomers(data.customers || []);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      fetchCustomers(search);
    }, 300);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search, isOpen, fetchCustomers]);

  // Load initial customer if value is set
  useEffect(() => {
    if (value && !selectedCustomer) {
      fetch(`/api/customers/${value}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (data?.customer) {
            setSelectedCustomer(data.customer);
            onPropertiesLoaded?.(data.customer.properties || []);
          }
        })
        .catch(console.error);
    }
  }, [value, selectedCustomer, onPropertiesLoaded]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (customer: CustomerWithProperties) => {
    setSelectedCustomer(customer);
    onChange(customer.id, customer);
    onPropertiesLoaded?.(customer.properties || []);
    setIsOpen(false);
    setSearch('');
  };

  const handleClear = () => {
    setSelectedCustomer(null);
    onChange('', undefined);
    onPropertiesLoaded?.([]);
    setSearch('');
  };

  const handleOpen = () => {
    if (disabled) return;
    setIsOpen(true);
    fetchCustomers('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const getPrimaryAddress = (customer: CustomerWithProperties): string | null => {
    const properties = customer.properties || [];
    if (properties.length === 0) return null;
    const prop = properties[0];
    const parts = [prop.address];
    if (prop.city) parts.push(prop.city);
    return parts.join(', ');
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
      )}

      {/* Selected Customer Display / Trigger */}
      <div
        onClick={handleOpen}
        className={`
          flex items-center justify-between px-3.5 py-2.5 rounded-lg border bg-white
          transition-all duration-150 cursor-pointer
          ${disabled ? 'bg-gray-50 cursor-not-allowed' : 'hover:border-gray-400'}
          ${error ? 'border-red-400' : 'border-gray-200'}
          ${isOpen ? 'ring-2 ring-emerald-500/20 border-emerald-500' : ''}
        `}
      >
        {selectedCustomer ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
            <div className="truncate">
              <span className="font-medium text-gray-900">{selectedCustomer.name}</span>
              {getPrimaryAddress(selectedCustomer) && (
                <span className="text-gray-500 text-sm ml-2">
                  — {getPrimaryAddress(selectedCustomer)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <span className="text-gray-400">{placeholder}</span>
        )}
        
        <div className="flex items-center gap-1 flex-shrink-0">
          {selectedCustomer && !disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <X className="h-4 w-4 text-gray-400" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
          {/* Search Input */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type to search..."
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              />
              {loading && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
              )}
            </div>
          </div>

          {/* Results */}
          <div className="max-h-64 overflow-y-auto">
            {customers.length === 0 && !loading && (
              <div className="px-4 py-6 text-center text-gray-500 text-sm">
                {search ? 'No customers found' : 'Start typing to search...'}
              </div>
            )}
            
            {customers.map((customer) => {
              const address = getPrimaryAddress(customer);
              return (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => handleSelect(customer)}
                  className={`
                    w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors
                    ${customer.id === value ? 'bg-emerald-50' : ''}
                  `}
                >
                  <div className="flex items-start gap-3">
                    <User className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900">{customer.name}</div>
                      {address && (
                        <div className="flex items-center gap-1 text-sm text-gray-500 mt-0.5">
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{address}</span>
                        </div>
                      )}
                      {customer.phone && (
                        <div className="text-sm text-gray-400 mt-0.5">{customer.phone}</div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mt-1.5 text-sm text-red-600">{error}</p>
      )}
    </div>
  );
}

export default CustomerSearch;
