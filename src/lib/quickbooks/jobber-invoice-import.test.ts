import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSavedTax,
  buildJobberSyncedInvoice,
  shouldHoldAutomatedSalesTax,
  classifyJobberInvoice,
  countyRateIdFor,
  jobberPaymentLines,
  missingJobsiteAddressReason,
  pacificDate,
  qboShipAddress,
  qboItemIdForLineName,
  resolveJobProperties,
  runJobberInvoiceImport,
  sliceInvoiceChunk,
  verifyCountyRateIds,
  type InvoiceTaxReport,
  type JobberInvoiceForQbo,
} from './jobber-invoice-import.ts';
import { COUNTY_RATE_ID_BY_TAX_CODE, COUNTY_RATE_IDS, countyNameForCity, taxCodeIdForCity } from './tax-codes.ts';
import { privateNoteWithBatch } from './write-payloads.ts';

const HASH = 'a'.repeat(64);
const TAX_RATE_ROWS = [
  { Id: '4', Name: HASH, Description: '', RateValue: 1 },
  { Id: '25', Name: 'b'.repeat(64), Description: '', RateValue: 1 },
  { Id: '5', Name: 'c'.repeat(64), Description: '', RateValue: 0.5 },
  { Id: '3', Name: 'd'.repeat(64), Description: '', RateValue: 6.25 },
];

function taxLines(ids: string[], percents: number[], totalTax: number) {
  return {
    TotalTax: totalTax,
    TxnTaxCodeRef: { value: '3' },
    TaxLine: ids.map((id, index) => ({
      Amount: 1,
      DetailType: 'TaxLineDetail',
      TaxLineDetail: { TaxRateRef: { value: id }, TaxPercent: percents[index], NetAmountTaxable: 100 },
    })),
  };
}

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
  assert.equal(taxCodeIdForCity('Hemet'), '23');
  assert.equal(taxCodeIdForCity('Murrieta'), '25', 'Murrieta has its own city-district code 25');
  assert.equal(taxCodeIdForCity('Temecula'), '23');
  assert.equal(taxCodeIdForCity('Anza'), '23', 'Riverside County defaults to AST code 23, not manual code 65');
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
  assert.equal(taxLines[0].SalesItemLineDetail.TaxCodeRef.value, 'TAX');
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

test('county rates are fixed ids, and district cities can have more than one 1% line', () => {
  assert.equal(HASH.length, 64);
  assert.equal(countyRateIdFor('San Diego'), '4');
  assert.equal(countyRateIdFor('Riverside'), '25');
  assert.equal(verifyCountyRateIds([
    { id: '3', rateIds: ['3', '4', '5'] },
    { id: '23', rateIds: ['9', '16', '25', '3'] },
  ]).unresolvedReason, null);
  assert.match(verifyCountyRateIds([
    { id: '3', rateIds: ['3', '5'] },
    { id: '23', rateIds: ['25'] },
  ]).unresolvedReason || '', /TaxCode 3/);
  assert.equal(verifyCountyRateIds([{ id: '3', rateIds: null }, { id: '23', rateIds: null }]).unresolvedReason, null);

  const sanDiego = assessSavedTax({
    requestedTxnTaxCodeId: '3',
    city: 'Escondido',
    jobberTax: 2.95,
    qbo: { TxnTaxDetail: taxLines(['3', '4', '5'], [6.25, 1, 0.5], 2.95) },
  });
  assert.equal(sanDiego.taxMismatch, false);
  assert.equal(sanDiego.expectedCountyRateId, '4');
  assert.equal(sanDiego.savedCountyRateId, '4');

  const murrieta = assessSavedTax({
    requestedTxnTaxCodeId: '65',
    city: 'Murrieta',
    jobberTax: 8.75,
    qbo: { TxnTaxDetail: taxLines(['9', '16', '25', '3'], [1, 1, 1, 6.25], 8.75) },
  });
  assert.equal(murrieta.county, 'Riverside');
  assert.equal(murrieta.taxMismatch, false);
  assert.equal(murrieta.savedCountyRateId, '25');

  const menifee = assessSavedTax({
    requestedTxnTaxCodeId: '30',
    city: 'Menifee',
    jobberTax: 8.75,
    qbo: { TxnTaxDetail: taxLines(['14', '9', '25', '3'], [1, 0.5, 1, 6.25], 8.75) },
  });
  assert.equal(menifee.taxMismatch, false);
  assert.equal(menifee.expectedCountyRateId, '25');

  const shopCounty = assessSavedTax({
    requestedTxnTaxCodeId: '3',
    city: 'Escondido',
    jobberTax: 2.95,
    qbo: { TxnTaxDetail: taxLines(['3', '25', '5'], [6.25, 1, 0.5], 2.95) },
  });
  assert.equal(shopCounty.taxMismatch, true);
  assert.match(shopCounty.taxMismatchReasons.join(' '), /do not include San Diego County rate 4/);
  assert.match(shopCounty.taxMismatchReasons.join(' '), /include Riverside County rate 25/);

  const pennyOver = assessSavedTax({
    requestedTxnTaxCodeId: '65',
    city: 'Hemet',
    jobberTax: 8.75,
    qbo: { TxnTaxDetail: taxLines(['9', '25', '3'], [1, 1, 6.25], 8.77) },
  });
  assert.equal(pennyOver.taxMismatch, true);
  assert.match(pennyOver.taxMismatchReasons.join(' '), /within \$0\.01/);
});

