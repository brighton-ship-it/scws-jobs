/**
 * Replace one 4010 Sales line on a deposit with a ReceivePayment of the same
 * amount applied to an invoice, then link that payment on the deposit.
 * The deposit total does not change. Income stays on the invoice instead of
 * being recorded twice. Both writes share batchId so qbo_revert_batch can undo them:
 * it restores the deposit first, then deletes the payment.
 */
import { readWriteRealm, runQboPlan, type QboWriteDeps } from './durable-write.ts';
import { withQboBackoff } from './qbo-backoff.ts';
import { describeQboWriteGate } from './write-gate.ts';
import { buildPayment, findDepositSalesLine, parseBatchId, type QboPlan } from './write-payloads.ts';

function slug(value: string): string {
  const raw = value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 50);
  return raw.length >= 8 ? raw : `${raw}00000000`.slice(0, 8);
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
  const paymentResult = await runQboPlan(paymentPlan, {
    confirm: true,
    batchId,
    requestId: slug(`relpay-${batchId}-${depositId}`),
  }, deps);
  if (!paymentResult.wrote || !paymentResult.ids.id) {
    return { ...preview, ok: false, dryRun: false, wrote: false, error: paymentResult.error || 'Payment was not created. The deposit was not changed.', paymentResult };
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
    requestId: slug(`reldep-${batchId}-${depositId}`),
  }, deps);
  const wrote = Boolean(depositResult.wrote);
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
