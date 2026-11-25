import { writeRealmQuery, type QboWriteDeps } from './durable-write.ts';
import { parseSetLineTaxCodes } from './write-payloads.ts';

export type InvoiceRetaxCheck =
  | { ok: true; invoice: Record<string, unknown>; items: { lineId: string; itemId: string; taxable: boolean; taxClassificationId: string | null }[] }
  | { ok: false; error: string };

function rows(json: any, key: string): any[] {
  const list = json?.QueryResponse?.[key];
  return Array.isArray(list) ? list : [];
}

/**
 * Read the live invoice for qbo_invoice retaxLineIds (preview and confirm). Refuses when the SyncToken
 * is not the one passed, a listed line is missing, or a listed line's item is not Taxable in QuickBooks
 * (then re-deriving the class would leave it untaxed, so fix the item first).
 */
export async function checkInvoiceRetax(args: Record<string, unknown>, deps: QboWriteDeps = {}): Promise<InvoiceRetaxCheck> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const syncToken = typeof args.syncToken === 'string' ? args.syncToken.trim() : '';
  const lineIds = Array.isArray(args.retaxLineIds) ? args.retaxLineIds.map((v) => String(v).trim()) : [];
  if (!/^\d+$/.test(id)) return { ok: false, error: 'id must be a QuickBooks invoice id.' };
  if (!syncToken) return { ok: false, error: 'retaxLineIds needs syncToken: the SyncToken you read.' };
  if (!lineIds.length || lineIds.some((v) => !/^\d+$/.test(v))) return { ok: false, error: 'retaxLineIds must be QuickBooks line ids.' };
  const query = deps.qboQuery || ((sql: string) => writeRealmQuery(sql, deps));
  const invoice = rows(await query(`select * from Invoice where Id = '${id}'`), 'Invoice').find((row) => String(row?.Id) === id);
  if (!invoice) return { ok: false, error: `Invoice ${id} was not found in QuickBooks.` };
  if (String(invoice.SyncToken ?? '') !== syncToken) {
    return { ok: false, error: `Invoice ${id} has SyncToken ${String(invoice.SyncToken ?? 'none')} in QuickBooks, not ${syncToken}. Re-read it before changing it.` };
  }
  const lines = Array.isArray(invoice.Line) ? invoice.Line : [];
  const other = lines.filter((row: any) => row?.DetailType !== 'SalesItemLineDetail' && row?.DetailType !== 'SubTotalLineDetail');
  if (other.length) {
    return { ok: false, error: `Invoice ${id} has ${other.map((row: any) => row?.DetailType || 'unknown').join(', ')} lines. Retax resends only sales lines and would delete them.` };
  }
  const items: { lineId: string; itemId: string; taxable: boolean; taxClassificationId: string | null }[] = [];
  for (const lineId of lineIds) {
    const line = lines.find((row: any) => String(row?.Id) === lineId && row?.DetailType === 'SalesItemLineDetail');
    if (!line) return { ok: false, error: `Invoice ${id} has no sales line ${lineId}.` };
    const itemId = String(line.SalesItemLineDetail?.ItemRef?.value || '');
    if (!/^\d+$/.test(itemId)) return { ok: false, error: `Line ${lineId} has no item.` };
    const item = rows(await query(`select * from Item where Id = '${itemId}'`), 'Item').find((row) => String(row?.Id) === itemId);
    if (!item) return { ok: false, error: `Item ${itemId} on line ${lineId} was not found.` };
    const taxClassificationId = typeof item.TaxClassificationRef?.value === 'string' ? item.TaxClassificationRef.value : null;
    if (item.Taxable !== true) {
      return { ok: false, error: `Item ${itemId} on line ${lineId} is not Taxable in QuickBooks (class ${taxClassificationId || 'none'}). Fix the item's tax category first; a retax now would leave the line untaxed.` };
    }
    items.push({ lineId, itemId, taxable: true, taxClassificationId });
  }
  return { ok: true, invoice, items };
}

export type SetLineTaxCheck =
  | { ok: true; invoice: Record<string, unknown> }
  | { ok: false; error: string };

/** Read the live invoice for setLineTaxCodes. Preview and confirm both refuse a missing line or a stale SyncToken. */
export async function checkSetLineTax(args: Record<string, unknown>, deps: QboWriteDeps = {}): Promise<SetLineTaxCheck> {
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  const syncToken = typeof args.syncToken === 'string' ? args.syncToken.trim() : '';
  if (!/^\d+$/.test(id)) return { ok: false, error: 'id must be a QuickBooks invoice id.' };
  if (!syncToken) return { ok: false, error: 'setLineTaxCodes needs syncToken: the SyncToken you read.' };
  if (Array.isArray(args.retaxLineIds)) return { ok: false, error: 'setLineTaxCodes cannot be combined with retaxLineIds.' };
  let changes;
  try {
    changes = parseSetLineTaxCodes(args.setLineTaxCodes);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (args.expectedTotalTax === undefined || args.expectedTotalTax === null || args.expectedTotalTax === '') {
    return { ok: false, error: 'setLineTaxCodes requires expectedTotalTax. 0 is allowed.' };
  }
  const query = deps.qboQuery || ((sql: string) => writeRealmQuery(sql, deps));
  const invoice = rows(await query(`select * from Invoice where Id = '${id}'`), 'Invoice').find((row) => String(row?.Id) === id);
  if (!invoice) return { ok: false, error: `Invoice ${id} was not found in QuickBooks.` };
  if (String(invoice.SyncToken ?? '') !== syncToken) {
    return { ok: false, error: `Invoice ${id} has SyncToken ${String(invoice.SyncToken ?? 'none')} in QuickBooks, not ${syncToken}. Re-read it before changing it.` };
  }
  const lines = Array.isArray(invoice.Line) ? invoice.Line : [];
  for (const change of changes) {
    const line = lines.find((row: any) => String(row?.Id ?? '') === change.lineId);
    if (!line) return { ok: false, error: `Invoice ${id} has no line ${change.lineId}.` };
    if (line.DetailType !== 'SalesItemLineDetail') return { ok: false, error: `Invoice ${id} line ${change.lineId} is not a sales line.` };
  }
  const taxCode = invoice.TxnTaxDetail?.TxnTaxCodeRef?.value;
  if (taxCode == null || String(taxCode).trim() === '') return { ok: false, error: `Invoice ${id} has no TxnTaxCodeRef to keep.` };
  return { ok: true, invoice };
}
