import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSavedTax,
  buildJobberSyncedInvoice,
  classifyJobberInvoice,
  countyPercentRateId,
  jobberPaymentLines,
  missingJobsiteAddressReason,
  pacificDate,
  qboShipAddress,
  resolveJobProperties,
  runJobberInvoiceImport,
  sliceInvoiceChunk,
  type InvoiceTaxReport,
  type JobberInvoiceForQbo,
  type QboTaxRate,
} from './jobber-invoice-import.ts';
import { taxCodeIdForCity } from './tax-codes.ts';
import { privateNoteWithBatch } from './write-payloads.ts';

const TAX_RATES: QboTaxRate[] = [
  { id: '4', name: 'San Diego County', rate: 1 },
  { id: '25', name: 'Riverside County', rate: 1 },
  { id: '5', name: 'San Diego County District', rate: 0.5 },
  { id: '3', name: 'California State', rate: 6.25 },
];

const TAX_RATE_ROWS = TAX_RATES.map((rate) => ({ Id: rate.id, Name: rate.name, RateValue: rate.rate }));

function taxDetail(totalTax: number, countyRateId: string) {
  return {
    TotalTax: totalTax,
    TxnTaxCodeRef: { value: '3' },
    TaxLine: [
      { Amount: 1, DetailType: 'TaxLineDetail', TaxLineDetail: { TaxRateRef: { value: countyRateId }, TaxPercent: 1, NetAmountTaxable: 100 } },
    ],
  };
}

