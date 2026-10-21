import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeJobberMcpRequest } from './jobber-auth.ts';
import { restrictToReadOnly } from './jobber-http.ts';
import type { McpDispatcher } from './protocol.ts';

const env = { JOBBER_MCP_API_KEYS: '{"brighton":"full-key"}', JOBBER_MCP_READONLY_KEYS: '{"recent_work":"ro-key"}' };
const req = (k: string) => ({ headers: new Headers({ Authorization: `Bearer ${k}` }) });

describe('read-only MCP keys', () => {
  it('full keys stay full', () => {
    assert.deepEqual(authorizeJobberMcpRequest(req('full-key'), env), { ok: true, name: 'brighton' });
  });
  it('read-only keys are flagged', () => {
    assert.deepEqual(authorizeJobberMcpRequest(req('ro-key'), env), { ok: true, name: 'readonly:recent_work', readOnly: true });
  });
  it('read-only alone is enough config; unknown keys refused', () => {
    const e = { JOBBER_MCP_READONLY_KEYS: 'recent_work:ro-key' };
    assert.equal(authorizeJobberMcpRequest(req('ro-key'), e).ok, true);
    assert.deepEqual(authorizeJobberMcpRequest(req('nope'), e), { ok: false, reason: 'unauthorized' });
  });
  it('refuses write tools before execution and lists only read tools', async () => {
    const calls: string[] = [];
    const base: McpDispatcher = {
      serverInfo: { name: 't', version: '1' },
      tools: ['search_jobs', 'get_job', 'create_invoice_draft', 'qbo_query'].map((name) => ({ name, description: '', inputSchema: {} })),
      callTool: async (name) => { calls.push(name); return { content: [{ type: 'text', text: 'ok' }] }; },
    };
    const ro = restrictToReadOnly(base);
    assert.deepEqual(ro.tools.map((t) => t.name), ['search_jobs', 'get_job']);
    const denied = await ro.callTool('create_invoice_draft', {});
    assert.equal(denied.isError, true);
    await ro.callTool('qbo_query', {});
    await ro.callTool('search_jobs', {});
    assert.deepEqual(calls, ['search_jobs']);
  });
});
