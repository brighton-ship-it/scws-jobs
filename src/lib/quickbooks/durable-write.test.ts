import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callJobberMcpTool, jobberMcpHealthBody } from '../mcp/jobber-tools.ts';
import { insertQboAudit, loadSandboxToken, runQboWrite, saveSandboxToken, type QboAuditEntry, type SbClient } from './durable-write.ts';

const SANDBOX = {
  QBO_WRITES_ENABLED: 'true',
  QBO_WRITE_ENVIRONMENT: 'sandbox',
  QBO_WRITE_REALM_ID: '2222222222222222',
  QBO_PRODUCTION_REALM_ID: '9130349321543166',
};

const journal = {
  txnDate: '2026-10-31',
  lines: [
    { postingType: 'Debit', amount: 10, accountId: '80' },
    { postingType: 'Credit', amount: 10, accountId: '35' },
  ],
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

test('preview is the default and does not call QuickBooks', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return json({});
  };
  const result = await runQboWrite('qbo_journal_entry', journal, { fetchImpl, env: SANDBOX, productionRealmId: '9130349321543166' });
  assert.equal(calls, 0);
  assert.equal(result.dryRun, true);
  assert.equal(result.wrote, false);
  assert.equal(result.ok, true);
  assert.equal(result.http.body && (result.http.body.Line as unknown[]).length, 2);
  assert.equal(result.http.query.minorversion, '75');
  assert.match(result.requestId, /^[a-f0-9]{32}$/);
});

test('confirm is refused when writes are off, even if dryRun is false', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return json({});
  };
  const result = await runQboWrite('qbo_journal_entry', { ...journal, confirm: true, dryRun: false }, { fetchImpl, env: {}, productionRealmId: '9130349321543166' });
  assert.equal(calls, 0);
  assert.equal(result.refused, true);
  assert.equal(result.wrote, false);
  assert.match(result.error || '', /off/);
});

test('confirm refuses the production realm and the production host', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return json({});
  };
  const same = await runQboWrite(
    'qbo_journal_entry',
    { ...journal, confirm: true },
    { fetchImpl, env: { ...SANDBOX, QBO_WRITE_REALM_ID: '9130349321543166' }, productionRealmId: '9130349321543166', accessToken: 'tok' }
  );
  assert.equal(same.refused, true);
  assert.match(same.error || '', /production company/);

  const host = await runQboWrite(
    'qbo_journal_entry',
    { ...journal, confirm: true },
    {
      fetchImpl,
      env: { ...SANDBOX, QBO_WRITE_ENVIRONMENT: 'production' },
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
    }
  );
  assert.equal(host.refused, true);
  assert.match(host.error || '', /sandbox/);

  const live = await runQboWrite(
    'qbo_journal_entry',
    { ...journal, confirm: true },
    {
      fetchImpl,
      env: { QBO_WRITES_ENABLED: 'true', QBO_WRITE_REALM_ID: '9130349321543166' },
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
    }
  );
  assert.equal(live.refused, true);
  assert.match(live.error || '', /production company/);

  const unknown = await runQboWrite(
    'qbo_journal_entry',
    { ...journal, confirm: true },
    {
      fetchImpl,
      env: SANDBOX,
      loadProductionRealmId: async () => null,
      accessToken: 'tok',
    }
  );
  assert.equal(unknown.refused, true);
  assert.match(unknown.error || '', /production realm id/);
  assert.equal(calls, 0);
});

test('confirm posts once to the sandbox company and retries reuse requestid', async () => {
  const urls: string[] = [];
  const bodies: unknown[] = [];
  const audits: QboAuditEntry[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    urls.push(String(url));
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null);
    return json({ JournalEntry: { Id: '55', SyncToken: '0', DocNumber: 'JE-1' } });
  };
  const deps = {
    env: SANDBOX,
    productionRealmId: '9130349321543166',
    accessToken: 'sandbox-access',
    actor: 'bookkeeper',
    fetchImpl,
    audit: async (entry: QboAuditEntry) => {
      audits.push(entry);
    },
  };
  const first = await runQboWrite('qbo_journal_entry', { ...journal, confirm: true, requestId: 'retry-key-1' }, deps);
  const second = await runQboWrite('qbo_journal_entry', { ...journal, confirm: true, requestId: 'retry-key-1' }, deps);
  assert.equal(first.wrote, true);
  assert.equal(second.wrote, true);
  assert.equal(first.requestId, 'retry-key-1');
  assert.equal(second.requestId, 'retry-key-1');
  assert.equal(urls.length, 2);
  assert.equal(urls[0], urls[1]);
  assert.match(urls[0], /^https:\/\/sandbox-quickbooks\.api\.intuit\.com\/v3\/company\/2222222222222222\/journalentry\?/);
  assert.match(urls[0], /requestid=retry-key-1/);
  assert.doesNotMatch(urls[0], /^https:\/\/quickbooks\.api\.intuit\.com/);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(first.ids.id, '55');
  const posted = audits.filter((entry) => entry.ok && entry.qboIds.id === '55');
  assert.equal(posted.length, 2);
  assert.equal(posted[0].actor, 'bookkeeper');
  assert.equal(posted[0].tool, 'qbo_journal_entry');
  assert.equal(posted[0].confirmed, true);
  assert.equal(posted[0].dryRun, false);
});

