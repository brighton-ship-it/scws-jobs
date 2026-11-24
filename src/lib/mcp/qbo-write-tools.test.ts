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
