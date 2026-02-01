'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from 'react';
import { mockCustomers, mockJobs, mockInvoices, getPropertyById, getCustomerById } from '@/lib/mock-data';

export interface SearchResult {
  type: 'customer' | 'job' | 'invoice';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchContextType {
  isOpen: boolean;
  query: string;
  results: SearchResult[];
  setQuery: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  toggleSearch: () => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  const search = useCallback((searchQuery: string) => {
    if (!searchQuery.trim()) {
      setResults([]);
      return;
    }

    const q = searchQuery.toLowerCase();
    const searchResults: SearchResult[] = [];

    // Search customers
    mockCustomers.forEach(customer => {
      if (
        customer.name.toLowerCase().includes(q) ||
        customer.email?.toLowerCase().includes(q) ||
        customer.phone?.includes(q)
      ) {
        searchResults.push({
          type: 'customer',
          id: customer.id,
          title: customer.name,
          subtitle: customer.email || customer.phone || 'Customer',
          href: `/customers/${customer.id}`,
        });
      }
    });

    // Search jobs
    mockJobs.forEach(job => {
      const property = getPropertyById(job.property_id);
      const customer = property ? getCustomerById(property.customer_id) : null;
      
      if (
        job.job_type.toLowerCase().includes(q) ||
        job.description?.toLowerCase().includes(q) ||
        customer?.name.toLowerCase().includes(q) ||
        property?.address.toLowerCase().includes(q)
      ) {
        searchResults.push({
          type: 'job',
          id: job.id,
          title: `${job.job_type} - ${customer?.name || 'Unknown'}`,
          subtitle: `${property?.address || ''} • ${job.scheduled_date || 'Unscheduled'}`,
          href: `/jobs/${job.id}/edit`,
        });
      }
    });

    // Search invoices
    mockInvoices.forEach(invoice => {
      const customer = getCustomerById(invoice.customer_id);
      
      if (
        invoice.invoice_number.toLowerCase().includes(q) ||
        customer?.name.toLowerCase().includes(q)
      ) {
        searchResults.push({
          type: 'invoice',
          id: invoice.id,
          title: `Invoice ${invoice.invoice_number}`,
          subtitle: `${customer?.name || 'Unknown'} • $${invoice.amount.toLocaleString()}`,
          href: `/invoices/${invoice.id}`,
        });
      }
    });

    setResults(searchResults.slice(0, 10));
  }, []);

  useEffect(() => {
    search(query);
  }, [query, search]);

  const openSearch = useCallback(() => setIsOpen(true), []);
  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
  }, []);
  const toggleSearch = useCallback(() => {
    if (isOpen) {
      closeSearch();
    } else {
      openSearch();
    }
  }, [isOpen, closeSearch, openSearch]);

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
      }
      if (e.key === 'Escape' && isOpen) {
        closeSearch();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, toggleSearch, closeSearch]);

  return (
    <SearchContext.Provider
      value={{
        isOpen,
        query,
        results,
        setQuery,
        openSearch,
        closeSearch,
        toggleSearch,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}
