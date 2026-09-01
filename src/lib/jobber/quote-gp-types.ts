import type { QuoteCostStatus } from './quote-gp-score.ts';

export type QuotesPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
  totalCount: number | null;
};

export type TrackedQuote = {
  id: string;
  quoteNumber: string;
  client: string;
  title: string;
  status: string;
  city: string | null;
  shop: 'ramona' | 'anza' | null;
  subtotal: number;
  createdAt: string | null;
  sentAt: string | null;
  jobberWebUri: string | null;
  costStatus: QuoteCostStatus;
  estimatedCost: number | null;
  gpDollars: number | null;
  gpPercent: number | null;
  underTarget: boolean;
  flaggedUnder60: boolean;
  missingMarginDollars: number | null;
  unknownLineCount: number;
  costedLineCount: number;
  flagTexts: string[];
};

export function quoteMatchesSearch(
  quote: Pick<TrackedQuote, 'quoteNumber' | 'client' | 'title' | 'city'>,
  search: string
): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return (
    quote.quoteNumber.toLowerCase().includes(needle) ||
    quote.client.toLowerCase().includes(needle) ||
    quote.title.toLowerCase().includes(needle) ||
    (quote.city || '').toLowerCase().includes(needle)
  );
}