test('a failed audit blocks the post', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return json({});
  };
  await assert.rejects(
    () =>
      runQboWrite(
        'qbo_journal_entry',
        { ...journal, confirm: true },
        {
          fetchImpl,
          env: SANDBOX,
          productionRealmId: '9130349321543166',
          accessToken: 'tok',
          audit: async () => {
            throw new Error('audit log down');
          },
        }
      ),
    /audit log down/
  );
  assert.equal(calls, 0);
});

test('omitted request ids match for the same payload', async () => {
  const a = await runQboWrite('qbo_journal_entry', journal, { env: {} });
  const b = await runQboWrite('qbo_journal_entry', journal, { env: {} });
  const c = await runQboWrite(
    'qbo_journal_entry',
    { ...journal, lines: [{ postingType: 'Debit', amount: 11, accountId: '80' }, { postingType: 'Credit', amount: 11, accountId: '35' }] },
    { env: {} }
  );
  assert.equal(a.requestId, b.requestId);
  assert.notEqual(a.requestId, c.requestId);
});

test('void confirm sends operation=void and keeps the reason on the audit', async () => {
  const urls: string[] = [];
  const audits: QboAuditEntry[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    urls.push(String(url));
    assert.equal(init?.method, 'POST');
    return json({ Invoice: { Id: '44', SyncToken: '3' } });
  };
  const result = await runQboWrite(
    'qbo_void',
    { entityType: 'Invoice', entityId: '44', syncToken: '2', reason: 'duplicate backfill', confirm: true },
    {
      fetchImpl,
      env: SANDBOX,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async (entry) => {
        audits.push(entry);
      },
    }
  );
  assert.equal(result.wrote, true);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /operation=void/);
  assert.doesNotMatch(urls[0], /operation=delete/);
  assert.equal(audits.at(-1)?.reason, 'duplicate backfill');
});

test('categorize preview does not fetch, and confirm posts the account change', async () => {
  let calls = 0;
  const preview = await runQboWrite(
    'qbo_categorize_purchase',
    { id: '5', lines: [{ lineId: '1', accountId: '80' }] },
    {
      env: SANDBOX,
      fetchImpl: async () => {
        calls += 1;
        return json({});
      },
    }
  );
  assert.equal(calls, 0);
  assert.equal(preview.http.body, null);
  assert.deepEqual(preview.changes, { id: '5', syncToken: null, lines: [{ lineId: '1', accountId: '80' }], privateNote: null });

  const methods: string[] = [];
  const posted: unknown[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    methods.push(init?.method || 'GET');
    if ((init?.method || 'GET') === 'GET') {
      return json({
        Purchase: {
          Id: '5',
          SyncToken: '3',
          MetaData: { CreateTime: 'x' },
          Line: [{ Id: '1', Amount: 10, AccountBasedExpenseLineDetail: { AccountRef: { value: '9' } } }],
        },
      });
    }
    posted.push(JSON.parse(String(init?.body)));
    return json({ Purchase: { Id: '5', SyncToken: '4' } });
  };
  const result = await runQboWrite(
    'qbo_categorize_purchase',
    { id: '5', lines: [{ lineId: '1', accountId: '80' }], confirm: true },
    {
      fetchImpl,
      env: SANDBOX,
      productionRealmId: '9130349321543166',
      accessToken: 'tok',
      audit: async () => {},
    }
  );
  assert.deepEqual(methods, ['GET', 'POST']);
  const body = posted[0] as { Line: { AccountBasedExpenseLineDetail: { AccountRef: { value: string } } }[]; MetaData?: unknown };
  assert.equal(body.Line[0].AccountBasedExpenseLineDetail.AccountRef.value, '80');
  assert.equal(body.MetaData, undefined);
  assert.equal(result.ids.id, '5');
});

test('closing date confirm sends BookCloseDate and not a password', async () => {
  const posted: unknown[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    if (!init?.method || init.method === 'GET') {
      return json({ Preferences: { Id: '1', SyncToken: '4', AccountingInfoPrefs: { BookCloseDate: '2026-09-30' } } });
    }
    assert.match(String(url), /operation=update/);
    posted.push(JSON.parse(String(init.body)));
    return json({ Preferences: { Id: '1', SyncToken: '5', AccountingInfoPrefs: { BookCloseDate: '2026-10-31' } } });
  };
  const result = await runQboWrite(
    'qbo_closing_date',
    { closeDate: '2026-10-31', confirm: true },
    { fetchImpl, env: SANDBOX, productionRealmId: '9130349321543166', accessToken: 'tok', audit: async () => {} }
  );
  assert.equal(result.wrote, true);
  assert.equal(result.qbo && (result.qbo as { BookCloseDate: string }).BookCloseDate, '2026-10-31');
  assert.equal(JSON.stringify(posted[0]).toLowerCase().includes('password'), false);
});

