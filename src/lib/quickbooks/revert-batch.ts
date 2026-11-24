/**
 * Undo one audited QuickBooks batch in reverse order.
 * Deletes only entities this gateway created. Restores updates from the
 * audited prior entity. Skips closed-period transactions and voids.
 * Pending, refused, preview, and failed rows are not writes. A pending row
 * is covered when the same request later recorded ok or failed. An unresolved
 * pending row is reported, because the batch id alone does not identify a
 * QuickBooks entity to undo. An unknown row (the POST was sent, no answer came
 * back) may have posted: it is reported in couldNot unless the same request
 * later recorded ok, and it is never treated as failed.
 */
import { readBookCloseDate, runQboPlan, type QboAuditStatus, type QboWriteDeps } from './durable-write.ts';
import { parseBatchId, type QboPlan } from './write-payloads.ts';

export type BatchAuditRow = {
  id: number;
  tool: string;
  entity: string;
  action: string | null;
  created: boolean;
  ok: boolean;
  dryRun: boolean;
  confirmed: boolean;
  qboId: string | null;
  syncToken: string | null;
  priorState: Record<string, unknown> | null;
  txnDate: string | null;
  status: QboAuditStatus | null;
  requestId: string | null;
  error: string | null;
};

export type RevertStep = {
  phase: 'restore' | 'delete-payment' | 'delete';
  auditId: number;
  entity: string;
  qboId: string;
  txnDate: string | null;
  action: 'restore' | 'delete';
};

const PAYMENT_ENTITIES = new Set(['Payment', 'BillPayment']);
const NOT_A_WRITE = new Set<QboAuditStatus>(['pending', 'refused', 'preview', 'failed', 'tax_mismatch', 'unknown']);

export function closedPeriod(txnDate: string | null, closeDate: string | null): boolean {
  if (!closeDate || !txnDate) return false;
  return txnDate <= closeDate;
}

/** A row that recorded a QuickBooks change revert can undo. Legacy rows have no status and use ok. */
function isRevertTarget(row: BatchAuditRow): boolean {
  if (row.dryRun || !row.confirmed) return false;
  if (row.tool === 'qbo_revert_batch') return false;
  if (row.status && NOT_A_WRITE.has(row.status)) return false;
  if (row.status === 'ok') return true;
  return row.ok === true;
}

/** The pre-write row is settled once the same request stored an outcome. */
function settlesRequest(row: BatchAuditRow): boolean {
  if (!row.requestId) return false;
  if (row.status === 'ok' || row.status === 'failed') return true;
  if (row.status != null) return false;
  return row.ok || Boolean(row.error);
}

export type DuplicateRow = { auditId: number; entity: string; qboId: string; sameAsAuditId: number; reason: string };