test('an unresolved county rate blocks preview and confirm before any post', async () => {
  const env = {
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '2222222222222222',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  };
  const badCodes = {
    QueryResponse: {
      TaxCode: [
        { Id: '3', SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '3' } }, { TaxRateRef: { value: '5' } }] } },
        { Id: '23', SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '25' } }] } },
      ],
    },
  };
  const qboQuery = async (sql: string) => {
    if (sql.includes('SalesTaxRateList')) return badCodes;
    if (sql.includes('DocNumber')) return { QueryResponse: {} };
    if (sql.includes('Customer')) return { QueryResponse: { Customer: [{ Id: '15285' }] } };
    if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
    if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
    return { QueryResponse: {} };
  };
  let posts = 0;
  const preview = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], batchId: 'rates' },
    { env, qboQuery, loadJobberInvoices: async () => [invoice], fetchImpl: async () => { posts += 1; throw new Error('preview posted'); } }
  );
  assert.equal(preview.ok, false);
  assert.equal(preview.wrote, false);
  assert.equal(preview.countyRateUnresolved, true);
  assert.equal(posts, 0);
  const row = (preview.invoices as Array<{ status: string; reason: string | null; body: unknown; tax: InvoiceTaxReport }>)[0];
  assert.equal(row.status, 'blocked');
  assert.equal(row.body, null);
  assert.equal(row.tax.countyRateUnresolved, true);
  assert.match(row.reason || '', /TaxCode 3/);

  const confirm = await runJobberInvoiceImport(
    { invoiceNumbers: ['5824'], batchId: 'rates', confirm: true, payments: 'undeposited' },
    {
      env,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
      qboQuery,
      loadJobberInvoices: async () => [invoice],
      fetchImpl: async () => { posts += 1; return new Response('{}', { status: 500 }); },
    }
  );
  assert.equal(confirm.ok, false);
  assert.equal(confirm.wrote, false);
  assert.equal(posts, 0);
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

test('findDiscountItem matches one active item named discount in any case', async () => {
  const { findDiscountItem } = await import('./jobber-invoice-import.ts');
  const seen: string[] = [];
  const one = await findDiscountItem(async (sql) => { seen.push(sql); return { QueryResponse: { Item: [{ Id: '526', Name: 'discount', Active: true }] } }; });
  assert.equal(one, '526');
  assert.match(seen[0], /from Item where Name = 'Discount'/);
  assert.equal(await findDiscountItem(async () => ({ QueryResponse: { Item: [{ Id: '1', Name: 'Discount' }, { Id: '2', Name: 'DISCOUNT' }] } })), null, 'two matches are ambiguous');
  assert.equal(await findDiscountItem(async () => ({ QueryResponse: { Item: [{ Id: '9', Name: 'Discounted pump', Active: true }] } })), null);
  assert.equal(await findDiscountItem(async () => ({ QueryResponse: {} })), null);
});