const invoice: JobberInvoiceForQbo = {
  invoiceNumber: '5824',
  issuedDate: '2026-09-30T22:48:04Z',
  dueDate: '2026-09-30T07:00:00Z',
  message: 'On-site, everything is functioning well.',
  clientName: 'Colleen Baker',
  city: 'Ramona',
  address: {
    line1: '420 Pile Street',
    line2: null,
    city: 'Ramona',
    province: 'CA',
    postalCode: '92065',
    country: 'United States',
  },
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

test('tax codes resolve by id from the jobsite, and a chunk returns a cursor', () => {
  assert.equal(taxCodeIdForCity('Ramona'), '3');
  assert.equal(taxCodeIdForCity('Menifee'), '30');
  assert.equal(taxCodeIdForCity('Sun City'), '30');
  assert.equal(taxCodeIdForCity('Hemet'), '65');
  assert.equal(taxCodeIdForCity('Murrieta'), '65');
  assert.equal(taxCodeIdForCity('Temecula'), '65');
  assert.equal(taxCodeIdForCity('Hemet', { Hemet: '99' }), '99');
  assert.equal(taxCodeIdForCity('Portland'), null);
  const numbers = Array.from({ length: 20 }, (_, i) => String(5826 + i));
  const first = sliceInvoiceChunk(numbers, undefined, 8);
  assert.deepEqual(first.chunk, numbers.slice(0, 8));
  assert.equal(first.nextCursor, '5834');
  const second = sliceInvoiceChunk(numbers, first.nextCursor, 8);
  assert.equal(second.chunk[0], '5834');
  assert.equal(second.nextCursor, '5842');
});

test('an unknown city blocks only that invoice', async () => {
  const known = { ...invoice, invoiceNumber: '5826', city: 'Ramona' };
  const unknown = { ...invoice, invoiceNumber: '5827', city: 'Portland', clientName: 'Ada Example' };
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['5826', '5827'], limit: 8 },
    {
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('DisplayName')) {
          return { QueryResponse: { Customer: [{ Id: sql.includes('Ada') ? '2' : '1' }] } };
        }
        if (sql.includes('CustomerRef')) return { QueryResponse: {} };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23', Name: '1MS' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5', Name: 'MISC' }] } };
        if (sql.includes('TaxCode')) return { QueryResponse: {} };
        return { QueryResponse: {} };
      },
      loadJobberInvoices: async () => [known, unknown],
      fetchImpl: async () => {
        throw new Error('preview posted');
      },
    }
  );
  const rows = result.invoices as Array<{ invoiceNumber: string; status: string; reason: string | null; body: { TxnTaxDetail?: { TxnTaxCodeRef: { value: string } } } | null }>;
  const ramona = rows.find((row) => row.invoiceNumber === '5826');
  const hemet = rows.find((row) => row.invoiceNumber === '5827');
  assert.equal(ramona?.status, 'create');
  assert.equal(ramona?.body?.TxnTaxDetail?.TxnTaxCodeRef.value, '3');
  assert.equal(hemet?.status, 'blocked');
  assert.match(hemet?.reason || '', /Portland/);
  assert.equal(result.nextCursor, null);
  assert.equal(result.ok, true);
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
        if (sql.includes('TaxRate')) return { QueryResponse: { TaxRate: TAX_RATE_ROWS } };
        return { QueryResponse: { TaxCode: [{ Id: '3' }] } };
      },
      fetchImpl: async (url, init) => {
        posted.push(String(url));
        const path = String(url);
        const entity = path.includes('/payment') ? 'Payment' : 'Invoice';
        if (entity === 'Invoice') existing = true;
        const body = JSON.parse(String(init?.body));
        assert.equal('EmailStatus' in body, false);
        const row = entity === 'Invoice'
          ? { Id: '99', SyncToken: '0', DocNumber: '5824', TxnTaxDetail: taxDetail(2.95, '4') }
          : { Id: '50', SyncToken: '0', DocNumber: '5824' };
        return new Response(JSON.stringify({ [entity]: row }), { status: 200 });
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

test('a Jobber discount stays on the invoice and a long memo is measured', () => {
  const discounted: JobberInvoiceForQbo = {
    ...invoice,
    invoiceNumber: '5834',
    message: 'x'.repeat(1001),
    lines: [{ name: '1MS', description: 'Service', quantity: 1, unitPrice: 2000, taxable: false }],
    discountAmount: 275,
    total: 1725,
    taxAmount: 0,
    paymentsTotal: 0,
  };
  const built = buildJobberSyncedInvoice(discounted, '15', { '1MS': '23' }, '3');
  const lines = (built.body?.Line || []) as Array<{ Amount: number; Description?: string; SalesItemLineDetail: { TaxCodeRef: { value: string }; UnitPrice: number } }>;
  assert.equal(lines.reduce((sum, line) => sum + line.Amount, 0), 1725);
  assert.equal(lines[1].Description, 'Jobber discount');
  assert.equal(lines[1].SalesItemLineDetail.UnitPrice, -275);
  assert.equal(lines[1].SalesItemLineDetail.TaxCodeRef.value, 'NON');
  assert.equal(built.memo.length, 1001);
  assert.equal(built.memo.truncated, true);
  assert.equal(built.memo.limit, 1000);
  assert.equal((built.body?.CustomerMemo as { value: string }).value.length, 1000);

  const negative = buildJobberSyncedInvoice(
    { ...invoice, lines: [{ name: 'MISC', description: 'credit', quantity: 1, unitPrice: -40, taxable: true }, { name: '1MS', description: null, quantity: 1, unitPrice: 200, taxable: true }], taxAmount: 12.4 },
    '15',
    { '1MS': '23', MISC: '5' },
    '3',
    { taxOverride: true }
  );
  const taxLines = (negative.body?.Line || []) as Array<{ Amount: number; SalesItemLineDetail: { TaxCodeRef: { value: string } } }>;
  assert.equal(taxLines[0].SalesItemLineDetail.TaxCodeRef.value, 'NON');
  assert.equal(taxLines[1].SalesItemLineDetail.TaxCodeRef.value, 'TAX');
  assert.equal(negative.negativeTaxableLines, 1);
  assert.equal((negative.body?.TxnTaxDetail as { TotalTax: number }).TotalTax, 12.4);
});

test('payment lines use the Jobber payment date and amount', () => {
  const lines = jobberPaymentLines({
    ...invoice,
    paymentsTotal: 240.95,
    payments: [
      { id: 'p1', amount: 100, entryDate: '2026-10-02', adjustmentType: 'PAYMENT' },
      { id: 'p2', amount: 140.95, entryDate: '2026-10-03T20:00:00Z', adjustmentType: 'DEPOSIT' },
      { id: 'p3', amount: 10, entryDate: '2026-10-04', adjustmentType: 'REFUND' },
    ],
  });
  assert.deepEqual(lines.map((line) => [line.amount, line.txnDate, line.source]), [
    [100, '2026-10-02', 'jobber-payment'],
    [140.95, '2026-10-03', 'jobber-payment'],
  ]);
});

test('explicit customer and item ids skip name lookup, and two customers block the invoice', async () => {
  const queries: string[] = [];
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], customerIds: { 'Colleen Baker': '15285' }, itemIds: { '1MS': '23', MISC: '5' } },
    {
      qboQuery: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('DisplayName') || sql.includes('Item')) throw new Error('name lookup');
        return { QueryResponse: {} };
      },
      loadJobberInvoices: async () => [invoice],
    }
  );
  assert.equal((result.invoices as Array<{ status: string }>)[0].status, 'create');
  assert.equal(queries.some((sql) => sql.includes('DisplayName') || sql.includes('Item')), false);

  const ambiguous = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'] },
    {
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('DisplayName')) return { QueryResponse: { Customer: [{ Id: '1' }, { Id: '2' }] } };
        return { QueryResponse: { Item: [{ Id: '23' }] } };
      },
      loadJobberInvoices: async () => [invoice],
    }
  );
  const row = (ambiguous.invoices as Array<{ status: string; reason: string | null }>)[0];
  assert.equal(row.status, 'blocked');
  assert.match(row.reason || '', /customerIds/);
});

