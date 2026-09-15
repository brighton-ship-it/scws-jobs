import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleMcpJsonRpc,
  handleMcpMessages,
  JSONRPC_METHOD_NOT_FOUND,
} from './protocol.ts';
import type { McpDispatcher } from './protocol.ts';

const dispatcher: McpDispatcher = {
  serverInfo: { name: 'scws-jobber', version: '1.0.0' },
  instructions: 'Draft quotes only.',
  tools: [
    {
      name: 'search_clients',
      description: 'Search clients',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    },
  ],
  callTool: async (name, args) => ({
    content: [{ type: 'text', text: JSON.stringify({ name, args }) }],
  }),
};

describe('handleMcpJsonRpc', () => {
  it('negotiates initialize and lists tools', async () => {
    const init = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test' } },
      },
      dispatcher
    );
    assert.equal(init?.result && (init.result as { protocolVersion: string }).protocolVersion, '2025-03-26');
    assert.equal(
      init?.result && (init.result as { serverInfo: { name: string } }).serverInfo.name,
      'scws-jobber'
    );

    const listed = await handleMcpJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, dispatcher);
    assert.deepEqual((listed?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name), [
      'search_clients',
    ]);
  });

  it('returns null for initialized notifications', async () => {
    const response = await handleMcpJsonRpc(
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      dispatcher
    );
    assert.equal(response, null);
  });

  it('calls a registered tool and rejects unknown tools', async () => {
    const called = await handleMcpJsonRpc(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_clients', arguments: { query: 'Ramona' } },
      },
      dispatcher
    );
    assert.match(JSON.stringify(called?.result), /Ramona/);

    const unknown = await handleMcpJsonRpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'send_quote' } },
      dispatcher
    );
    assert.equal(unknown?.error?.code, JSONRPC_METHOD_NOT_FOUND);
  });
});

describe('handleMcpMessages', () => {
  it('returns a batch of responses and skips notifications', async () => {
    const result = await handleMcpMessages(
      [
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 9, method: 'ping' },
      ],
      dispatcher
    );
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { jsonrpc: '2.0', id: 9, result: {} });
  });
});