test('a CDTFA-verified Temecula mailing city pins code 23 and a plain Temecula import does not', () => {
  const temecula: JobberInvoiceForQbo = {
    ...invoice,
    invoiceNumber: '5901',
    city: 'Temecula',
    address: { line1: '123 Test St', line2: null, city: 'Testville', province: 'CA', postalCode: '00000', country: 'US' },
    taxAmount: 193.75,
    total: 34693.75,
  };
  const held = buildJobberSyncedInvoice(temecula, '15', { '1MS': '23', MISC: '5' }, '23', { holdTaxCode: true });
  const detail = held.body?.TxnTaxDetail as { UseAutomatedSalesTax?: boolean; TxnTaxCodeRef: { value: string }; TotalTax?: number };
  assert.equal(detail.UseAutomatedSalesTax, false);
  assert.equal(detail.TxnTaxCodeRef.value, '23');
  assert.equal('TotalTax' in detail, false);
  const plain = buildJobberSyncedInvoice(temecula, '15', { '1MS': '23', MISC: '5' }, '23');
  assert.equal('UseAutomatedSalesTax' in (plain.body?.TxnTaxDetail as object), false);
  assert.equal(shouldHoldAutomatedSalesTax('Temecula', ['Temecula']), true);
  assert.equal(shouldHoldAutomatedSalesTax('Murrieta', ['Temecula']), false);
  assert.equal(shouldHoldAutomatedSalesTax('Temecula', []), false);
  assert.equal(shouldHoldAutomatedSalesTax('Anza', []), false);
  const good = assessSavedTax({
    requestedTxnTaxCodeId: '23',
    city: 'Temecula',
    jobberTax: 193.75,
    holdTaxCode: true,
    qbo: { TxnTaxDetail: { ...taxLines(['3', '9', '25'], [6, 0.75, 1], 193.75), TxnTaxCodeRef: { value: '23' } } },
  });
  assert.equal(good.taxMismatch, false);
  const cityRate = assessSavedTax({
    requestedTxnTaxCodeId: '23',
    city: 'Temecula',
    jobberTax: 193.75,
    holdTaxCode: true,
    qbo: { TxnTaxDetail: { ...taxLines(['3', '9', '13', '25'], [6, 0.75, 1, 1], 250), TxnTaxCodeRef: { value: '29' }, TaxReviewStatus: 'AST_TAX_OVERRIDE' } },
  });
  assert.equal(cityRate.taxMismatch, true);
  assert.match(cityRate.taxMismatchReasons.join(' '), /13/);
  assert.match(cityRate.taxMismatchReasons.join(' '), /AST_TAX_OVERRIDE/);
  const ignored = assessSavedTax({
    requestedTxnTaxCodeId: '23',
    city: 'Temecula',
    jobberTax: 193.75,
    qbo: { TxnTaxDetail: taxLines(['3', '9', '25'], [6, 0.75, 1], 193.75) },
  });
  assert.equal(ignored.taxMismatch, false);
});

