/** Read-only: quotes approved in a window, by Jobber's status-change time (transitionedAt). */
import { assertNoJobberErrors, jobberGraphql } from './client.ts';
import type { JobberDeps } from './quotes.ts';

export interface ApprovedQuoteRow {
  quoteNumber: string | null; client: string | null; title: string | null; status: string | null;
  sentAt: string | null; approvedAt: string | null; subtotal: number | null; total: number | null;
}
export interface ListApprovedResult { nextCursor: string | null; count: number; subtotal: number; total: number; quotes: ApprovedQuoteRow[]; scanned: number; truncated: boolean }
const round = (n: number) => Math.round(n * 100) / 100;

const QUERY = `query McpQuotesApproved($first: Int!, $after: String, $filter: QuoteFilterAttributes) {
  quotes(first: $first, after: $after, filter: $filter) {
    nodes { quoteNumber title quoteStatus sentAt transitionedAt amounts { subtotal total } client { name companyName } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function listApprovedQuotes(
  input: { after: string; before: string; status?: 'approved' | 'converted'; cursor?: string | null; maxPages?: number; budgetMs?: number },
  deps?: JobberDeps
): Promise<ListApprovedResult> {
  const lo = Date.parse(input.after), hi = Date.parse(input.before);
  const maxPages = Math.min(Math.max(input.maxPages ?? 20, 1), 40);
  const budget = Date.now() + (input.budgetMs ?? 40_000); // route maxDuration is 60s; resume with nextCursor
  const quotes: ApprovedQuoteRow[] = [];
  let scanned = 0, truncated = false, nextCursor: string | null = null;
  const status = input.status ?? 'approved';
  let cursor: string | null = input.cursor ?? null;
  for (let page = 0; page < maxPages; page++) {
    let res: Awaited<ReturnType<typeof jobberGraphql>> | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      res = await jobberGraphql(QUERY, { first: 50, after: cursor, filter: { status } }, { token: deps?.token, fetchImpl: deps?.fetchImpl, env: deps?.env });
      const throttled = (res.errors ?? []).some((e) => /throttl/i.test(e?.message || ''));
      if (!throttled) break;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    assertNoJobberErrors(res!, 'list_quotes_approved');
    const conn: any = res!.data?.quotes;
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
    if (!conn?.pageInfo?.hasNextPage) { cursor = null; break; }
    cursor = conn.pageInfo.endCursor ?? null;
    if (Date.now() > budget || page === maxPages - 1) { nextCursor = cursor; truncated = true; break; }
  }
  quotes.sort((a, b) => (a.approvedAt || '').localeCompare(b.approvedAt || ''));
  return {
    nextCursor, count: quotes.length, subtotal: round(quotes.reduce((s, q) => s + (q.subtotal ?? 0), 0)),
    total: round(quotes.reduce((s, q) => s + (q.total ?? 0), 0)), quotes, scanned, truncated,
  };
}
