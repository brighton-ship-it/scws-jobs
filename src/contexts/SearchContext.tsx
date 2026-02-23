'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from 'react';

export interface SearchResult {
  type: 'customer' | 'job' | 'invoice' | 'quote';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

interface SearchContextType {
  isOpen: boolean;
  query: string;
  results: SearchResult[];
  isSearching: boolean;
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
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout>();

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=15`);
      if (res.ok) {
        const data = await res.json();
        const searchResults: SearchResult[] = (data.results || []).map((r: any) => ({
          type: r.type,
          id: r.id,
          title: r.title,
          subtitle: r.subtitle,
          href: r.url,
        }));
        setResults(searchResults);
      }
    } catch (error) {
      console.error('Search failed:', error);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    
    if (query.length >= 2) {
      setIsSearching(true);
      debounceRef.current = setTimeout(() => {
        search(query);
      }, 200);
    } else {
      setResults([]);
      setIsSearching(false);
    }

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, search]);

  const openSearch = useCallback(() => setIsOpen(true), []);
  const closeSearch = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setIsSearching(false);
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
        isSearching,
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