test('a taxCodeByCity override leaves the invoice payload unchanged when the code matches', async () => {
  const job: JobberInvoiceForQbo = {
    ...invoice,
    invoiceNumber: '5902',
    city: 'Temecula',
    address: { line1: '123 Test St', line2: null, city: 'Temecula', province: 'CA', postalCode: '00000', country: 'US' },
  };
  const qboQuery = async (sql: string) => {
    if (sql.includes('DocNumber')) return { QueryResponse: {} };
    if (sql.includes('DisplayName')) return { QueryResponse: { Customer: [{ Id: '15' }] } };
    if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23', Name: '1MS' }] } };
    if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5', Name: 'MISC' }] } };
    if (sql.includes('TaxCode')) return { QueryResponse: {} };
    return { QueryResponse: {} };
  };
  const deps = { qboQuery, loadJobberInvoices: async () => [job], fetchImpl: async () => { throw new Error('preview posted'); } };
  const plain = await runJobberInvoiceImport({ invoiceNumbers: ['5902'] }, deps);
  const overridden = await runJobberInvoiceImport(
    { invoiceNumbers: ['5902'], taxCodeByCity: { Temecula: '23', 'San Marcos': '40', Wildomar: '33', Anza: '23', Murrieta: '25', Hemet: '23' } },
    deps
  );
  const plainRow = (plain.invoices as Array<{ status: string; body: Record<string, unknown> }>)[0];
  const overRow = (overridden.invoices as Array<{ status: string; body: Record<string, unknown> }>)[0];
  assert.equal(plainRow.status, 'create');
  assert.deepEqual(overRow.body, plainRow.body);
  assert.equal('UseAutomatedSalesTax' in (overRow.body.TxnTaxDetail as object), false);
});

test('out-of-county map: Riverside desert cities and San Bernardino County resolve to existing codes', () => {
  assert.equal(taxCodeIdForCity('La Quinta'), '59');
  assert.equal(taxCodeIdForCity('Desert Hot Springs'), '34');
  assert.equal(taxCodeIdForCity('Indio'), '35');
  assert.equal(taxCodeIdForCity('Idyllwild-Pine Cove'), '23');
  assert.equal(taxCodeIdForCity('Idyllwild'), '23');
  assert.equal(taxCodeIdForCity('Yucaipa'), '46');
  assert.equal(taxCodeIdForCity('San Bernardino'), '55');
  assert.equal(taxCodeIdForCity('Fawnskin'), '31');
  assert.equal(taxCodeIdForCity('Oak Glen'), '31');
  assert.equal(taxCodeIdForCity('Lake Arrowhead'), '31');
  // taxCodeByCity still wins, e.g. a Desert Hot Springs address outside city limits.
  assert.equal(taxCodeIdForCity('Desert Hot Springs', { 'Desert Hot Springs': '23' }), '23');
  for (const city of ['La Quinta', 'Desert Hot Springs', 'Indio', 'Idyllwild-Pine Cove']) {
    assert.equal(countyNameForCity(city), 'Riverside', city);
  }
  for (const city of ['Yucaipa', 'San Bernardino', 'Fawnskin', 'Oak Glen', 'Lake Arrowhead']) {
    assert.equal(countyNameForCity(city), 'San Bernardino', city);
  }
  assert.equal(countyNameForCity('Las Vegas'), null);
  assert.equal(countyRateIdFor('San Bernardino'), '26');
  for (const code of ['59', '34', '35']) assert.equal(COUNTY_RATE_ID_BY_TAX_CODE[code], '25');
  for (const code of ['31', '46', '55']) assert.equal(COUNTY_RATE_ID_BY_TAX_CODE[code], '26');
  assert.ok(COUNTY_RATE_IDS.includes('26'));
});

test('TaxCode 31 must carry San Bernardino County rate 26 when QuickBooks returns its list', () => {
  const good = [
    { id: '3', rateIds: ['3', '4', '5'] },
    { id: '23', rateIds: ['3', '9', '25'] },
  ];
  assert.equal(verifyCountyRateIds([...good, { id: '31', rateIds: ['3', '7', '26'] }]).unresolvedReason, null);
  assert.equal(verifyCountyRateIds([...good, { id: '31', rateIds: null }]).unresolvedReason, null);
  const bad = verifyCountyRateIds([...good, { id: '31', rateIds: ['3', '7'] }]);
  assert.match(bad.unresolvedReason || '', /TaxCode 31 does not include San Bernardino County rate 26/);
  assert.equal(countyRateIdFor('San Bernardino', bad), null);
});

