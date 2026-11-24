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
