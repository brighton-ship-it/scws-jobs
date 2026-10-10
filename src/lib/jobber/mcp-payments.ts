/** Read-only Jobber payment records by received (entry) date. Cannot record, collect, or refund. */
import { assertNoJobberErrors, jobberGraphql } from './client.ts';
import type { JobberDeps } from './quotes.ts';

export interface PaymentRecordRow { id: string | null; amount: number | null; entryDate: string | null; adjustmentType: string | null }
export interface ListPaymentsResult {
  count: number;
  totals: { payments: number; deposits: number; refunds: number; net: number };
  records: PaymentRecordRow[];
  truncated: boolean;
}
const round = (n: number) => Math.round(n * 100) / 100;

export async function listPaymentRecords(
  input: { after: string; before: string; maxPages?: number },
  deps?: JobberDeps
): Promise<ListPaymentsResult> {
  const query = `query McpPaymentRecords($first: Int!, $after: String, $filter: PaymentRecordFilterAttributes) {
    paymentRecords(first: $first, after: $after, filter: $filter) {
      nodes { id amount entryDate adjustmentType }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const records: PaymentRecordRow[] = [];
  let cursor: string | null = null;
  let truncated = false;
  const maxPages = Math.min(Math.max(input.maxPages ?? 20, 1), 40);
  for (let page = 0; page < maxPages; page++) {
    const res = await jobberGraphql(
      query,
      { first: 50, after: cursor, filter: { entryDate: { after: input.after, before: input.before } } },
      { token: deps?.token, fetchImpl: deps?.fetchImpl, env: deps?.env }
    );
    assertNoJobberErrors(res, 'list_payment_records');
    const conn: any = res.data?.paymentRecords;
    for (const n of conn?.nodes ?? []) {
      records.push({ id: n.id ?? null, amount: typeof n.amount === 'number' ? n.amount : null, entryDate: n.entryDate ?? null, adjustmentType: n.adjustmentType ?? null });
    }
    if (!conn?.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor ?? null;
    if (page === maxPages - 1) truncated = true;
  }
  let payments = 0, deposits = 0, refunds = 0;
  for (const r of records) {
    const a = r.amount ?? 0;
    const k = (r.adjustmentType || '').toUpperCase();
    if (k === 'PAYMENT') payments += a;
    else if (k === 'DEPOSIT') deposits += a;
    else if (k === 'REFUND' || k === 'FAILED_ACH_PAYMENT') refunds += Math.abs(a);
  }
  return { count: records.length, totals: { payments: round(payments), deposits: round(deposits), refunds: round(refunds), net: round(payments + deposits - refunds) }, records, truncated };
}