test('previews retry a QuickBooks 429 sequentially and still plan the invoice', async () => {
  let active = 0;
  let maxActive = 0;
  let failures = 0;
  const delays: number[] = [];
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824', '5825'], limit: 8 },
    {
      sleep: async (ms: number) => {
        delays.push(ms);
      },
      qboQuery: async (sql: string) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        if (failures < 1) {
          failures += 1;
          throw new Error('QuickBooks query failed (429).');
        }
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('DisplayName')) return { QueryResponse: { Customer: [{ Id: '1' }] } };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
        return { QueryResponse: {} };
      },
      loadJobberInvoices: async () => [invoice, { ...invoice, invoiceNumber: '5825' }],
    }
  );
  assert.equal(maxActive, 1);
  assert.deepEqual(delays, [400]);
  assert.equal(result.rateLimitRetries, 1);
  assert.equal(result.create, 2);
});

test('payout confirm posts payment dates and a deposit with a fee line', async () => {
  const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
  const paid = {
    ...invoice,
    payments: [{ id: 'p1', amount: 240.95, entryDate: '2026-10-02', adjustmentType: 'PAYMENT' }],
  };
  const env = {
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '2222222222222222',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  };
  const result = await runJobberInvoiceImport(
    {
      invoiceNumbers: ['5824'],
      batchId: 'oct-2026',
      confirm: true,
      payments: 'payout',
      depositToAccountId: '90',
      feeAmount: 7.25,
      feeAccountId: '81',
    },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
      loadJobberInvoices: async () => [paid],
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('Customer')) return { QueryResponse: { Customer: [{ Id: '15285' }] } };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
        if (sql.includes('TaxRate')) return { QueryResponse: { TaxRate: TAX_RATE_ROWS } };
        return { QueryResponse: { TaxCode: [{ Id: '3' }] } };
      },
      fetchImpl: async (url, init) => {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        bodies.push({ url: String(url), body });
        const path = String(url);
        const entity = path.includes('/deposit') ? 'Deposit' : path.includes('/payment') ? 'Payment' : 'Invoice';
        const id = entity === 'Deposit' ? '70' : entity === 'Payment' ? '50' : '99';
        const row = entity === 'Invoice' ? { Id: id, SyncToken: '0', TxnTaxDetail: taxDetail(2.95, '4') } : { Id: id, SyncToken: '0' };
        return new Response(JSON.stringify({ [entity]: row }), { status: 200 });
      },
    }
  );
  assert.equal(result.wrote, true);
  const payment = bodies.find((call) => call.url.includes('/payment'));
  const deposit = bodies.find((call) => call.url.includes('/deposit'));
  assert.equal(payment?.body.TxnDate, '2026-10-02');
  assert.equal(payment?.body.TotalAmt, 240.95);
  const lines = deposit?.body.Line as Array<{ Amount: number; LinkedTxn?: unknown; DepositLineDetail?: { AccountRef: { value: string } } }>;
  assert.equal(lines[0].Amount, 240.95);
  assert.equal(lines[1].Amount, -7.25);
  assert.equal(lines[1].DepositLineDetail?.AccountRef.value, '81');
  assert.equal(lines.reduce((sum, line) => sum + line.Amount, 0), 233.7);
});