export function planBatchRevert(
  rows: BatchAuditRow[],
  closeDate: string | null
): { steps: RevertStep[]; couldNot: { entity: string; id: string | null; reason: string }[]; duplicates: DuplicateRow[] } {
  const steps: RevertStep[] = [];
  const duplicates: DuplicateRow[] = [];
  // A replayed Intuit requestid returns an entity an earlier row already created, so two
  // ok rows can name the same QuickBooks id. Delete it once, from the earliest row.
  const firstCreate = new Map<string, number>();
  const couldNot: { entity: string; id: string | null; reason: string }[] = [];
  const settled = new Set(rows.filter(settlesRequest).map((row) => row.requestId as string));
  const okRequests = new Set(rows.filter((row) => row.status === 'ok' && row.requestId).map((row) => row.requestId as string));
  const unknownRequests = new Set(rows.filter((row) => row.status === 'unknown' && row.requestId).map((row) => row.requestId as string));
  for (const row of rows) {
    if (row.status === 'unknown') {
      if (row.dryRun || !row.confirmed) continue;
      // A later ok row for the same Intuit requestid is the real outcome, and revert uses that row.
      if (row.requestId && okRequests.has(row.requestId)) continue;
      couldNot.push({
        entity: row.entity,
        id: row.qboId,
        reason: 'post outcome unknown (network error or timeout); it may have posted. Read QuickBooks for this entity before reverting',
      });
      continue;
    }
    // The pending row of an unknown post is reported once, through its unknown row.
    if (row.status === 'pending' && row.requestId && unknownRequests.has(row.requestId) && !settled.has(row.requestId)) continue;
    if (row.status === 'pending') {
      if (row.dryRun || !row.confirmed) continue;
      const coveredByRequest = Boolean(row.requestId && settled.has(row.requestId));
      const coveredByEntity = Boolean(
        row.qboId &&
          rows.some((other) => other.id !== row.id && isRevertTarget(other) && other.entity === row.entity && other.qboId === row.qboId)
      );
      if (coveredByRequest || coveredByEntity) continue;
      if (!row.qboId) {
        couldNot.push({
          entity: row.entity,
          id: null,
          reason: 'pending audit row has no recorded QuickBooks id, so this batch cannot revert that write',
        });
        continue;
      }
    } else if (!isRevertTarget(row)) continue;
    if (!row.qboId) {
      couldNot.push({ entity: row.entity, id: null, reason: 'audit row has no QuickBooks id' });
      continue;
    }
    if (row.action === 'void') {
      couldNot.push({ entity: row.entity, id: row.qboId, reason: 'a void cannot be undone' });
      continue;
    }
    if (closedPeriod(row.txnDate, closeDate) || (closeDate && !row.txnDate)) {
      couldNot.push({
        entity: row.entity,
        id: row.qboId,
        reason: row.txnDate ? `TxnDate ${row.txnDate} is on or before the books close date ${closeDate}` : `books are closed through ${closeDate} and this row has no TxnDate`,
      });
      continue;
    }
    if (row.created || row.action === 'create' || row.action === 'attach') {
      const key = `${row.entity}:${row.qboId}`;
      const earlier = firstCreate.get(key);
      if (earlier !== undefined) {
        duplicates.push({
          auditId: row.id,
          entity: row.entity,
          qboId: row.qboId,
          sameAsAuditId: earlier,
          reason: `audit row ${earlier} already created ${row.entity} ${row.qboId}; this row is a replayed response and is not deleted again`,
        });
        continue;
      }
      firstCreate.set(key, row.id);
      steps.push({
        phase: PAYMENT_ENTITIES.has(row.entity) ? 'delete-payment' : 'delete',
        auditId: row.id,
        entity: row.entity,
        qboId: row.qboId,
        txnDate: row.txnDate,
        action: 'delete',
      });
      continue;
    }
    if (row.priorState && row.action === 'update') {
      steps.push({
        phase: 'restore',
        auditId: row.id,
        entity: row.entity,
        qboId: row.qboId,
        txnDate: row.txnDate,
        action: 'restore',
      });
      continue;
    }
    couldNot.push({ entity: row.entity, id: row.qboId, reason: 'not created by these tools and no prior state was audited' });
  }
  const phaseOrder = { restore: 0, 'delete-payment': 1, delete: 2 };
  steps.sort((a, b) => phaseOrder[a.phase] - phaseOrder[b.phase] || b.auditId - a.auditId);
  return { steps, couldNot, duplicates };
}

function entityPath(entity: string): string {
  const paths: Record<string, string> = {
    Invoice: 'invoice',
    Payment: 'payment',
    JournalEntry: 'journalentry',
    Purchase: 'purchase',
    Bill: 'bill',
    BillPayment: 'billpayment',
    Deposit: 'deposit',
    Attachable: 'attachable',
    Preferences: 'preferences',
    Customer: 'customer',
    Item: 'item',
  };
  const path = paths[entity];
  if (!path) throw new Error(`Cannot revert QuickBooks entity ${entity}.`);
  return path;
}

