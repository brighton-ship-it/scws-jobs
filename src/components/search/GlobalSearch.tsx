'use client';

import { useEffect, useRef } from 'react';
import { Search, User, Briefcase, FileText, ArrowRight } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSearch, SearchResult } from '@/contexts/SearchContext';

const resultTypeIcons = {
  customer: User,
  job: Briefcase,
  invoice: FileText,
};

const resultTypeColors = {
  customer: 'bg-green-100 text-green-600',
  job: 'bg-blue-100 text-blue-600',
  invoice: 'bg-purple-100 text-purple-600',
};

export function GlobalSearch() {
  const { isOpen, query, results, setQuery, closeSearch } = useSearch();
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeSearch}
      />

      {/* Dialog */}
      <div className="relative mx-auto mt-[10vh] max-w-2xl px-4">
        <div className="rounded-xl bg-white shadow-2xl ring-1 ring-black/5">
          {/* Search Input */}
          <div className="flex items-center border-b border-gray-200 px-4">
            <Search className="h-5 w-5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search customers, jobs, invoices..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full border-0 bg-transparent px-4 py-4 text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-0"
            />
            <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded border bg-gray-100 px-2 font-mono text-xs font-medium text-gray-500">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {query.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Search className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">
                  Start typing to search across customers, jobs, and invoices
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Tip: Use <kbd className="rounded bg-gray-100 px-1">⌘K</kbd> to open search anytime
                </p>
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-gray-500">
                  No results found for &quot;{query}&quot;
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Try searching for a customer name, job type, or invoice number
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {results.map((result) => {
                  const Icon = resultTypeIcons[result.type];
                  const colorClass = resultTypeColors[result.type];

                  return (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => handleResultClick(result)}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-gray-100 transition-colors group"
                    >
                      <div className={`rounded-lg p-2 ${colorClass}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {result.title}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {result.subtitle}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {results.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3 text-xs text-gray-500">
              <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
              <span>
                Press <kbd className="rounded bg-gray-100 px-1">↵</kbd> to select
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