test('createCustomers previews a new customer and does not post', async () => {
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], createCustomers: true },
    {
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('DisplayName')) return { QueryResponse: {} };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
        return { QueryResponse: {} };
      },
      loadJobberInvoices: async () => [invoice],
      fetchImpl: async () => {
        throw new Error('preview posted');
      },
    }
  );
  const row = (result.invoices as Array<{ status: string; customerCreate: { displayName: string } | null; body: { CustomerRef?: unknown } | null }>)[0];
  assert.equal(result.dryRun, true);
  assert.equal(row.status, 'create');
  assert.equal(row.customerCreate?.displayName, 'Colleen Baker');
  assert.equal(row.body?.CustomerRef, undefined);
});

test('createCustomers confirm posts the customer before the invoice', async () => {
  const order: string[] = [];
  const env = {
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '2222222222222222',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  };
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], batchId: 'oct-2026', confirm: true, createCustomers: true, payments: 'none' },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
      loadJobberInvoices: async () => [invoice],
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('DisplayName')) return { QueryResponse: {} };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
        if (sql.includes('TaxRate')) return { QueryResponse: { TaxRate: TAX_RATE_ROWS } };
        return { QueryResponse: {} };
      },
      fetchImpl: async (url, init) => {
        const path = String(url);
        const body = JSON.parse(String(init?.body));
        if (path.includes('/customer')) {
          order.push(`customer:${body.DisplayName}`);
          return new Response(JSON.stringify({ Customer: { Id: '77', SyncToken: '0' } }), { status: 200 });
        }
        order.push(`invoice:${body.CustomerRef.value}`);
        return new Response(JSON.stringify({ Invoice: { Id: '99', SyncToken: '0', TxnTaxDetail: taxDetail(2.95, '4') } }), { status: 200 });
      },
    }
  );
  assert.equal(result.wrote, true);
  assert.deepEqual(order, ['customer:Colleen Baker', 'invoice:77']);
});

const escondido = {
  ...invoice,
  city: 'Escondido',
  address: {
    line1: '15842 Highland Valley Road',
    line2: null,
    city: 'Escondido',
    province: 'California',
    postalCode: '92025',
    country: 'US',
  },
};

test('jobsite address matches the old sync and the batch id stays inside PrivateNote', () => {
  const ship = qboShipAddress({
    line1: '15842 Highland Valley Road',
    line2: 'Unit B',
    city: 'Escondido',
    province: 'CA',
    postalCode: '92025',
    country: null,
  });
  assert.deepEqual(ship, {
    Line1: '15842 Highland Valley Road',
    Line2: 'Unit B',
    City: 'Escondido',
    Country: 'United States',
    CountrySubDivisionCode: 'CA',
    PostalCode: '92025',
  });
  const built = buildJobberSyncedInvoice(escondido, '16110', { '1MS': '23', MISC: '5' }, '3', { batchId: 'oct-2026' });
  assert.equal('BillAddr' in (built.body || {}), false);
  assert.equal(built.body?.FreeFormAddress, false);
  assert.deepEqual(built.body?.ShipAddr, {
    Line1: '15842 Highland Valley Road',
    City: 'Escondido',
    Country: 'United States',
    CountrySubDivisionCode: 'CA',
    PostalCode: '92025',
  });
  assert.deepEqual(built.body?.ShipFromAddr, built.body?.ShipAddr);
  assert.equal(built.body?.PrivateNote, '[batch:oct-2026]');
  const note = privateNoteWithBatch('n'.repeat(3990), 'oct-2026');
  assert.equal(note?.endsWith(' [batch:oct-2026]'), true);
  assert.equal(note?.length, 4000);
});

test('a missing property address is blocked and disagreeing properties are flagged', async () => {
  assert.match(missingJobsiteAddressReason(null) || '', /Anza shop/);
  assert.match(missingJobsiteAddressReason({ line1: null, line2: null, city: 'Escondido', province: 'CA', postalCode: null, country: null }) || '', /street/);
  const conflict = resolveJobProperties([
    escondido.address,
    { line1: '1 State Street', line2: null, city: 'Hemet', province: 'CA', postalCode: '92543', country: 'US' },
  ]);
  assert.match(conflict.conflict || '', /different property addresses/);
  assert.equal(conflict.address, null);
  const bare = { ...invoice, address: null };
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'] },
    {
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('Customer')) return { QueryResponse: { Customer: [{ Id: '15285' }] } };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
        return { QueryResponse: {} };
      },
      loadJobberInvoices: async () => [bare],
      fetchImpl: async () => { throw new Error('blocked invoice posted'); },
    }
  );
  const row = (result.invoices as Array<{ status: string; reason: string | null; body: unknown }>)[0];
  assert.equal(row.status, 'blocked');
  assert.equal(row.body, null);
  assert.match(row.reason || '', /Anza shop/);
  assert.equal(result.ok, true);
});