test('saved tax check: San Bernardino needs rate 26 and no other county rate', () => {
  const yucaipa = assessSavedTax({
    requestedTxnTaxCodeId: '46',
    city: 'Yucaipa',
    jobberTax: 8.75,
    qbo: { TxnTaxDetail: taxLines(['3', '7', '26', '40'], [6, 0.75, 1, 1], 8.75) },
  });
  assert.equal(yucaipa.county, 'San Bernardino');
  assert.equal(yucaipa.expectedCountyRateId, '26');
  assert.equal(yucaipa.savedCountyRateId, '26');
  assert.equal(yucaipa.taxMismatch, false);

  const fawnskinShop = assessSavedTax({
    requestedTxnTaxCodeId: '31',
    city: 'Fawnskin',
    jobberTax: 7.75,
    qbo: { TxnTaxDetail: taxLines(['3', '9', '25'], [6.25, 0.5, 1], 7.75) },
  });
  assert.equal(fawnskinShop.taxMismatch, true);
  assert.equal(fawnskinShop.savedCountyRateId, '25');
  assert.match(fawnskinShop.taxMismatchReasons.join(' '), /do not include San Bernardino County rate 26/);
  assert.match(fawnskinShop.taxMismatchReasons.join(' '), /include Riverside County rate 25/);

  const laQuinta = assessSavedTax({
    requestedTxnTaxCodeId: '59',
    city: 'La Quinta',
    jobberTax: 8.75,
    qbo: { TxnTaxDetail: taxLines(['3', '9', '25', '49'], [6.25, 0.5, 1, 1], 8.75) },
  });
  assert.equal(laQuinta.county, 'Riverside');
  assert.equal(laQuinta.taxMismatch, false);

  const riversideWithSb = assessSavedTax({
    requestedTxnTaxCodeId: '23',
    city: 'Indio',
    jobberTax: 7.75,
    qbo: { TxnTaxDetail: taxLines(['3', '25', '26'], [6.25, 1, 0.5], 7.75) },
  });
  assert.equal(riversideWithSb.taxMismatch, true);
  assert.match(riversideWithSb.taxMismatchReasons.join(' '), /include San Bernardino County rate 26/);
});

test('preview no longer blocks a Yucaipa or La Quinta jobsite on the county map', async () => {
  const env = {
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '2222222222222222',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  };
  const codes = {
    QueryResponse: {
      TaxCode: [
        { Id: '3', SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '3' } }, { TaxRateRef: { value: '4' } }, { TaxRateRef: { value: '5' } }] } },
        { Id: '23', SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '3' } }, { TaxRateRef: { value: '9' } }, { TaxRateRef: { value: '25' } }] } },
        { Id: '31', SalesTaxRateList: { TaxRateDetail: [{ TaxRateRef: { value: '3' } }, { TaxRateRef: { value: '7' } }, { TaxRateRef: { value: '26' } }] } },
      ],
    },
  };
  const qboQuery = async (sql: string) => {
    if (sql.includes('SalesTaxRateList')) return codes;
    if (sql.includes('DocNumber')) return { QueryResponse: {} };
    if (sql.includes('Customer')) return { QueryResponse: { Customer: [{ Id: '15285' }] } };
    if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23' }] } };
    if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5' }] } };
    return { QueryResponse: {} };
  };
  const yucaipa: JobberInvoiceForQbo = { ...invoice, invoiceNumber: '5832', city: 'Yucaipa', address: { ...invoice.address!, city: 'Yucaipa', postalCode: '92399' } };
  const laQuinta: JobberInvoiceForQbo = { ...invoice, invoiceNumber: '5843', city: 'La Quinta', address: { ...invoice.address!, city: 'La Quinta', postalCode: '92253' } };
  let posts = 0;
  const preview = await runJobberInvoiceImport(
    { invoiceNumbers: ['5832', '5843'], batchId: 'ooc' },
    { env, qboQuery, loadJobberInvoices: async () => [yucaipa, laQuinta], fetchImpl: async () => { posts += 1; throw new Error('preview posted'); } }
  );
  assert.equal(posts, 0);
  assert.equal(preview.ok, true);
  assert.equal(preview.countyRateUnresolved, false);
  const rows = preview.invoices as Array<{ invoiceNumber: string; status: string; reason: string | null; body: any; tax: InvoiceTaxReport }>;
  const y = rows.find((row) => row.invoiceNumber === '5832')!;
  assert.equal(y.status, 'create', y.reason || '');
  assert.equal(y.body.TxnTaxDetail.TxnTaxCodeRef.value, '46');
  assert.equal(y.tax.county, 'San Bernardino');
  assert.equal(y.tax.expectedCountyRateId, '26');
  const q = rows.find((row) => row.invoiceNumber === '5843')!;
  assert.equal(q.status, 'create', q.reason || '');
  assert.equal(q.body.TxnTaxDetail.TxnTaxCodeRef.value, '59');
  assert.equal(q.tax.expectedCountyRateId, '25');
});