export async function runBatchRevert(
  args: Record<string, unknown>,
  deps: QboWriteDeps = {}
): Promise<Record<string, unknown>> {
  const batchId = parseBatchId(args.batchId, true);
  const confirm = args.confirm === true || (typeof args.confirm === 'string' && args.confirm.trim().toLowerCase() === 'true');
  const rows = deps.loadBatch ? await deps.loadBatch(batchId!) : await loadBatchFromSupabase(deps, batchId!);
  let closeDate: string | null = null;
  let closeError: string | null = null;
  if (confirm) {
    try {
      closeDate = deps.readCloseDate ? await deps.readCloseDate() : await readBookCloseDate(deps);
    } catch (error) {
      closeError = error instanceof Error ? error.message : String(error);
    }
  }
  const plan = planBatchRevert(rows, closeDate);
  if (!confirm) {
    return {
      ok: true,
      dryRun: true,
      wrote: false,
      batchId,
      closeDate,
      steps: plan.steps,
      couldNot: plan.couldNot,
      duplicates: plan.duplicates,
      note: 'Preview only. confirm:true restores updates first, then deletes payments created by the batch, then deletes the other created entities. Closed-period rows are refused.',
    };
  }
  if (closeError) {
    return { ok: false, dryRun: true, wrote: false, refused: true, batchId, error: closeError, couldNot: plan.couldNot };
  }
  const results: Record<string, unknown>[] = [];
  const couldNot = [...plan.couldNot];
  for (const step of plan.steps) {
    const row = rows.find((item) => item.id === step.auditId);
    const path = `/${entityPath(step.entity)}`;
    const qboPlan: QboPlan = {
      tool: 'qbo_revert_batch',
      entity: step.entity,
      action: step.action === 'delete' ? 'delete' : 'update',
      path,
      operation: step.action === 'delete' ? 'delete' : undefined,
      body: step.action === 'delete' ? { Id: step.qboId, sparse: true } : stripMeta(row?.priorState || {}),
      read: { path: step.action === 'delete' ? `${path}/${step.qboId}` : `${path}/${step.qboId}`, apply: 'syncToken' },
      reason: `revert ${batchId}`,
    };
    if (step.entity === 'Preferences') qboPlan.read = { path: '/preferences', apply: 'syncToken' };
    // A full invoice restore can be re-coded by Automated Sales Tax; flag it if the saved code differs.
    const priorCode = step.entity === 'Invoice' && step.action !== 'delete' ? (row?.priorState as any)?.TxnTaxDetail?.TxnTaxCodeRef?.value : null;
    if (typeof priorCode === 'string' && priorCode) qboPlan.expectTaxCode = priorCode;
    const result = await runQboPlan(qboPlan, { confirm: true, batchId, requestId: `revert-${batchId}-${step.auditId}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50) }, deps);
    if (!result.wrote) {
      const missing = /failed \(404\)/.test(result.error || '');
      if (missing && step.action === 'delete') {
        results.push({ ...step, status: 'already-gone' });
        continue;
      }
      couldNot.push({ entity: step.entity, id: step.qboId, reason: result.error || 'revert post failed' });
      results.push({ ...step, status: 'failed', error: result.error });
      continue;
    }
    results.push({ ...step, status: 'reverted', ids: result.ids, ...(qboPlan.expectTaxCode ? { taxCodeChanged: result.taxCodeChanged ?? null } : {}) });
  }
  return {
    ok: couldNot.length === 0,
    dryRun: false,
    wrote: results.some((item) => item.status === 'reverted'),
    batchId,
    closeDate,
    results,
    couldNot,
    duplicates: plan.duplicates,
  };
}

function stripMeta(entity: Record<string, unknown>): Record<string, unknown> {
  const body = { ...entity };
  delete body.MetaData;
  return body;
}

async function loadBatchFromSupabase(deps: QboWriteDeps, batchId: string): Promise<BatchAuditRow[]> {
  const env = deps.env || process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Cannot load the batch audit. Set SUPABASE_SERVICE_KEY and apply supabase/migrations/20261119_qbo_write_audit_batch.sql.');
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.from('qbo_write_audit').select('*').eq('batch_id', batchId).order('id', { ascending: true });
  if (error) throw new Error(`qbo_write_audit read failed: ${error.message}`);
  return (data || []).map(rowFromDb);
}

function rowFromDb(row: Record<string, unknown>): BatchAuditRow {
  const ids = (row.qbo_ids || {}) as { id?: string; syncToken?: string };
  return {
    id: Number(row.id),
    tool: String(row.tool || ''),
    entity: String(row.entity || ''),
    action: row.action == null ? null : String(row.action),
    created: row.created === true,
    ok: row.ok === true,
    dryRun: row.dry_run === true,
    confirmed: row.confirmed === true,
    qboId: ids.id || null,
    syncToken: (row.sync_token as string) || ids.syncToken || null,
    priorState: (row.prior_state as Record<string, unknown>) || null,
    txnDate: (row.txn_date as string) || null,
    status: auditStatus(row.status),
    requestId: row.request_id == null ? null : String(row.request_id),
    error: row.error == null ? null : String(row.error),
  };
}

function auditStatus(value: unknown): QboAuditStatus | null {
  if (value === 'preview' || value === 'pending' || value === 'refused' || value === 'ok' || value === 'failed' || value === 'tax_mismatch' || value === 'unknown') return value;
  return null;
}