test('MCP tool preview and delete refusal', async () => {
  const preview = await callJobberMcpTool('qbo_journal_entry', journal, { env: {}, actor: 'brighton' });
  assert.equal(preview.isError, undefined);
  const body = JSON.parse(preview.content[0].text);
  assert.equal(body.actor, 'brighton');
  assert.equal(body.wrote, false);
  assert.equal(body.http.body.Line.length, 2);

  const deleted = await callJobberMcpTool('qbo_delete_invoice', { id: '1' }, {});
  assert.equal(deleted.isError, true);
  assert.match(deleted.content[0].text, /delete and deactivate/);
});

test('health keeps writes off when the flag is unset', async () => {
  const health = await jobberMcpHealthBody('brighton', {} as NodeJS.ProcessEnv);
  assert.equal(health.safety.quickbooksWrites, false);
  assert.equal(health.safety.quickbooksDeletes, false);
  assert.equal(health.safety.quickbooksReadOnly, true);
  assert.equal(health.tools.includes('qbo_void'), true);
  assert.equal(health.tools.some((name) => name.startsWith('qbo_delete')), false);
});

function fakeDb(rows: Record<string, unknown>[]): SbClient & { ops: { op: string; filters: [string, string][] }[]; store: Record<string, unknown>[] } {
  const store = rows;
  const ops: { op: string; filters: [string, string][] }[] = [];
  return {
    ops,
    store,
    from() {
      const state = { op: 'select', filters: [] as [string, string][], payload: undefined as unknown };
      const builder: Record<string, unknown> = {
        select() {
          state.op = 'select';
          return builder;
        },
        insert(payload: unknown) {
          state.op = 'insert';
          state.payload = payload;
          return builder;
        },
        update(payload: unknown) {
          state.op = 'update';
          state.payload = payload;
          return builder;
        },
        eq(key: string, value: string) {
          state.filters.push([key, value]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
          ops.push({ op: state.op, filters: state.filters.slice() });
          if (state.op === 'select') {
            const data = store.filter((row) => state.filters.every(([key, value]) => String(row[key]) === String(value)));
            return Promise.resolve({ data, error: null }).then(resolve, reject);
          }
          if (state.op === 'insert') {
            store.push(state.payload as Record<string, unknown>);
            return Promise.resolve({ data: [state.payload], error: null }).then(resolve, reject);
          }
          const matched = store.filter((row) => state.filters.every(([key, value]) => String(row[key]) === String(value)));
          for (const row of matched) Object.assign(row, state.payload as object);
          return Promise.resolve({ data: matched, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('sandbox token storage never updates a production connection', async () => {
  const production = fakeDb([{ id: 'prod', realm_id: '9130349321543166', environment: 'production', access_token: 'keep' }]);
  await assert.rejects(
    () => saveSandboxToken(production, { realmId: '9130349321543166', accessToken: 'new', refreshToken: 'new', expiresAt: 'x' }, '111'),
    /production connection row/
  );
  assert.equal(production.store[0].access_token, 'keep');
  assert.equal(production.ops.some((op) => op.op === 'update' || op.op === 'insert'), false);

  const empty = fakeDb([]);
  await saveSandboxToken(empty, { realmId: '2222222222222222', accessToken: 'a', refreshToken: 'b', expiresAt: '2030-01-01T00:00:00.000Z' }, '9130349321543166');
  assert.equal(empty.store[0].environment, 'sandbox');
  assert.equal(empty.store[0].realm_id, '2222222222222222');

  const sandbox = fakeDb([{ id: 's1', realm_id: '2222222222222222', environment: 'sandbox', access_token: 'old' }]);
  await saveSandboxToken(sandbox, { realmId: '2222222222222222', accessToken: 'next', refreshToken: 'rot', expiresAt: '2030-01-01T00:00:00.000Z' }, '9130349321543166');
  const update = sandbox.ops.find((op) => op.op === 'update');
  assert.deepEqual(update?.filters, [
    ['id', 's1'],
    ['environment', 'sandbox'],
  ]);
  assert.equal(sandbox.store[0].access_token, 'next');

  const loaded = await loadSandboxToken(sandbox, '2222222222222222');
  assert.equal(loaded?.accessToken, 'next');
  const hidden = await loadSandboxToken(production, '9130349321543166');
  assert.equal(hidden, null);

  const auditDb = fakeDb([]);
  await insertQboAudit(auditDb, {
    actor: 'brighton',
    tool: 'qbo_journal_entry',
    requestId: 'retry-key-1',
    dryRun: false,
    confirmed: true,
    ok: true,
    refused: false,
    realmId: '222',
    environment: 'sandbox',
    entity: 'JournalEntry',
    payload: { amount: 1 },
    qboResponse: { JournalEntry: { Id: '9' } },
    qboIds: { id: '9' },
    error: null,
    reason: null,
  });
  assert.equal(auditDb.store[0].tool, 'qbo_journal_entry');
  assert.equal((auditDb.store[0].qbo_ids as { id: string }).id, '9');
  assert.equal(auditDb.store[0].actor, 'brighton');
});