const testStreet = { line1: '123 Test St', line2: null, city: 'Testville', province: 'CA', postalCode: '00000', country: 'US' };

test('county map uses existing codes for the new cities and refuses an unknown tax code', async () => {
  assert.equal(taxCodeIdForCity('Thousand Palms'), '23');
  assert.equal(taxCodeIdForCity('Homeland'), '23');
  assert.equal(countyNameForCity('Thousand Palms'), 'Riverside');
  assert.equal(countyNameForCity('Homeland'), 'Riverside');
  for (const city of ['Upland', 'Highland', 'Twentynine Palms']) {
    assert.equal(countyNameForCity(city), 'San Bernardino', city);
    assert.equal(taxCodeIdForCity(city), '31', city);
  }
  const job: JobberInvoiceForQbo = {
    ...invoice,
    invoiceNumber: '6101',
    city: 'Testville',
    address: testStreet,
    clientName: 'Test Client',
  };
  const result = await runJobberInvoiceImport(
    { invoiceNumbers: ['6101'], taxCodeByCity: { Testville: '999' } },
    {
      qboQuery: async (sql: string) => {
        if (sql.includes('DocNumber')) return { QueryResponse: {} };
        if (sql.includes('DisplayName')) return { QueryResponse: { Customer: [{ Id: '15' }] } };
        if (sql.includes("Id = '999'")) return { QueryResponse: {} };
        if (sql.includes('1MS')) return { QueryResponse: { Item: [{ Id: '23', Name: '1MS' }] } };
        if (sql.includes('MISC')) return { QueryResponse: { Item: [{ Id: '5', Name: 'MISC' }] } };
        return { QueryResponse: {} };
      },
      loadJobberInvoices: async () => [job],
      fetchImpl: async () => { throw new Error('preview posted'); },
    }
  );
  const row = (result.invoices as Array<{ status: string; reason: string | null }>)[0];
  assert.equal(row.status, 'blocked');
  assert.match(row.reason || '', /Refusing to create a tax code/);
  assert.match(row.reason || '', /999/);
});

test('a taxed negative line and a discount before tax are TAX', () => {
  const warranty = buildJobberSyncedInvoice(
    {
      ...invoice,
      invoiceNumber: '6030',
      city: 'Testville',
      address: testStreet,
      lines: [
        { name: '1MS', description: 'Service', quantity: 1, unitPrice: 2500, taxable: true },
        { name: 'Warranty', description: 'warranty credit', quantity: 1, unitPrice: -2314, taxable: true },
      ],
      taxAmount: 2.71,
      total: 188.71,
    },
    '15',
    { '1MS': '23', Warranty: '5' },
    '23'
  );
  const warrantyLines = (warranty.body?.Line || []) as Array<{ Amount: number; SalesItemLineDetail: { TaxCodeRef: { value: string } } }>;
  assert.equal(warrantyLines[1].Amount, -2314);
  assert.equal(warrantyLines[1].SalesItemLineDetail.TaxCodeRef.value, 'TAX');

  const discount = buildJobberSyncedInvoice(
    {
      ...invoice,
      invoiceNumber: '6007',
      city: 'Testville',
      address: testStreet,
      lines: [{ name: '1MS', description: 'Service', quantity: 1, unitPrice: 6359.23, taxable: true }],
      discountAmount: 500,
      taxAmount: 453.84,
      total: 6313.07,
    },
    '15',
    { '1MS': '23', Discount: '526' },
    '23'
  );
  const discountLine = ((discount.body?.Line || []) as Array<{ Description?: string; Amount: number; SalesItemLineDetail: { TaxCodeRef: { value: string } } }>).find((line) => line.Description === 'Jobber discount');
  assert.equal(discountLine?.Amount, -500);
  assert.equal(discountLine?.SalesItemLineDetail.TaxCodeRef.value, 'TAX');
});

