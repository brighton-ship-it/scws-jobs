import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QBO_WRITE_MCP_TOOLS } from './qbo-write-tools.ts';

test('write tools describe the gated environment instead of sandbox only', () => {
  assert.equal(QBO_WRITE_MCP_TOOLS.length > 0, true);
  for (const tool of QBO_WRITE_MCP_TOOLS) {
    assert.doesNotMatch(tool.description, /sandbox company only/i, tool.name);
    assert.match(tool.description, /whatever environment the env vars select/, tool.name);
  }
  const payment = QBO_WRITE_MCP_TOOLS.find((tool) => tool.name === 'qbo_payment');
  const voidTool = QBO_WRITE_MCP_TOOLS.find((tool) => tool.name === 'qbo_void');
  const closing = QBO_WRITE_MCP_TOOLS.find((tool) => tool.name === 'qbo_closing_date');
  assert.match(payment?.description || '', /Preview is the default/);
  assert.match(payment?.description || '', /confirm:true posts to whatever environment the env vars select/);
  assert.match(voidTool?.description || '', /confirm:true posts operation=void to whatever environment the env vars select/);
  assert.match(closing?.description || '', /posts BookCloseDate to whatever environment the env vars select/);
  const schema = payment?.inputSchema as { properties?: { confirm?: { description?: string } } };
  assert.match(schema?.properties?.confirm?.description || '', /true posts to whatever environment the env vars select/);
});

test('qbo_relink_deposit does not advertise requestId, and says retries must pass identical arguments', () => {
  const relink = QBO_WRITE_MCP_TOOLS.find((item) => item.name === 'qbo_relink_deposit');
  const props = (relink?.inputSchema as { properties: Record<string, unknown> }).properties;
  assert.equal('requestId' in props, false);
  assert.equal('batchId' in props, true);
  assert.match(String(relink?.description), /identical arguments/);
  assert.doesNotMatch(String(relink?.description), /retry gets new keys/);
  const journal = QBO_WRITE_MCP_TOOLS.find((item) => item.name === 'qbo_journal_entry');
  assert.equal('requestId' in (journal?.inputSchema as { properties: Record<string, unknown> }).properties, true);
});

test('qbo_item_tax_category preview refuses a goods class on a Service item before building a plan', async () => {
  const { callQboWriteTool } = await import('./qbo-write-tools.ts');
  const qboQuery = async (sql: string) => {
    if (/TaxClassification/.test(sql)) {
      return { QueryResponse: { TaxClassification: [{ Id: 'EUC-09020802-V1-00120000', Name: 'General taxable retail products', ApplicableTo: ['Inventory', 'NonInventory'] }] } };
    }
    return { QueryResponse: { Item: [{ Id: '1010000474', Type: 'Service', SyncToken: '1' }] } };
  };
  const got = await callQboWriteTool('qbo_item_tax_category', { itemId: '1010000474', taxClassificationId: 'EUC-09020802-V1-00120000', taxable: true, syncToken: '1' }, { qboQuery, env: {} });
  assert.equal(got.isError, true);
  const body = JSON.parse(got.content[0].text as string);
  assert.equal(body.refused, true);
  assert.equal(body.wrote, false);
  assert.match(body.error, /type Service/);
  const schema = QBO_WRITE_MCP_TOOLS.find((tool) => tool.name === 'qbo_item_tax_category')?.inputSchema as { required?: string[] };
  assert.deepEqual(schema.required, ['itemId', 'taxClassificationId', 'syncToken']);
});

test('qbo_invoice retaxLineIds preview shows the body built from the live invoice, with no TotalTax', async () => {
  const { callQboWriteTool } = await import('./qbo-write-tools.ts');
  const ship = { Id: '46096', Line1: '8770 Harbison Canyon Road', City: 'Alpine', CountrySubDivisionCode: 'CA', PostalCode: '91901' };
  const invoice = {
    Id: '39144',
    SyncToken: '1',
    ShipAddr: ship,
    ShipFromAddr: { ...ship, Id: '46097' },
    Line: [{ Id: '3', LineNum: 3, Amount: 150, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '1010000474' }, TaxCodeRef: { value: 'TAX' }, TaxClassificationRef: { value: 'EUC-99990201-V1-00020000' } } }],
  };
  const qboQuery = async (sql: string) => (/from Invoice/.test(sql) ? { QueryResponse: { Invoice: [invoice] } } : { QueryResponse: { Item: [{ Id: '1010000474', Taxable: true }] } });
  const got = await callQboWriteTool('qbo_invoice', { id: '39144', syncToken: '1', txnTaxCodeId: '3', retaxLineIds: ['3'] }, { qboQuery, env: {}, audit: async () => {} });
  const out = JSON.parse(got.content[0].text as string);
  assert.equal(out.wrote, false);
  assert.deepEqual(out.http.body.TxnTaxDetail, { TxnTaxCodeRef: { value: '3' } });
  assert.equal(out.http.body.SyncToken, '1');
  assert.equal(out.http.body.ShipFromAddr.Id, '46097');
  assert.equal('TaxClassificationRef' in out.http.body.Line[0].SalesItemLineDetail, false);
  assert.equal(out.http.readFirst, '/invoice/39144');
});

