/** Read-only: quotes approved in a window, by Jobber's status-change time (transitionedAt). */
import { assertNoJobberErrors, jobberGraphql } from './client.ts';
import type { JobberDeps } from './quotes.ts';

export interface ApprovedQuoteRow {
  quoteNumber: string | null; client: string | null; title: string | null; status: string | null;
  sentAt: string | null; approvedAt: string | null; subtotal: number | null; total: number | null;
}
export interface ListApprovedResult { count: number; subtotal: number; total: number; quotes: ApprovedQuoteRow[]; scanned: number; truncated: boolean }
const round = (n: number) => Math.round(n * 100) / 100;

const QUERY = `query McpQuotesApproved($first: Int!, $after: String, $filter: QuoteFilterAttributes) {
  quotes(first: $first, after: $after, filter: $filter) {
    nodes { quoteNumber title quoteStatus sentAt transitionedAt amounts { subtotal total } client { name companyName } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function listApprovedQuotes(
  input: { after: string; before: string; maxPages?: number },
  deps?: JobberDeps
): Promise<ListApprovedResult> {
  const lo = Date.parse(input.after), hi = Date.parse(input.before);
  const maxPages = Math.min(Math.max(input.maxPages ?? 20, 1), 40);
  const quotes: ApprovedQuoteRow[] = [];
  let scanned = 0, truncated = false;
  for (const status of ['approved', 'converted']) {
    let cursor: string | null = null;
    for (let page = 0; page < maxPages; page++) {
      const res = await jobberGraphql(QUERY, { first: 50, after: cursor, filter: { status } }, { token: deps?.token, fetchImpl: deps?.fetchImpl, env: deps?.env });
      assertNoJobberErrors(res, 'list_quotes_approved');
      const conn: any = res.data?.quotes;
      for (const n of conn?.nodes ?? []) {
        scanned++;
        const t = Date.parse(n.transitionedAt || '');
        if (!Number.isFinite(t) || t < lo || t >= hi) continue;
        quotes.push({
          quoteNumber: n.quoteNumber ?? null, client: n.client?.name || n.client?.companyName || null, title: n.title ?? null,
          status: n.quoteStatus ?? null, sentAt: n.sentAt ?? null, approvedAt: n.transitionedAt ?? null,
          subtotal: n.amounts?.subtotal ?? null, total: n.amounts?.total ?? null,
        });
      }
      if (!conn?.pageInfo?.hasNextPage) break;
      cursor = conn.pageInfo.endCursor ?? null;
      if (page === maxPages - 1) truncated = true;
    }
  }
  quotes.sort((a, b) => (a.approvedAt || '').localeCompare(b.approvedAt || ''));
  return {
    count: quotes.length, subtotal: round(quotes.reduce((s, q) => s + (q.subtotal ?? 0), 0)),
    total: round(quotes.reduce((s, q) => s + (q.total ?? 0), 0)), quotes, scanned, truncated,
  };
}
