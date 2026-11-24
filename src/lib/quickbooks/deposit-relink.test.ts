import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRelinkDeposit } from './deposit-relink.ts';

const env = {
  QBO_WRITES_ENABLED: 'true',
  QBO_WRITE_REALM_ID: '2222222222222222',
  QBO_PRODUCTION_REALM_ID: '9130349321543166',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const deposit = {
  Deposit: {
    Id: '9',
    SyncToken: '2',
    Line: [{ Id: '1', Amount: 100, DepositLineDetail: { AccountRef: { value: '35', name: '4010 Sales' } } }],
  },
};

test('relink preview does not call QuickBooks', async () => {
  const result = await runRelinkDeposit(
    { depositId: '9', amount: 100, salesAccountId: '35', invoiceId: '99', customerId: '15', txnDate: '2026-10-02', batchId: 'oct-2026' },
    { fetchImpl: async () => { throw new Error('preview posted'); } }
  );
  assert.equal(result.dryRun, true);
  assert.equal(result.wrote, false);
  assert.equal((result.payment as { TotalAmt: number }).TotalAmt, 100);
  assert.equal((result.deposit as { totalUnchanged: boolean }).totalUnchanged, true);
});

test('relink confirm creates the payment and replaces the sales line without changing the total', async () => {
  const posted: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const result = await runRelinkDeposit(
    {
      confirm: true,
      batchId: 'oct-2026',
      depositId: '9',
      amount: 100,
      salesAccountId: '35',
      invoiceId: '99',
      customerId: '15',
      txnDate: '2026-10-02',
    },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
        posted.push({ url: String(url), body });
        if (!init?.body) return json(deposit);
        if (String(url).includes('/payment')) return json({ Payment: { Id: '50', SyncToken: '0' } });
        return json({ Deposit: { Id: '9', SyncToken: '3' } });
      },
    }
  );
  assert.equal(result.wrote, true);
  assert.equal(result.paymentId, '50');
  const update = posted.find((call) => call.body && String(call.url).includes('/deposit') && !String(call.url).includes('/deposit/'));
  const lines = update?.body?.Line as Array<{ Amount: number; LinkedTxn?: Array<{ TxnId: string }>; DepositLineDetail?: unknown }>;
  assert.equal(lines.length, 1);
  assert.equal(lines[0].Amount, 100);
  assert.equal(lines[0].LinkedTxn?.[0].TxnId, '50');
  assert.equal(lines[0].DepositLineDetail, undefined);
  assert.equal(posted.some((call) => call.url.includes('/payment')), true);
});