test('qbo_invoice retaxLineIds ignores a caller-supplied liveInvoice and uses the live read', async () => {
  const { callQboWriteTool } = await import('./qbo-write-tools.ts');
  const ship = { Line1: '8770 Harbison Canyon Road', City: 'Alpine', PostalCode: '91901' };
  const live = { Id: '39144', SyncToken: '1', ShipFromAddr: ship, Line: [{ Id: '3', LineNum: 3, Amount: 150, Description: 'live', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '1010000474' }, TaxCodeRef: { value: 'TAX' } } }] };
  const fake = { ...live, Line: [{ ...live.Line[0], Amount: 1, Description: 'forged' }] };
  const qboQuery = async (sql: string) => (/from Invoice/.test(sql) ? { QueryResponse: { Invoice: [live] } } : { QueryResponse: { Item: [{ Id: '1010000474', Taxable: true }] } });
  const got = await callQboWriteTool('qbo_invoice', { id: '39144', syncToken: '1', txnTaxCodeId: '3', retaxLineIds: ['3'], liveInvoice: fake }, { qboQuery, env: {}, audit: async () => {} });
  const out = JSON.parse(got.content[0].text as string);
  assert.equal(out.http.body.Line[0].Amount, 150);
  assert.equal(out.http.body.Line[0].Description, 'live');
});

test('setLineTaxCodes preview refuses a missing line and shows the sparse body for invoice 39354', async () => {
  const { callQboWriteTool } = await import('./qbo-write-tools.ts');
  const invoice = {
    Id: '39354',
    SyncToken: '4',
    CustomerRef: { value: '88' },
    TxnDate: '2026-11-01',
    BillAddr: { Line1: '1 Bill St' },
    ShipAddr: { Line1: '1 Job St' },
    TxnTaxDetail: { TxnTaxCodeRef: { value: '23' }, UseAutomatedSalesTax: false, TotalTax: 4192.75 },
    Line: [
      { Id: '1', LineNum: 1, Amount: 14100, Description: 'Mobilization', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '436' }, TaxCodeRef: { value: 'TAX' } } },
      { Id: '3', LineNum: 3, Amount: 40000, Description: 'Equipment', DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: '844' }, TaxCodeRef: { value: 'TAX' } } },
      { Id: '4', Amount: 54100, DetailType: 'SubTotalLineDetail', SubTotalLineDetail: {} },
    ],
  };
  const qboQuery = async (sql: string) => (/from Invoice/.test(sql) ? { QueryResponse: { Invoice: [invoice] } } : { QueryResponse: {} });
  let fetched = 0;
  const missing = await callQboWriteTool(
    'qbo_invoice',
    { id: '39354', syncToken: '4', setLineTaxCodes: [{ lineId: '9', taxCode: 'NON' }], expectedTotalTax: 0 },
    { qboQuery, env: {}, audit: async () => {}, fetchImpl: async () => { fetched += 1; throw new Error('posted'); } }
  );
  assert.equal(missing.isError, true);
  assert.equal(fetched, 0);
  const refused = JSON.parse(missing.content[0].text as string);
  assert.equal(refused.wrote, false);
  assert.equal(refused.refused, true);
  assert.match(refused.error, /no line 9/);
  const stale = await callQboWriteTool(
    'qbo_invoice',
    { id: '39354', syncToken: '3', setLineTaxCodes: [{ lineId: '1', taxCode: 'NON' }], expectedTotalTax: 0 },
    { qboQuery, env: {}, audit: async () => {} }
  );
  assert.match(JSON.parse(stale.content[0].text as string).error, /SyncToken 4/);
  const got = await callQboWriteTool(
    'qbo_invoice',
    { id: '39354', syncToken: '4', setLineTaxCodes: [{ lineId: '1', taxCode: 'NON' }, { lineId: '3', taxCode: 'NON' }], expectedTotalTax: 0 },
    { qboQuery, env: {}, audit: async () => {} }
  );
  const out = JSON.parse(got.content[0].text as string);
  assert.equal(out.wrote, false);
  assert.equal(out.http.body.TxnTaxDetail.TxnTaxCodeRef.value, '23');
  assert.equal(out.http.body.TxnTaxDetail.UseAutomatedSalesTax, false);
  assert.equal(out.http.body.Line[0].SalesItemLineDetail.TaxCodeRef.value, 'NON');
  assert.equal(out.http.body.Line[1].Amount, 40000);
  assert.equal(out.http.body.BillAddr.Line1, '1 Bill St');
  assert.equal(out.http.body.ShipAddr.Line1, '1 Job St');
});
