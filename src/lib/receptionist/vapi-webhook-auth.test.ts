import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeVapiWebhook } from './vapi-webhook-auth.ts';
import { SEND_PAY_EMAIL_TOOL, SEND_PAY_LINK_TOOL } from './vapi-tools.ts';

const SECRET = 'vapi-secret-value';

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('authorizeVapiWebhook', () => {
  it('defaults to log mode, allows a mismatch, and does not echo header values', () => {
    const lines: string[] = [];
    const decision = authorizeVapiWebhook(
      headers({ 'x-vapi-secret': 'wrong-secret-value' }),
      { VAPI_WEBHOOK_SECRET: SECRET },
      { log: (message) => lines.push(message) }
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.mode, 'log');
    assert.equal(decision.reason, 'mismatch');
    const logged = lines.join('\n');
    assert.match(logged, /auth_mode=log/);
    assert.match(logged, /reason=mismatch/);
    assert.equal(logged.includes('wrong-secret-value'), false);
    assert.equal(logged.includes(SECRET), false);
  });

  it('rejects a mismatch and a missing env when mode is enforce', () => {
    const mismatch = authorizeVapiWebhook(
      headers({ authorization: 'Bearer nope' }),
      { VAPI_WEBHOOK_SECRET: SECRET, VAPI_WEBHOOK_AUTH_MODE: 'enforce' },
      { log: () => undefined }
    );
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.status, 401);
    assert.equal(mismatch.reason, 'mismatch');

    const missing = authorizeVapiWebhook(
      headers({}),
      { VAPI_WEBHOOK_AUTH_MODE: 'enforce' },
      { log: () => undefined }
    );
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 401);
    assert.equal(missing.reason, 'secret_not_configured');
  });

  it('allows a missing env in log mode and accepts either header when the secret matches', () => {
    const lines: string[] = [];
    const missing = authorizeVapiWebhook(headers({}), {}, { log: (message) => lines.push(message) });
    assert.equal(missing.ok, true);
    assert.equal(missing.mode, 'log');
    assert.equal(missing.reason, 'secret_not_configured');
    assert.match(lines.join('\n'), /auth_mode=log/);
    assert.match(lines.join('\n'), /secret_not_configured/);

    const fromHeader = authorizeVapiWebhook(
      headers({ 'x-vapi-secret': SECRET }),
      { VAPI_WEBHOOK_SECRET: SECRET, VAPI_WEBHOOK_AUTH_MODE: 'enforce' },
      { log: () => undefined }
    );
    assert.equal(fromHeader.ok, true);
    assert.equal(fromHeader.reason, 'ok');

    const fromBearer = authorizeVapiWebhook(
      headers({ authorization: `bearer ${SECRET}` }),
      { VAPI_WEBHOOK_SECRET: SECRET, VAPI_WEBHOOK_AUTH_MODE: 'enforce' },
      { log: () => undefined }
    );
    assert.equal(fromBearer.ok, true);
    assert.equal(fromBearer.reason, 'ok');
  });

  it('skips the check when mode is off', () => {
    const decision = authorizeVapiWebhook(
      headers({ 'x-vapi-secret': 'nope' }),
      { VAPI_WEBHOOK_SECRET: SECRET, VAPI_WEBHOOK_AUTH_MODE: 'off' },
      { log: () => undefined }
    );
    assert.equal(decision.ok, true);
    assert.equal(decision.mode, 'off');
  });
});

describe('pay tool schemas', () => {
  it('does not accept a model phone, email, or payment URL', () => {
    for (const tool of [SEND_PAY_LINK_TOOL, SEND_PAY_EMAIL_TOOL]) {
      const properties = tool.parameters.properties as Record<string, unknown>;
      assert.equal('to' in properties, false);
      assert.equal('paymentUrl' in properties, false);
      assert.equal('phone' in properties, false);
      assert.equal('email' in properties, false);
      assert.equal('invoiceNumber' in properties, true);
      assert.equal('invoiceId' in properties, true);
    }
  });
});