test('absorbTaxShortfall adds a non-taxable line and the confirm check matches total, tax, and the shortfall', () => {
  const built = buildJobberSyncedInvoice(
    {
      ...invoice,
      invoiceNumber: '6007',
      city: 'Testville',
      address: testStreet,
      lines: [{ name: '1MS', description: 'Service', quantity: 1, unitPrice: 5860, taxable: true }],
      taxAmount: 453.84,
      total: 6313.84,
      discountAmount: 0,
    },
    '15',
    { '1MS': '23' },
    '23',
    { absorb: { expectedQboTax: 492.59, jobberTax: 453.84, expenseAccountId: '18', itemId: '9001' } }
  );
  const lines = (built.body?.Line || []) as Array<{ Description?: string; Amount: number; SalesItemLineDetail: { ItemRef: { value: string }; TaxCodeRef: { value: string } } }>;
  const absorbed = lines.find((line) => line.Description === 'Sales tax absorbed by SCWS');
  assert.equal(absorbed?.Amount, -38.75);
  assert.equal(absorbed?.SalesItemLineDetail.TaxCodeRef.value, 'NON');
  assert.equal(absorbed?.SalesItemLineDetail.ItemRef.value, '9001');
  const ok = assessSavedTax({
    requestedTxnTaxCodeId: '23',
    city: 'Homeland',
    jobberTax: 453.84,
    absorb: { expectedQboTax: 492.59, jobberTax: 453.84, jobberTotal: 6313.84 },
    qbo: {
      TotalAmt: 6313.84,
      Line: [{ Description: 'Sales tax absorbed by SCWS', Amount: -38.75, DetailType: 'SalesItemLineDetail' }],
      TxnTaxDetail: { ...taxLines(['3', '9', '25'], [6, 0.75, 1], 492.59), TxnTaxCodeRef: { value: '23' } },
    },
  });
  assert.equal(ok.taxMismatch, false, ok.taxMismatchReasons.join(' '));
  const bad = assessSavedTax({
    requestedTxnTaxCodeId: '23',
    city: 'Homeland',
    jobberTax: 453.84,
    absorb: { expectedQboTax: 492.59, jobberTax: 453.84, jobberTotal: 6313.84 },
    qbo: {
      TotalAmt: 6352.59,
      Line: [],
      TxnTaxDetail: { TxnTaxCodeRef: { value: '23' }, TotalTax: 492.59, TaxLine: [] },
    },
  });
  assert.equal(bad.taxMismatch, true);
  assert.match(bad.taxMismatchReasons.join(' '), /Jobber total/);
  assert.match(bad.taxMismatchReasons.join(' '), /Absorbed line/);
});

test('6T pump Hoist matches the hoist item without regard to case', () => {
  assert.equal(qboItemIdForLineName('6T pump Hoist'), '1519');
  assert.equal(qboItemIdForLineName('6T PUMP HOIST'), '1519');
  assert.equal(qboItemIdForLineName('6T pump Hoist', { '6t pump hoist': '42' }), '42');
  const built = buildJobberSyncedInvoice(
    {
      ...invoice,
      invoiceNumber: '6102',
      city: 'Testville',
      address: testStreet,
      lines: [{ name: '6T pump Hoist', description: 'Hoist', quantity: 1, unitPrice: 1000, taxable: true }],
      taxAmount: 77.5,
      total: 1077.5,
    },
    '15',
    {},
    '23'
  );
  const line = (built.body?.Line as Array<{ SalesItemLineDetail: { ItemRef: { value: string } } }>)[0];
  assert.equal(line.SalesItemLineDetail.ItemRef.value, '1519');
  assert.equal(built.missingItems.length, 0);
});