test('county rates come from TaxRate names, and saved tax must match the jobsite', () => {
  assert.equal(countyPercentRateId(TAX_RATES, 'San Diego'), '4');
  assert.equal(countyPercentRateId(TAX_RATES, 'Riverside'), '25');
  const escondidoMatch = assessSavedTax({
    requestedTxnTaxCodeId: '3',
    city: 'Escondido',
    jobberTax: 2.95,
    rates: TAX_RATES,
    qbo: { TxnTaxDetail: taxDetail(2.95, '4') },
  });
  assert.equal(escondidoMatch.taxMismatch, false);
  assert.equal(escondidoMatch.expectedCountyRateId, '4');
  const riversideShop = assessSavedTax({
    requestedTxnTaxCodeId: '3',
    city: 'Escondido',
    jobberTax: 2.95,
    rates: TAX_RATES,
    qbo: { TxnTaxDetail: taxDetail(2.96, '25') },
  });
  assert.equal(riversideShop.taxMismatch, true);
  assert.match(riversideShop.taxMismatchReasons.join(' '), /not the San Diego County rate 4/);
  const hemet = assessSavedTax({
    requestedTxnTaxCodeId: '65',
    city: 'Hemet',
    jobberTax: 8.75,
    rates: TAX_RATES,
    qbo: { TxnTaxDetail: taxDetail(8.75, '25') },
  });
  assert.equal(hemet.county, 'Riverside');
  assert.equal(hemet.savedCountyRateId, '25');
  assert.equal(hemet.taxMismatch, false);
  const pennyOver = assessSavedTax({
    requestedTxnTaxCodeId: '65',
    city: 'Hemet',
    jobberTax: 8.75,
    rates: TAX_RATES,
    qbo: { TxnTaxDetail: taxDetail(8.77, '25') },
  });
  assert.equal(pennyOver.taxMismatch, true);
  assert.match(pennyOver.taxMismatchReasons.join(' '), /within \$0\.01/);
});

test('confirm stops the chunk on a tax mismatch before payments', async () => {
  const env = {
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '2222222222222222',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  };
  const next = { ...invoice, invoiceNumber: '5825' };
  const urls: string[] = [];
  const audits: Array<{ status: string }> = [];
  const captured: { body: Record<string, unknown> | null } = { body: null };
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824', '5825'], batchId: 'ast-check', confirm: true, payments: 'undeposited' },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async (entry) => { audits.push({ status: entry.status }); },
      loadJobberInvoices: async () => [escondido, next],
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('Customer')) return { QueryResponse: { Customer: [{ Id: '16110' }] } };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
        if (sql.includes('TaxRate')) return { QueryResponse: { TaxRate: TAX_RATE_ROWS } };
        return { QueryResponse: {} };
      },
      fetchImpl: async (url, init) => {
        urls.push(String(url));
        captured.body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          Invoice: { Id: '39108', SyncToken: '0', DocNumber: '5824', TxnTaxDetail: taxDetail(2.95, '25') },
        }), { status: 200 });
      },
    }
  );
  const postedBody = captured.body;
  assert.ok(postedBody);
  assert.equal(postedBody.PrivateNote, '[batch:ast-check]');
  assert.equal((postedBody.ShipAddr as { City: string }).City, 'Escondido');
  assert.equal(result.ok, false);
  assert.equal(result.taxMismatch, true);
  assert.equal(result.stoppedForTax, true);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /\/invoice/);
  assert.equal(urls.some((url) => url.includes('/payment')), false);
  const tax = (result.posted as Array<{ invoiceNumber: string; tax: InvoiceTaxReport }>)[0];
  assert.equal(tax.invoiceNumber, '5824');
  assert.equal(tax.tax.savedCountyRateId, '25');
  assert.equal(tax.tax.expectedCountyRateId, '4');
  assert.equal(tax.tax.taxMismatch, true);
  assert.equal(audits.some((row) => row.status === 'tax_mismatch'), true);
  assert.equal(audits.some((row) => row.status === 'ok'), true);
});
