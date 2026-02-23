'use client';

import { useEffect, useRef } from 'react';
import { Search, User, Briefcase, FileText, ArrowRight, Command, Loader2, Receipt } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSearch, SearchResult } from '@/contexts/SearchContext';

const resultTypeIcons: Record<string, any> = {
  customer: User,
  job: Briefcase,
  invoice: FileText,
  quote: Receipt,
};

const resultTypeColors: Record<string, string> = {
  customer: 'bg-emerald-50 text-emerald-600',
  job: 'bg-blue-50 text-blue-600',
  invoice: 'bg-purple-50 text-purple-600',
  quote: 'bg-amber-50 text-amber-600',
};

export function GlobalSearch() {
  const { isOpen, query, results, isSearching, setQuery, closeSearch } = useSearch();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleResultClick = (result: SearchResult) => {
    router.push(result.href);
    closeSearch();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop - Jobber style */}
      <div
        className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm animate-fade-in"
        onClick={closeSearch}
      />

      {/* Dialog - Jobber style */}
      <div className="relative mx-auto mt-[12vh] max-w-2xl px-4">
        <div className="rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 animate-slide-up overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center border-b border-gray-100 px-5">
            <Search className="h-5 w-5 text-gray-400 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search customers, jobs, invoices..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border-0 bg-transparent px-4 py-4 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 text-base"
            />
            <kbd className="hidden sm:inline-flex h-7 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 font-mono text-xs font-medium text-gray-400">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {query.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <Search className="h-7 w-7 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-900">
                  Search across your business
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Find customers, jobs, invoices, and quotes
                </p>
                <p className="mt-4 text-xs text-gray-400 flex items-center justify-center gap-1">
                  Tip: Press <kbd className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">⌘K</kbd> to open search anytime
                </p>
              </div>
            ) : isSearching ? (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <Loader2 className="h-7 w-7 text-gray-400 animate-spin" />
                </div>
                <p className="text-sm font-medium text-gray-900">
                  Searching...
                </p>
              </div>
            ) : results.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <div className="mx-auto h-14 w-14 rounded-full bg-gray-100 flex items-center justify-center mb-4">
                  <Search className="h-7 w-7 text-gray-400" />
                </div>
                <p className="text-sm font-medium text-gray-900">
                  No results found
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  Try searching for a customer name, job number, or invoice number
                </p>
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {results.map((result) => {
                  const Icon = resultTypeIcons[result.type];
                  const colorClass = resultTypeColors[result.type];

                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => handleResultClick(result)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-gray-50 transition-all group"
                    >
                      <div className={`rounded-xl p-2.5 ${colorClass} transition-transform group-hover:scale-105`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate group-hover:text-emerald-600 transition-colors">
                          {result.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {result.subtitle}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-gray-300 opacity-0 group-hover:opacity-100 group-hover:text-emerald-500 transition-all transform group-hover:translate-x-1" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {results.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3 bg-gray-50/50">
              <span className="text-xs text-gray-500">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-white border border-gray-200 px-1.5 py-0.5 font-mono">↑</kbd>
                  <kbd className="rounded bg-white border border-gray-200 px-1.5 py-0.5 font-mono">↓</kbd>
                  to navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="rounded bg-white border border-gray-200 px-1.5 py-0.5 font-mono">↵</kbd>
                  to select
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
