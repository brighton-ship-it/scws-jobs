/**
 * Opt-in sandbox integration. Skips unless QBO_WRITE_SANDBOX_TEST=true and the
 * sandbox credentials in docs/jobber-mcp.md are present. It posts a $1 journal
 * and the reversing entry to the sandbox company only.
 *
 * Not run in CI: this environment has no sandbox token.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeQboWriteGate } from './write-gate.ts';
import { runQboWrite } from './durable-write.ts';

const env = process.env;
const gate = describeQboWriteGate(env);
const enabled =
  env.QBO_WRITE_SANDBOX_TEST === 'true' &&
  gate.enabled &&
  Boolean(env.QBO_WRITE_REFRESH_TOKEN) &&
  Boolean(env.QBO_PRODUCTION_REALM_ID) &&
  env.QBO_PRODUCTION_REALM_ID !== env.QBO_WRITE_REALM_ID;

test('sandbox journal entry and reversal', { skip: enabled ? false : 'sandbox credentials are not configured' }, async () => {
  const stamp = `sandbox-${Date.now()}`;
  const created = await runQboWrite(
    'qbo_journal_entry',
    {
      confirm: true,
      requestId: `${stamp}-a`.slice(0, 40),
      txnDate: '2026-01-15',
      privateNote: 'SCWS sandbox write probe',
      docNumber: stamp.slice(0, 21),
      lines: [
        { postingType: 'Debit', amount: 1, accountId: env.QBO_SANDBOX_DEBIT_ACCOUNT_ID, description: 'probe' },
        { postingType: 'Credit', amount: 1, accountId: env.QBO_SANDBOX_CREDIT_ACCOUNT_ID, description: 'probe' },
      ],
    },
    { env, actor: 'sandbox-test' }
  );
  assert.equal(created.wrote, true, created.error);
  assert.equal(created.target.realmId, env.QBO_WRITE_REALM_ID);
  assert.notEqual(created.target.realmId, env.QBO_PRODUCTION_REALM_ID);

  const reversed = await runQboWrite(
    'qbo_journal_entry',
    {
      confirm: true,
      requestId: `${stamp}-b`.slice(0, 40),
      txnDate: '2026-01-15',
      privateNote: 'SCWS sandbox write probe reversal',
      lines: [
        { postingType: 'Credit', amount: 1, accountId: env.QBO_SANDBOX_DEBIT_ACCOUNT_ID },
        { postingType: 'Debit', amount: 1, accountId: env.QBO_SANDBOX_CREDIT_ACCOUNT_ID },
      ],
    },
    { env, actor: 'sandbox-test' }
  );
  assert.equal(reversed.wrote, true, reversed.error);
});
