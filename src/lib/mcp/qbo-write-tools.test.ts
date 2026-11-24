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
