import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertReadOnlyQuery, sanitizeReportParams, needsRefresh, runQboReport } from './durable-read.ts';

test('query guard allows only single SELECT', () => {
  assert.equal(assertReadOnlyQuery(' select * from Invoice '), 'select * from Invoice');
  assert.throws(() => assertReadOnlyQuery('delete from Invoice'));
  assert.throws(() => assertReadOnlyQuery('select * from Invoice; select 1'));
});
test('report params validated', () => {
  assert.deepEqual(sanitizeReportParams({ start_date: '2025-10-01', accounting_method: 'Accrual', x: '' }), { start_date: '2025-10-01', accounting_method: 'Accrual' });
  assert.throws(() => sanitizeReportParams({ start_date: '10/1/2025' }));
  assert.throws(() => sanitizeReportParams({ 'Bad-Name': 'x' }));
});
test('needsRefresh', () => {
  assert.equal(needsRefresh({ token_expires_at: new Date(Date.now() + 3600_000).toISOString() }), false);
  assert.equal(needsRefresh({ token_expires_at: new Date(Date.now() + 60_000).toISOString() }), true);
});
test('unknown report rejected before any network', async () => {
  await assert.rejects(runQboReport('DeleteEverything', {}, {}));
});
