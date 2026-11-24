/**
 * Replace one 4010 Sales line on a deposit with a ReceivePayment of the same
 * amount applied to an invoice, then link that payment on the deposit.
 * The deposit total does not change. Income stays on the invoice instead of
 * being recorded twice. Both writes share batchId so qbo_revert_batch can undo them:
 * it restores the deposit first, then deletes the payment.
 */
import { createHash } from 'node:crypto';
import { readWriteRealm, runQboPlan, type QboWriteDeps } from './durable-write.ts';
import { withQboBackoff } from './qbo-backoff.ts';
import { describeQboWriteGate } from './write-gate.ts';
import { buildPayment, findDepositSalesLine, parseBatchId, type QboPlan } from './write-payloads.ts';

function slug(value: string): string {
  const raw = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
  return raw.length >= 8 ? raw : `${raw}00000000`.slice(0, 8);
}

function cents(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}

export type RelinkKeyParts = {
  batchId: string | null;
  depositId: string;
  lineId: string | null;
  salesAccountId: string | null;
  invoiceId: string;
  customerId: string;
  amountCents: number;
  requestId?: string | null;
};

/**
 * Intuit requestid for one relink step. Each relink on the same deposit must get
 * its own key, or Intuit replays the first relink's response. The key covers the
 * batch, deposit, line, invoice, customer and amount. A caller requestId is mixed
 * in too, so it changes the key instead of being ignored.
 */
export function relinkRequestId(step: 'relpay' | 'reldep', parts: RelinkKeyParts): string {
  const canonical = JSON.stringify([
    step,
    parts.batchId || '',
    parts.depositId,
    parts.lineId || '',
    parts.salesAccountId || '',
    parts.invoiceId,
    parts.customerId,
    parts.amountCents,
    parts.requestId || '',
  ]);
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  const line = parts.lineId ? `L${parts.lineId}` : 'Lacct';
  const readable = slug(`${step}-${parts.depositId}-${line}`).slice(0, 33);
  return `${readable}-${hash}`;
}

function linksPayment(line: Record<string, unknown>, paymentId: string): boolean {
  const linked = line.LinkedTxn as Array<{ TxnId?: string; TxnType?: string }> | undefined;
  return (linked || []).some((item) => String(item.TxnId) === paymentId && item.TxnType === 'Payment');
}

