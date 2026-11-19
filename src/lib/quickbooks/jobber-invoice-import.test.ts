import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJobberSyncedInvoice,
  classifyJobberInvoice,
  pacificDate,
  runJobberInvoiceImport,
  type JobberInvoiceForQbo,
} from './jobber-invoice-import.ts';

const invoice: JobberInvoiceForQbo = {
  invoiceNumber: '5824',
  issuedDate: '2026-09-30T22:48:04Z',
  dueDate: '2026-09-30T07:00:00Z',
  message: 'On-site, everything is functioning well.',
  clientName: 'Colleen Baker',
  lines: [
    { name: '1MS', description: '1 Man service', quantity: 1, unitPrice: 200, taxable: false },
    { name: 'MISC', description: '161-110v Start Capacitor', quantity: 1, unitPrice: 38, taxable: true },
  ],
  total: 240.95,
  taxAmount: 2.95,
  paymentsTotal: 240.95,
};

test('synced invoice body matches the old Jobber sync shape', () => {
  assert.equal(pacificDate('2026-10-20T01:51:32Z'), '2026-10-19');
  const built = buildJobberSyncedInvoice(invoice, '15285', { '1MS': '23', MISC: '5' }, '3');
  const body = built.body || {};
  assert.equal(body.DocNumber, '5824');
  assert.equal((body.CustomerRef as { value: string }).value, '15285');
  assert.equal(body.TxnDate, '2026-09-30');
  assert.equal('EmailStatus' in body, false);
  const lines = body.Line as Array<{ SalesItemLineDetail: { ItemRef: { value: string }; TaxCodeRef: { value: string } } }>;
  assert.equal(lines[0].SalesItemLineDetail.ItemRef.value, '23');
  assert.equal(lines[0].SalesItemLineDetail.TaxCodeRef.value, 'NON');
  assert.equal(lines[1].SalesItemLineDetail.TaxCodeRef.value, 'TAX');
  assert.equal((body.TxnTaxDetail as { TxnTaxCodeRef: { value: string } }).TxnTaxCodeRef.value, '3');
});

test('import skips an existing DocNumber and blocks a missing customer', () => {
  const skip = classifyJobberInvoice(invoice, new Set(['5824']), '15285', { '1MS': '23', MISC: '5' }, '3');
  assert.equal(skip.status, 'skip');
  const blocked = classifyJobberInvoice(invoice, new Set(), null, { '1MS': '23', MISC: '5' }, '3');
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.reason || '', /Colleen Baker/);
});

test('preview does not post, and confirm is idempotent by DocNumber and request id', async () => {
  const posted: string[] = [];
  const env = {
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '2222222222222222',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  };
  const qboQuery = async (sql: string) => {
    if (sql.includes('DocNumber')) return { QueryResponse: {} };
    if (sql.includes('Customer')) return { QueryResponse: { Customer: [{ Id: '15285', DisplayName: 'Colleen Baker' }] } };
    if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23', Name: '1MS' }] } };
    if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5', Name: 'MISC' }] } };
    return { QueryResponse: { TaxCode: [{ Id: '3', Name: 'CA-San Diego-San Diego' }] } };
  };
  const preview = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], batchId: 'oct-2026' },
    { env, qboQuery, loadJobberInvoices: async () => [invoice], fetchImpl: async () => { throw new Error('preview posted'); } }
  );
  assert.equal(preview.dryRun, true);
  assert.equal(preview.create, 1);
  assert.equal(preview.invoiceTotal, 240.95);
  assert.equal((preview.invoices as Array<{ body: { DocNumber: string } }>)[0].body.DocNumber, '5824');

  let existing = false;
  const confirm = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], batchId: 'oct-2026', confirm: true, payments: 'undeposited' },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
      loadJobberInvoices: async () => [invoice],
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return existing ? { QueryResponse: { Invoice: [{ Id: '99', DocNumber: '5824' }] } } : { QueryResponse: {} };
        if (sql.includes('Customer')) return { QueryResponse: { Customer: [{ Id: '15285' }] } };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
        return { QueryResponse: { TaxCode: [{ Id: '3' }] } };
      },
      fetchImpl: async (url, init) => {
        posted.push(String(url));
        const path = String(url);
        const entity = path.includes('/payment') ? 'Payment' : 'Invoice';
        if (entity === 'Invoice') existing = true;
        const body = JSON.parse(String(init?.body));
        assert.equal('EmailStatus' in body, false);
        return new Response(JSON.stringify({ [entity]: { Id: entity === 'Invoice' ? '99' : '50', SyncToken: '0', DocNumber: '5824' } }), { status: 200 });
      },
    }
  );
  assert.equal(confirm.wrote, true);
  const again = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], batchId: 'oct-2026', confirm: true, payments: 'undeposited' },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
      loadJobberInvoices: async () => [invoice],
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: { Invoice: [{ Id: '99', DocNumber: '5824' }] } };
        return { QueryResponse: {} };
      },
      fetchImpl: async () => {
        posted.push('again');
        return new Response('{}', { status: 500 });
      },
    }
  );
  assert.equal(again.create, 0);
  assert.equal(again.skip, 1);
  assert.equal(posted.includes('again'), false);
  assert.equal(posted.length, 2);
  assert.equal(posted[0].includes('requestid='), true);
  assert.match(posted[0], /requestid=inv-oct-2026-5824/);
  assert.match(posted[1], /requestid=pay-oct-2026-5824/);
});
