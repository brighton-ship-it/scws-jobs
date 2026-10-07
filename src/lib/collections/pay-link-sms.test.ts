import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAllowedPayLink,
  selectPayLink,
  selectSmsPhone,
  type CollectionsPhone,
} from './policy.ts';
import { sendInvoicePayLinkSms, type CollectionsInvoice } from './pay-link-sms.ts';

const LINK = 'https://clienthub.getjobber.com/client_hubs/abc/invoices/100?token=SUPERSECRET';
const MODEL_PHONE = '7602195877';
const MODEL_URL = 'https://evil.example/steal?token=MODEL';

function invoice(phones: CollectionsPhone[], overrides: Partial<CollectionsInvoice> = {}): CollectionsInvoice {
  return {
    id: 'inv-1',
    invoiceNumber: '100',
    invoiceStatus: 'awaiting_payment',
    balance: 80,
    dueDate: '2026-01-01',
    paymentUrl: LINK,
    publicUrl: 'https://secure.getjobber.com/client_hubs/abc',
    client: {
      id: 'client-1',
      firstName: 'Pat',
      lastName: 'Example',
      companyName: null,
      isCompany: false,
      phones,
      emails: [{ address: 'pat@example.com', primary: true }],
    },
    ...overrides,
  };
}

describe('selectSmsPhone', () => {
  it('prefers the single Mobile number', () => {
    const selected = selectSmsPhone([
      { number: '7605550101', description: 'Main', primary: true, smsAllowed: true },
      { number: '(760) 555-0100', description: 'Mobile', primary: false, smsAllowed: true },
    ]);
    assert.equal(selected.ok, true);
    if (selected.ok) assert.equal(selected.e164, '+17605550100');
  });

  it('uses the primary number when there is no single Mobile', () => {
    const selected = selectSmsPhone([
      { number: '7605550102', description: 'Work', primary: false, smsAllowed: true },
      { number: '7605550103', description: 'Home', primary: true, smsAllowed: true },
    ]);
    assert.equal(selected.ok, true);
    if (selected.ok) assert.equal(selected.e164, '+17605550103');
  });

  it('refuses two Mobiles as ambiguous', () => {
    const selected = selectSmsPhone([
      { number: '7605550100', description: 'Mobile', smsAllowed: true },
      { number: '7605550101', description: 'MOBILE', smsAllowed: true },
    ]);
    assert.deepEqual(selected, { ok: false, reason: 'ambiguous_phone' });
  });

  it('refuses when there is no phone', () => {
    assert.deepEqual(selectSmsPhone([]), { ok: false, reason: 'no_phone' });
    assert.deepEqual(selectSmsPhone(undefined), { ok: false, reason: 'no_phone' });
  });

  it('refuses when every number has smsAllowed false', () => {
    const selected = selectSmsPhone([
      { number: '7605550100', description: 'Mobile', primary: true, smsAllowed: false },
    ]);
    assert.deepEqual(selected, { ok: false, reason: 'sms_not_allowed' });
  });

  it('skips a Mobile that is not sms-allowed and uses the primary', () => {
    const selected = selectSmsPhone([
      { number: '7605550100', description: 'Mobile', smsAllowed: false },
      { number: '7605550104', description: 'Main', primary: true, smsAllowed: true },
    ]);
    assert.equal(selected.ok, true);
    if (selected.ok) assert.equal(selected.e164, '+17605550104');
  });
});

describe('pay link host allow-list', () => {
  it('accepts only https client hub and secure Jobber hosts', () => {
    assert.equal(isAllowedPayLink('https://clienthub.getjobber.com/hubs/abc'), true);
    assert.equal(isAllowedPayLink('https://secure.getjobber.com/pay/abc?token=secret'), true);
    assert.equal(isAllowedPayLink('http://clienthub.getjobber.com/hubs/abc'), false);
    assert.equal(isAllowedPayLink('https://evil.example/pay'), false);
    assert.equal(isAllowedPayLink('https://getjobber.com/pay'), false);
    assert.equal(isAllowedPayLink('https://clienthub.getjobber.com.evil.com/pay'), false);
    assert.equal(selectPayLink('https://evil.example/nope', 'https://secure.getjobber.com/ok'), 'https://secure.getjobber.com/ok');
    assert.equal(selectPayLink('', ''), null);
  });
});