export async function runRelinkDeposit(args: Record<string, unknown>, deps: QboWriteDeps = {}): Promise<Record<string, unknown>> {
  const confirm = args.confirm === true || (typeof args.confirm === 'string' && args.confirm.trim().toLowerCase() === 'true');
  const batchId = parseBatchId(args.batchId, confirm);
  const paymentPlan = {
    ...buildPayment({
      customerId: args.customerId,
      totalAmt: args.amount,
      txnDate: args.txnDate,
      paymentRefNum: args.paymentRefNum,
      privateNote: args.privateNote || (args.depositId ? `Replaces a sales line on deposit ${args.depositId}` : undefined),
      applications: [{ invoiceId: args.invoiceId, amount: args.amount }],
    }),
    tool: 'qbo_relink_deposit' as const,
  };
  const depositId = typeof args.depositId === 'string' ? args.depositId.trim() : '';
  if (!/^\d{1,20}$/.test(depositId)) throw new Error('depositId must be a QuickBooks id');
  const lineId = typeof args.lineId === 'string' && args.lineId.trim() ? args.lineId.trim() : null;
  const salesAccountId = typeof args.salesAccountId === 'string' && args.salesAccountId.trim() ? args.salesAccountId.trim() : null;
  const amount = Number(args.amount);
  const keyParts: RelinkKeyParts = {
    batchId,
    depositId,
    lineId,
    salesAccountId,
    invoiceId: String(args.invoiceId ?? '').trim(),
    customerId: String(args.customerId ?? '').trim(),
    amountCents: cents(args.amount),
    requestId: typeof args.requestId === 'string' ? args.requestId.trim() : null,
  };
  const preview = {
    ok: true,
    dryRun: true,
    wrote: false,
    refused: false,
    tool: 'qbo_relink_deposit',
    batchId,
    payment: paymentPlan.body,
    deposit: {
      depositId,
      remove: { lineId, amount, salesAccountId },
      addPaymentAmount: amount,
      totalUnchanged: true,
    },
    requestIds: { payment: relinkRequestId('relpay', keyParts), deposit: relinkRequestId('reldep', keyParts) },
    note: 'The deposit total stays the same. The sales line comes off so the invoice is the only income, and the deposit links the new payment.',
  };
  if (!confirm) return preview;
  const gate = describeQboWriteGate(deps.env || process.env);
  if (!gate.enabled) {
    return { ...preview, ok: false, refused: true, error: gate.blockedReason };
  }
  const loaded = await withQboBackoff(() => readWriteRealm(`/deposit/${depositId}`, deps), { sleep: deps.sleep });
  const deposit = ((loaded as { Deposit?: Record<string, unknown> })?.Deposit || loaded) as Record<string, unknown>;
  findDepositSalesLine(deposit, { lineId, amount, salesAccountId });
  const priorSyncToken = Number(deposit.SyncToken);
  const paymentResult = await runQboPlan(paymentPlan, {
    confirm: true,
    batchId,
    requestId: relinkRequestId('relpay', keyParts),
  }, deps);
  if (!paymentResult.wrote || !paymentResult.ids.id) {
    return { ...preview, ok: false, dryRun: false, wrote: false, error: paymentResult.error || 'Payment was not created. The deposit was not changed.', paymentResult };
  }
  // Replay check: Intuit returns the cached response when a requestid repeats, so the
  // returned payment must be the one requested before the deposit is touched.
  const created = (paymentResult.qbo || {}) as {
    TotalAmt?: unknown;
    CustomerRef?: { value?: unknown };
    Line?: Array<{ LinkedTxn?: Array<{ TxnId?: unknown; TxnType?: string }> }>;
  };
  const createdProblems: string[] = [];
  if (cents(created.TotalAmt) !== keyParts.amountCents) createdProblems.push(`amount ${String(created.TotalAmt)} instead of ${args.amount}`);
  if (String(created.CustomerRef?.value ?? '') !== keyParts.customerId) createdProblems.push(`customer ${String(created.CustomerRef?.value ?? 'missing')} instead of ${keyParts.customerId}`);
  if (Array.isArray(created.Line)) {
    const appliesInvoice = created.Line.some((line) => (line.LinkedTxn || []).some((item) => String(item.TxnId) === keyParts.invoiceId && item.TxnType === 'Invoice'));
    if (!appliesInvoice) createdProblems.push(`it is not applied to invoice ${keyParts.invoiceId}`);
  }
  if (createdProblems.length) {
    throw new Error(
      `QuickBooks returned payment ${paymentResult.ids.id}, but it does not match the request (${createdProblems.join('; ')}). ` +
        'This looks like a replayed response. The deposit was not changed. Check that payment before reverting this batch.'
    );
  }
  const update: QboPlan = {
    tool: 'qbo_relink_deposit',
    entity: 'Deposit',
    action: 'update',
    path: '/deposit',
    body: { Id: depositId },
    read: { path: `/deposit/${depositId}`, apply: 'relinkSalesLine' },
    changes: { lineId, amount, salesAccountId, paymentId: paymentResult.ids.id },
    reason: `relink deposit ${depositId}`,
  };
  const depositResult = await runQboPlan(update, {
    confirm: true,
    batchId,
    requestId: relinkRequestId('reldep', keyParts),
  }, deps);
  const wrote = Boolean(depositResult.wrote);
  if (wrote) {
    // The deposit must really have changed: a replayed response carries an old SyncToken
    // and does not link the new payment.
    const saved = (depositResult.qbo || {}) as { SyncToken?: unknown; Line?: Array<Record<string, unknown>> };
    const savedToken = Number(saved.SyncToken ?? depositResult.ids.syncToken);
    const problems: string[] = [];
    if (!Number.isFinite(savedToken) || !Number.isFinite(priorSyncToken) || savedToken <= priorSyncToken) {
      problems.push(`SyncToken ${String(saved.SyncToken ?? depositResult.ids.syncToken)} did not go up from ${String(deposit.SyncToken)}`);
    }
    if (!Array.isArray(saved.Line) || !saved.Line.some((line) => linksPayment(line, String(paymentResult.ids.id)))) {
      problems.push(`the saved deposit does not link payment ${paymentResult.ids.id}`);
    }
    if (problems.length) {
      throw new Error(
        `Deposit ${depositId} was not confirmed as updated (${problems.join('; ')}). ` +
          `Payment ${paymentResult.ids.id} may be sitting in Undeposited Funds. Read the deposit back before any retry or revert.`
      );
    }
  }
  return {
    ...preview,
    ok: wrote,
    dryRun: false,
    wrote,
    paymentId: paymentResult.ids.id,
    depositId: depositResult.ids.id || depositId,
    error: wrote ? undefined : depositResult.error || 'Deposit was not updated. Revert this batch to delete the payment.',
  };
}
