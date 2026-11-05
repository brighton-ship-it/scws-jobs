import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeQboWriteGate, qboWritesFlagOn } from './write-gate.ts';

test('writes are off unless the flag is exactly true', () => {
  assert.equal(qboWritesFlagOn({}), false);
  assert.equal(qboWritesFlagOn({ QBO_WRITES_ENABLED: '1' }), false);
  assert.equal(qboWritesFlagOn({ QBO_WRITES_ENABLED: 'yes' }), false);
  assert.equal(qboWritesFlagOn({ QBO_WRITES_ENABLED: 'true' }), true);
  const off = describeQboWriteGate({});
  assert.equal(off.enabled, false);
  assert.match(off.blockedReason || '', /off/);
});

test('production environment and the production realm are refused', () => {
  const productionHost = describeQboWriteGate({
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_ENVIRONMENT: 'production',
    QBO_WRITE_REALM_ID: '2222222222222222',
  });
  assert.equal(productionHost.enabled, false);
  assert.match(productionHost.blockedReason || '', /sandbox/);

  const sameRealm = describeQboWriteGate({
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '9130349321543166',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  });
  assert.equal(sameRealm.enabled, false);
  assert.match(sameRealm.blockedReason || '', /production company/);

  const sandbox = describeQboWriteGate({
    QBO_WRITES_ENABLED: 'true',
    QBO_WRITE_REALM_ID: '2222222222222222',
    QBO_PRODUCTION_REALM_ID: '9130349321543166',
  });
  assert.equal(sandbox.enabled, true);
  assert.equal(sandbox.environment, 'sandbox');
  assert.equal(sandbox.realmId, '2222222222222222');
  assert.match(sandbox.baseUrl, /^https:\/\/sandbox-quickbooks\.api\.intuit\.com$/);
});
