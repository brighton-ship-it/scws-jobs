'use client';

/**
 * Internal Jobber quote GP tracker.
 *
 * Auth: sign in to the CRM, or set QUOTES_GP_KEY (or ADMIN_SECRET) and open
 *   /ops/quotes-gp?key=<QUOTES_GP_KEY>
 * Read-only. Does not send quotes or change street prices.
 * FLAG / GP / costs stay on this page only — never on customer titles or messages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';
import { summarizeQuoteGpScores, type QuoteGpSummary } from '@/lib/jobber/quote-gp-score';
import {
  quoteMatchesSearch,
  type QuotesPageInfo,
  type TrackedQuote,
} from '@/lib/jobber/quote-gp-types';
import { Badge, QuoteStatusBadge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'awaiting_response', label: 'Awaiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'converted', label: 'Converted' },
  { value: 'archived', label: 'Archived' },
] as const;

type SortKey = 'gp_asc' | 'gp_desc' | 'missing_desc' | 'missing_asc' | 'date_desc' | 'date_asc';

const KEY_STORAGE = 'quotes_gp_key';

function money(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(
    amount
  );
}

function moneyExact(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function gpLabel(pct: number | null | undefined, costStatus: TrackedQuote['costStatus']): string {
  if (pct == null || !Number.isFinite(pct)) return 'unknown';
  const rounded = Math.round(pct);
  return costStatus === 'partial' ? `${rounded}% (partial)` : `${rounded}%`;
}

function storedKey(): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  return url.searchParams.get(QUOTES_GP_KEY_QUERY)?.trim() || sessionStorage.getItem(KEY_STORAGE) || '';
}

function authHeaders(key: string): HeadersInit {
  const headers: Record<string, string> = {};
  if (key) headers[QUOTES_GP_KEY_HEADER] = key;
  return headers;
}

export default function QuotesGpPage() {
  const [key, setKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [auth, setAuth] = useState<'unknown' | 'locked' | 'ok'>('unknown');
  const [quotes, setQuotes] = useState<TrackedQuote[]>([]);
  const [pageInfo, setPageInfo] = useState<QuotesPageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('all');
  const [under60Only, setUnder60Only] = useState(false);
  const [search, setSearch] = useState('');
  const [createdAfter, setCreatedAfter] = useState('');
  const [createdBefore, setCreatedBefore] = useState('');
  const [sort, setSort] = useState<SortKey>('missing_desc');

  useEffect(() => {
    setKey(storedKey());
  }, []);

  const loadPage = useCallback(
    async (after: string | null, replace: boolean, officeKey: string) => {
      const params = new URLSearchParams();
      if (after) params.set('after', after);
      if (status !== 'all') params.set('status', status);
      if (createdAfter) params.set('createdAfter', createdAfter);
      if (createdBefore) params.set('createdBefore', createdBefore);
      const res = await fetch(`/api/ops/quotes-gp?${params.toString()}`, {
        headers: authHeaders(officeKey),
        credentials: 'same-origin',
      });
      if (res.status === 401) {
        setAuth('locked');
        throw new Error('Unauthorized');
      }
      setAuth('ok');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load Jobber quotes');
      }
      setPageInfo(data.pageInfo as QuotesPageInfo);
      setQuotes((prev) => {
        const next = data.quotes as TrackedQuote[];
        if (replace) return next;
        const seen = new Set(prev.map((row) => row.id));
        return [...prev, ...next.filter((row) => !seen.has(row.id))];
      });
      return data.pageInfo as QuotesPageInfo;
    },
    [status, createdAfter, createdBefore]
  );

  const loadAll = useCallback(
    async (officeKey: string) => {
      setLoading(true);
      setError(null);
      setQuotes([]);
      setPageInfo(null);
      try {
        let info = await loadPage(null, true, officeKey);
        setLoading(false);
        while (info?.hasNextPage && info.endCursor) {
          setLoadingMore(true);
          info = await loadPage(info.endCursor, false, officeKey);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load Jobber quotes';
        if (message !== 'Unauthorized') setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [loadPage]
  );

  useEffect(() => {
    void loadAll(key);
  }, [loadAll, key]);

  const unlock = (event: React.FormEvent) => {
    event.preventDefault();
    const next = keyInput.trim();
    if (!next) return;
    sessionStorage.setItem(KEY_STORAGE, next);
    const url = new URL(window.location.href);
    url.searchParams.set(QUOTES_GP_KEY_QUERY, next);
    window.history.replaceState({}, '', url.toString());
    setAuth('unknown');
    setKey(next);
  };

  const filtered = useMemo(() => {
    return quotes.filter((quote) => {
      if (under60Only && !quote.flaggedUnder60) return false;
      if (!quoteMatchesSearch(quote, search)) return false;
      if (createdAfter) {
        const stamp = quote.sentAt || quote.createdAt;
        if (stamp && stamp.slice(0, 10) < createdAfter) return false;
      }
      if (createdBefore) {
        const stamp = quote.sentAt || quote.createdAt;
        if (stamp && stamp.slice(0, 10) > createdBefore) return false;
      }
      return true;
    });
  }, [quotes, under60Only, search, createdAfter, createdBefore]);

  const sorted = useMemo(() => {
    const rows = [...filtered];
    const gp = (row: TrackedQuote) => (row.gpPercent == null ? Number.POSITIVE_INFINITY : row.gpPercent);
    const miss = (row: TrackedQuote) => row.missingMarginDollars ?? -1;
    const date = (row: TrackedQuote) => new Date(row.sentAt || row.createdAt || 0).getTime();
    rows.sort((a, b) => {
      if (sort === 'gp_asc') return gp(a) - gp(b);
      if (sort === 'gp_desc') return gp(b) - gp(a);
      if (sort === 'missing_desc') return miss(b) - miss(a);
      if (sort === 'missing_asc') return miss(a) - miss(b);
      if (sort === 'date_asc') return date(a) - date(b);
      return date(b) - date(a);
    });
    return rows;
  }, [filtered, sort]);

  const summary: QuoteGpSummary = useMemo(() => summarizeQuoteGpScores(filtered), [filtered]);

  const dateLabel = (value: string | null) => {
    if (!value) return '—';
    try {
      return format(parseISO(value), 'MMM d, yyyy');
    } catch {
      return value.slice(0, 10);
    }
  };

  if (auth === 'unknown' && quotes.length === 0 && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking office access…
      </div>
    );
  }

  if (auth === 'locked' && quotes.length === 0) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h2 className="text-xl font-bold text-slate-900">Quote GP tracker</h2>
        <p className="text-sm text-slate-600">
          Office only. Sign in to the CRM, or enter <code className="rounded bg-slate-100 px-1">QUOTES_GP_KEY</code>.
        </p>
        <form onSubmit={unlock} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <label className="block text-sm font-medium text-slate-700">
            Office key
            <input
              type="password"
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Unlock
          </button>
        </form>
        <p className="text-xs text-slate-500">
          Or open <a className="underline" href="/login">/login</a> and return here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Jobber quote GP</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Street prices stay street. Target ≥60% GP. Under-60% is flagged here only — not on quote
            titles, messages, or the client Hub. Missing cost is unknown. Read-only; this page does not
            send or edit Jobber quotes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll(key)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Reload
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Under 60% GP</p>
            <p className="mt-1 text-2xl font-bold text-red-700">{summary.under60Count}</p>
            <p className="text-sm text-slate-500">{money(summary.under60Sell)} street</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Overall GP (costed quotes)</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {summary.overallGpPercent == null ? 'unknown' : `${Math.round(summary.overallGpPercent)}%`}
            </p>
            <p className="text-sm text-slate-500">
              {summary.scoredCount} quotes · {money(summary.scoredSell)} street vs {money(summary.scoredCost)} cost
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Loaded</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {quotes.length}
              {pageInfo?.totalCount != null ? (
                <span className="text-base font-medium text-slate-400"> / {pageInfo.totalCount}</span>
              ) : null}
            </p>
            <p className="text-sm text-slate-500">
              {summary.unknownCount} cost unknown
              {loadingMore ? ' · paging Jobber…' : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search client or quote #"
                className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm"
              />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={under60Only}
                onChange={(event) => setUnder60Only(event.target.checked)}
              />
              Under 60% only
            </label>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
            >
              <option value="missing_desc">Missing margin $ (high)</option>
              <option value="missing_asc">Missing margin $ (low)</option>
              <option value="gp_asc">GP % (low)</option>
              <option value="gp_desc">GP % (high)</option>
              <option value="date_desc">Newest</option>
              <option value="date_asc">Oldest</option>
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setStatus(filter.value)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  status === filter.value
                    ? 'bg-emerald-700 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {filter.label}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
              From
              <input
                type="date"
                value={createdAfter}
                onChange={(event) => setCreatedAfter(event.target.value)}
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              To
              <input
                type="date"
                value={createdBefore}
                onChange={(event) => setCreatedBefore(event.target.value)}
                className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">{error}</p>
            <p className="mt-1 text-amber-800">
              Needs <code>JOBBER_ACCESS_TOKEN</code> in this environment. This tracker does not use fixtures.
            </p>
          </div>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableCell header>Quote</TableCell>
            <TableCell header>Client</TableCell>
            <TableCell header>Title</TableCell>
            <TableCell header>Status</TableCell>
            <TableCell header>Shop / city</TableCell>
            <TableCell header className="text-right">Subtotal</TableCell>
            <TableCell header className="text-right">Est. cost</TableCell>
            <TableCell header className="text-right">GP $</TableCell>
            <TableCell header className="text-right">GP %</TableCell>
            <TableCell header>60% flag</TableCell>
            <TableCell header>Created / sent</TableCell>
            <TableCell header>Jobber</TableCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && quotes.length === 0 ? (
            <TableEmpty message="Loading live Jobber quotes…" />
          ) : sorted.length === 0 ? (
            <TableEmpty message="No quotes match these filters." />
          ) : (
            sorted.map((quote) => (
              <TableRow key={quote.id} className={quote.flaggedUnder60 ? 'bg-red-50/60' : ''}>
                <TableCell className="font-medium text-slate-900">#{quote.quoteNumber || '—'}</TableCell>
                <TableCell>{quote.client}</TableCell>
                <TableCell className="max-w-xs truncate" title={quote.title}>
                  {quote.title}
                </TableCell>
                <TableCell>
                  <QuoteStatusBadge status={quote.status} />
                </TableCell>
                <TableCell className="capitalize text-slate-600">
                  {quote.shop ? `${quote.shop}` : '—'}
                  {quote.city ? ` · ${quote.city}` : ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">{moneyExact(quote.subtotal)}</TableCell>
                <TableCell className="text-right tabular-nums text-slate-600">
                  {quote.estimatedCost == null ? (
                    <span className="text-slate-400">unknown</span>
                  ) : (
                    moneyExact(quote.estimatedCost)
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {quote.gpDollars == null ? (
                    <span className="text-slate-400">unknown</span>
                  ) : (
                    moneyExact(quote.gpDollars)
                  )}
                </TableCell>
                <TableCell
                  className={`text-right tabular-nums font-semibold ${
                    quote.gpPercent == null
                      ? 'text-slate-400'
                      : quote.underTarget
                        ? 'text-red-700'
                        : 'text-emerald-700'
                  }`}
                >
                  {gpLabel(quote.gpPercent, quote.costStatus)}
                </TableCell>
                <TableCell>
                  {quote.flaggedUnder60 ? (
                    <Badge variant="danger">FLAG</Badge>
                  ) : quote.costStatus === 'unknown' ? (
                    <Badge variant="default">unknown</Badge>
                  ) : quote.costStatus === 'partial' ? (
                    <Badge variant="warning">partial cost</Badge>
                  ) : (
                    <Badge variant="success">ok</Badge>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-slate-500">
                  {dateLabel(quote.createdAt)}
                  {quote.sentAt ? ` · sent ${dateLabel(quote.sentAt)}` : ''}
                </TableCell>
                <TableCell>
                  {quote.jobberWebUri ? (
                    <a
                      href={quote.jobberWebUri}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {loadingMore && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading next Jobber page…
          {pageInfo?.totalCount != null ? ` ${quotes.length} / ${pageInfo.totalCount}` : ` ${quotes.length} so far`}
        </p>
      )}
    </div>
  );
}