describe('sendInvoicePayLinkSms', () => {
  it('ignores any model phone or URL and does not log either', async () => {
    const logs: string[] = [];
    let sentTo = '';
    let sentBody = '';
    const result = await sendInvoicePayLinkSms(
      { invoiceNumber: '100', to: MODEL_PHONE, paymentUrl: MODEL_URL } as { invoiceNumber: string },
      {
        dryRun: false,
        deps: {
          loadInvoice: async () => invoice([{ number: '7605550100', description: 'Mobile', smsAllowed: true }]),
          sendSms: async (input) => {
            sentTo = input.to;
            sentBody = input.body;
            return { sid: 'SM1' };
          },
          log: (message) => logs.push(message),
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(result.phoneLast4, '0100');
    assert.equal(result.linkPresent, true);
    assert.equal(sentTo, '+17605550100');
    assert.match(sentBody, /token=SUPERSECRET/);
    assert.equal(sentBody.includes('evil.example'), false);
    assert.equal(sentBody.includes(MODEL_PHONE), false);
    const logged = logs.join('\n');
    assert.equal(logged.includes('SUPERSECRET'), false);
    assert.equal(logged.includes(MODEL_PHONE), false);
    assert.equal(logged.includes('+17605550100'), false);
    assert.match(logged, /last4=0100/);
    assert.match(logged, /host=clienthub\.getjobber\.com/);
  });

  it('defaults to dryRun and does not send', async () => {
    let called = false;
    const result = await sendInvoicePayLinkSms(
      { invoiceNumber: '100' },
      {
        deps: {
          loadInvoice: async () => invoice([{ number: '7605550100', description: 'Mobile', smsAllowed: true }]),
          sendSms: async () => {
            called = true;
            return { sid: 'SM1' };
          },
        },
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.dryRun, true);
    assert.equal(called, false);
  });

  it('refuses unpaid statuses and a zero balance', async () => {
    const draft = await sendInvoicePayLinkSms(
      { invoiceId: 'inv-1' },
      { deps: { loadInvoice: async () => invoice([{ number: '7605550100', description: 'Mobile' }], { invoiceStatus: 'draft' }) } }
    );
    assert.equal(draft.reason, 'invoice_status');

    const badDebt = await sendInvoicePayLinkSms(
      { invoiceId: 'inv-1' },
      { deps: { loadInvoice: async () => invoice([{ number: '7605550100', description: 'Mobile' }], { invoiceStatus: 'bad_debt' }) } }
    );
    assert.equal(badDebt.reason, 'invoice_status');

    const paid = await sendInvoicePayLinkSms(
      { invoiceId: 'inv-1' },
      { deps: { loadInvoice: async () => invoice([{ number: '7605550100', description: 'Mobile' }], { invoiceStatus: 'paid', balance: 10 }) } }
    );
    assert.equal(paid.reason, 'invoice_status');

    const zero = await sendInvoicePayLinkSms(
      { invoiceId: 'inv-1' },
      { deps: { loadInvoice: async () => invoice([{ number: '7605550100', description: 'Mobile' }], { balance: 0 }) } }
    );
    assert.equal(zero.reason, 'zero_balance');
  });

  it('refuses a link that is not on the Jobber client hub', async () => {
    const result = await sendInvoicePayLinkSms(
      { invoiceNumber: '100' },
      {
        deps: {
          loadInvoice: async () =>
            invoice([{ number: '7605550100', description: 'Mobile', smsAllowed: true }], {
              paymentUrl: 'https://pay.example.com/invoice',
              publicUrl: 'http://clienthub.getjobber.com/nope',
            }),
        },
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid_link');
    assert.equal(result.linkPresent, false);
  });

  it('reads the phone from the Jobber client, not from the caller', async () => {
    const queries: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as { query?: string; variables?: Record<string, unknown> };
      queries.push(body.query || '');
      const variables = JSON.stringify(body.variables || {});
      assert.equal(variables.includes(MODEL_PHONE), false);
      assert.equal(variables.includes('evil.example'), false);
      if ((body.query || '').includes('CollectionsClient')) {
        return Response.json({
          data: {
            client: {
              id: 'Q2xpZW50LzE',
              firstName: 'Pat',
              lastName: 'Example',
              companyName: null,
              isCompany: false,
              emails: [{ address: 'pat@example.com', primary: true }],
              phones: [{ number: '7605550199', description: 'Mobile', primary: true, smsAllowed: true }],
            },
          },
        });
      }
      return Response.json({
        data: {
          invoices: {
            edges: [
              {
                cursor: 'c1',
                node: {
                  id: 'inv-jobber',
                  invoiceNumber: '1042',
                  invoiceStatus: 'awaiting_payment',
                  dueDate: '2026-01-01',
                  clientHubUri: 'https://secure.getjobber.com/client_hubs/abc/invoices/1042',
                  amounts: { invoiceBalance: 40, total: 40 },
                  client: { id: 'Q2xpZW50LzE', firstName: 'Pat', lastName: 'Example', companyName: null, emails: [{ address: 'pat@example.com' }] },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: 'c1' },
          },
        },
      });
    };

    let sentTo = '';
    const result = await sendInvoicePayLinkSms(
      { invoiceNumber: '1042' },
      {
        dryRun: false,
        deps: {
          jobber: { fetchImpl, token: 'test-token' },
          sendSms: async (input) => {
            sentTo = input.to;
            return { sid: 'SM9' };
          },
        },
      }
    );

    assert.equal(result.ok, true);
    assert.equal(sentTo, '+17605550199');
    assert.equal(queries.some((query) => query.includes('phones')), true);
    assert.equal(queries.some((query) => query.includes(MODEL_PHONE)), false);
  });
});
