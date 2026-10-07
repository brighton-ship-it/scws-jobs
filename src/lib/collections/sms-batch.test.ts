import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeCollectionsRequest } from './batch-auth.ts';
import { isCollectionsWindow, phoneHash } from './policy.ts';
import { runCollectionsSmsBatch } from './sms-batch.ts';
import { createMemoryCollectionsStore, type SentRow } from './store.ts';
import type { CollectionsInvoice } from './pay-link-sms.ts';

const TUE_10 = new Date('2026-01-13T18:00:00.000Z');
const PHONE = '+17605550100';

function makeInvoice(index: number, overrides: Partial<CollectionsInvoice> = {}): CollectionsInvoice {
  const national = String(7602000000 + index);
  return {
    id: `inv-${index}`,
    invoiceNumber: String(1000 + index),
    invoiceStatus: 'awaiting_payment',
    balance: 80,
    dueDate: '2026-01-01',
    paymentUrl: `https://clienthub.getjobber.com/client_hubs/abc/invoices/${1000 + index}`,
    publicUrl: `https://clienthub.getjobber.com/client_hubs/abc/invoices/${1000 + index}`,
    client: {
      id: `client-${index}`,
      firstName: 'Pat',
      lastName: 'Example',
      companyName: null,
      isCompany: false,
      phones: [{ number: national, description: 'Mobile', primary: true, smsAllowed: true }],
      emails: [],
    },
    ...overrides,
  };
}

function sentRow(partial: Partial<SentRow> & { phone: string; clientId: string; created_at: string }): SentRow {
  return {
    client_id: partial.clientId,
    phone_hash: phoneHash(partial.phone),
    created_at: partial.created_at,
    status: 'sent',
    error_code: partial.error_code || null,
  };
}

describe('collections send window', () => {
  it('is open Tue–Thu 10:00–17:59 Pacific, including both DST offsets', () => {
    assert.equal(isCollectionsWindow(new Date('2026-01-12T20:00:00.000Z')), false); // Mon noon PST
    assert.equal(isCollectionsWindow(new Date('2026-01-16T20:00:00.000Z')), false); // Fri noon PST
    assert.equal(isCollectionsWindow(new Date('2026-01-13T17:59:00.000Z')), false); // Tue 9:59 PST
    assert.equal(isCollectionsWindow(new Date('2026-01-13T18:00:00.000Z')), true); // Tue 10:00 PST
    assert.equal(isCollectionsWindow(new Date('2026-01-14T01:59:00.000Z')), true); // Tue 17:59 PST
    assert.equal(isCollectionsWindow(new Date('2026-01-14T02:00:00.000Z')), false); // Tue 18:00 PST
    assert.equal(isCollectionsWindow(new Date('2026-07-14T16:59:00.000Z')), false); // Tue 9:59 PDT
    assert.equal(isCollectionsWindow(new Date('2026-07-14T17:00:00.000Z')), true); // Tue 10:00 PDT
    assert.equal(isCollectionsWindow(new Date('2026-07-15T00:59:00.000Z')), true); // Tue 17:59 PDT
    assert.equal(isCollectionsWindow(new Date('2026-07-15T01:00:00.000Z')), false); // Tue 18:00 PDT
    assert.equal(isCollectionsWindow(new Date('2026-01-14T20:00:00.000Z')), true); // Wed noon PST
  });
});

describe('runCollectionsSmsBatch', () => {
  it('flags every row outside the window and still returns a preview', async () => {
    const store = createMemoryCollectionsStore();
    let sent = 0;
    const result = await runCollectionsSmsBatch(
      { invoiceIds: ['inv-1'] },
      {
        now: () => new Date('2026-01-12T18:00:00.000Z'),
        store,
        loadInvoice: async () => makeInvoice(1),
        sendSms: async () => {
          sent += 1;
          return { sid: 'SM1' };
        },
      }
    );
    assert.equal(result.outsideWindow, true);
    assert.equal(result.results[0].status, 'skipped');
    assert.equal(result.results[0].reason, 'outside_window');
    assert.match(result.results[0].message || '', /Pay here:/);
    assert.equal(sent, 0);
    assert.equal(store.smsLogs[0].status, 'skipped');
    assert.equal(store.smsLogs[0].reason, 'outside_window');
  });

  it('dry-runs by default inside the window', async () => {
    const store = createMemoryCollectionsStore();
    let sent = 0;
    const result = await runCollectionsSmsBatch(
      { invoiceNumbers: ['1001'] },
      {
        now: () => TUE_10,
        store,
        loadInvoice: async () => makeInvoice(1),
        sendSms: async () => {
          sent += 1;
          return { sid: 'SM1' };
        },
      }
    );
    assert.equal(result.dryRun, true);
    assert.equal(result.results[0].status, 'dry_run');
    assert.equal(sent, 0);
  });

  it('groups a client into one text and uses the client hub root', async () => {
    const first = makeInvoice(1, {
      client: {
        id: 'client-shared',
        firstName: 'Pat',
        lastName: 'Example',
        companyName: null,
        isCompany: false,
        phones: [{ number: '7605550100', description: 'Mobile', primary: true, smsAllowed: true }],
        emails: [],
      },
    });
    const second = makeInvoice(2, {
      invoiceNumber: '1002',
      client: first.client,
      paymentUrl: 'https://clienthub.getjobber.com/client_hubs/abc/invoices/1002',
    });
    const byId = new Map([
      [first.id, first],
      [second.id, second],
    ]);
    const store = createMemoryCollectionsStore();
    const result = await runCollectionsSmsBatch(
      { invoiceIds: [first.id, second.id] },
      {
        now: () => TUE_10,
        store,
        loadInvoice: async (ref) => byId.get(ref.invoiceId || '') || null,
      }
    );
    assert.equal(result.results.length, 1);
    assert.deepEqual(result.results[0].invoiceNumbers, ['1001', '1002']);
    assert.match(result.results[0].message || '', /https:\/\/clienthub\.getjobber\.com\/client_hubs\/abc(?!\/invoices)/);
    assert.equal((result.results[0].message || '').includes('/invoices/'), false);
  });

  it('skips do-not-text rows from the table, inbound STOP, and Twilio 21610', async () => {
    const invoice = makeInvoice(1, {
      client: {
        id: 'client-1',
        firstName: 'Pat',
        lastName: 'Example',
        companyName: null,
        isCompany: false,
        phones: [{ number: '7605550100', description: 'Mobile', primary: true, smsAllowed: true }],
        emails: [],
      },
    });
    const base = {
      now: () => TUE_10,
      loadInvoice: async () => invoice,
    };

    const table = createMemoryCollectionsStore({
      dnc: [{ phone_e164: PHONE, source: 'manual', note: null }],
    });
    const fromTable = await runCollectionsSmsBatch({ invoiceIds: ['inv-1'] }, { ...base, store: table });
    assert.equal(fromTable.results[0].reason, 'do_not_text');

    const inbound = createMemoryCollectionsStore();
    const fromStop = await runCollectionsSmsBatch(
      { invoiceIds: ['inv-1'] },
      {
        ...base,
        store: inbound,
        listTwilioOptOuts: async () => ({ stopPhones: ['760-555-0100'], error21610Phones: [] }),
      }
    );
    assert.equal(fromStop.results[0].reason, 'do_not_text');
    assert.equal(inbound.dnc[0]?.source, 'twilio_inbound_stop');

    const prior = createMemoryCollectionsStore({
      errors: [{ phone_hash: phoneHash(PHONE), error_code: '21610' }],
    });
    const fromCode = await runCollectionsSmsBatch({ invoiceIds: ['inv-1'] }, { ...base, store: prior });
    assert.equal(fromCode.results[0].reason, 'do_not_text');
  });

  it('counts at most 3 sent texts per client and per phone in 30 days', async () => {
    const recent = '2026-01-02T18:00:00.000Z';
    const old = '2025-12-01T18:00:00.000Z';
    const invoice = makeInvoice(7, {
      client: {
        id: 'client-cap',
        firstName: 'Pat',
        lastName: 'Example',
        companyName: null,
        isCompany: false,
        phones: [{ number: '7605550100', description: 'Mobile', primary: true, smsAllowed: true }],
        emails: [],
      },
    });
    const capped = createMemoryCollectionsStore({
      sent: [0, 1, 2].map(() => sentRow({ phone: PHONE, clientId: 'client-cap', created_at: recent })),
    });
    const blocked = await runCollectionsSmsBatch(
      { invoiceIds: ['inv-7'] },
      { now: () => TUE_10, store: capped, loadInvoice: async () => invoice }
    );
    assert.equal(blocked.results[0].reason, 'frequency');

    const expired = createMemoryCollectionsStore({
      sent: [0, 1, 2].map(() => sentRow({ phone: PHONE, clientId: 'client-cap', created_at: old })),
    });
    const allowed = await runCollectionsSmsBatch(
      { invoiceIds: ['inv-7'] },
      { now: () => TUE_10, store: expired, loadInvoice: async () => invoice }
    );
    assert.equal(allowed.results[0].status, 'dry_run');

    const otherClients = createMemoryCollectionsStore({
      sent: [1, 2, 3].map((n) => sentRow({ phone: PHONE, clientId: `other-${n}`, created_at: recent })),
    });
    const phoneBlocked = await runCollectionsSmsBatch(
      { invoiceIds: ['inv-7'] },
      { now: () => TUE_10, store: otherClients, loadInvoice: async () => invoice }
    );
    assert.equal(phoneBlocked.results[0].reason, 'frequency');
  });

  it('stops a fourth text to the same phone inside one live batch', async () => {
    const invoices = [1, 2, 3, 4].map((index) =>
      makeInvoice(index, {
        client: {
          id: `client-${index}`,
          firstName: 'Pat',
          lastName: 'Example',
          companyName: null,
          isCompany: false,
          phones: [{ number: '7605550100', description: 'Mobile', primary: true, smsAllowed: true }],
          emails: [],
        },
      })
    );
    const byId = new Map(invoices.map((item) => [item.id, item]));
    const store = createMemoryCollectionsStore();
    let sends = 0;
    const result = await runCollectionsSmsBatch(
      { invoiceIds: invoices.map((item) => item.id), dryRun: false },
      {
        now: () => TUE_10,
        store,
        loadInvoice: async (ref) => byId.get(ref.invoiceId || '') || null,
        sendSms: async () => {
          sends += 1;
          return { sid: `SM${sends}` };
        },
        sleep: async () => undefined,
      }
    );
    assert.equal(sends, 3);
    assert.equal(result.results.filter((row) => row.status === 'sent').length, 3);
    assert.equal(result.results[3].reason, 'frequency');
    const blob = JSON.stringify(store.smsLogs);
    assert.equal(blob.includes('+17605550100'), false);
    assert.equal(blob.includes('7605550100'), false);
  });

  it('paces live sends and aborts on consecutive failures, failure rate, 30007, and a 21610 burst', async () => {
    const sleeps: number[] = [];
    const paceInvoices = [1, 2, 3].map((index) => makeInvoice(index));
    const paceStore = createMemoryCollectionsStore();
    await runCollectionsSmsBatch(
      { invoiceIds: paceInvoices.map((item) => item.id), dryRun: false },
      {
        now: () => TUE_10,
        store: paceStore,
        loadInvoice: async (ref) => paceInvoices.find((item) => item.id === ref.invoiceId) || null,
        sendSms: async () => ({ sid: 'SM' }),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }
    );
    assert.deepEqual(sleeps, [2000, 2000]);

    const forty = Array.from({ length: 40 }, (_v, index) => makeInvoice(index + 1));
    let consecutiveCalls = 0;
    const consecutive = await runCollectionsSmsBatch(
      { invoiceIds: forty.map((item) => item.id), dryRun: false },
      {
        now: () => TUE_10,
        store: createMemoryCollectionsStore(),
        loadInvoice: async (ref) => forty.find((item) => item.id === ref.invoiceId) || null,
        sendSms: async () => {
          consecutiveCalls += 1;
          return { error: 'nope', errorCode: '50000' };
        },
        sleep: async () => undefined,
      }
    );
    assert.equal(consecutiveCalls, 3);
    assert.equal(consecutive.abortReason, 'abort_consecutive');
    assert.equal(consecutive.results[3].reason, 'abort_consecutive');

    const ten = Array.from({ length: 10 }, (_v, index) => makeInvoice(index + 50));
    let rateCalls = 0;
    const rate = await runCollectionsSmsBatch(
      { invoiceIds: ten.map((item) => item.id), dryRun: false },
      {
        now: () => TUE_10,
        store: createMemoryCollectionsStore(),
        loadInvoice: async (ref) => ten.find((item) => item.id === ref.invoiceId) || null,
        sendSms: async () => {
          rateCalls += 1;
          if (rateCalls === 2) return { sid: 'SM2' };
          return { error: 'nope', errorCode: '50000' };
        },
        sleep: async () => undefined,
      }
    );
    assert.equal(rateCalls, 3);
    assert.equal(rate.abortReason, 'abort_failure_rate');

    const two = [makeInvoice(80), makeInvoice(81)];
    let hardCalls = 0;
    const hard = await runCollectionsSmsBatch(
      { invoiceIds: two.map((item) => item.id), dryRun: false },
      {
        now: () => TUE_10,
        store: createMemoryCollectionsStore(),
        loadInvoice: async (ref) => two.find((item) => item.id === ref.invoiceId) || null,
        sendSms: async () => {
          hardCalls += 1;
          return { error: 'filtered', errorCode: '30007' };
        },
        sleep: async () => undefined,
      }
    );
    assert.equal(hardCalls, 1);
    assert.equal(hard.abortReason, 'abort_30007');
    assert.equal(hard.results[1].reason, 'abort_30007');

    const burstInvoices = Array.from({ length: 25 }, (_v, index) => makeInvoice(index + 90));
    const burstStore = createMemoryCollectionsStore();
    let burstCalls = 0;
    const burst = await runCollectionsSmsBatch(
      { invoiceIds: burstInvoices.map((item) => item.id), dryRun: false },
      {
        now: () => TUE_10,
        store: burstStore,
        loadInvoice: async (ref) => burstInvoices.find((item) => item.id === ref.invoiceId) || null,
        sendSms: async () => {
          burstCalls += 1;
          return { error: 'unsubscribed', errorCode: '21610' };
        },
        sleep: async () => undefined,
      }
    );
    assert.equal(burstCalls, 2);
    assert.equal(burst.abortReason, 'abort_21610_burst');
    assert.equal(burst.results[2].reason, 'abort_21610_burst');
    assert.ok(burstStore.dnc.length >= 1);
  });

  it('rechecks balance immediately before a live send', async () => {
    const payable = makeInvoice(1);
    let calls = 0;
    let sent = 0;
    const result = await runCollectionsSmsBatch(
      { invoiceIds: [payable.id], dryRun: false },
      {
        now: () => TUE_10,
        store: createMemoryCollectionsStore(),
        loadInvoice: async () => {
          calls += 1;
          if (calls === 1) return payable;
          return { ...payable, invoiceStatus: 'paid', balance: 0 };
        },
        sendSms: async () => {
          sent += 1;
          return { sid: 'SM1' };
        },
      }
    );
    assert.equal(sent, 0);
    assert.equal(result.results[0].status, 'skipped');
    assert.equal(result.results[0].reason, 'invoice_status');
  });

  it('skips a client or invoice on a collection hold', async () => {
    const invoice = makeInvoice(1);
    const store = createMemoryCollectionsStore({
      holds: [{ client_id: 'client-1', invoice_number: null, phone: null, reason: 'dispute' }],
    });
    const result = await runCollectionsSmsBatch(
      { invoiceIds: [invoice.id] },
      { now: () => TUE_10, store, loadInvoice: async () => invoice }
    );
    assert.equal(result.results[0].reason, 'hold:dispute');
  });
});

describe('authorizeCollectionsRequest', () => {
  it('accepts the admin key or cron auth and rejects everyone else', () => {
    const admin = authorizeCollectionsRequest(
      { headers: new Headers({ authorization: 'Bearer admin-key' }) },
      { ADMIN_API_KEY: 'admin-key' }    );
    assert.deepEqual(admin, { ok: true, via: 'admin' });

    const cron = authorizeCollectionsRequest(
      { headers: new Headers({ authorization: 'Bearer cron-key' }) },
      { CRON_SECRET: 'cron-key' }    );
    assert.deepEqual(cron, { ok: true, via: 'cron' });

    const platform = authorizeCollectionsRequest(
      { headers: new Headers({ 'x-vercel-cron': '1' }) },
      { CRON_SECRET: 'cron-key' }    );
    assert.deepEqual(platform, { ok: true, via: 'cron' });

    const denied = authorizeCollectionsRequest(
      { headers: new Headers({ authorization: 'Bearer nope' }) },
      { ADMIN_API_KEY: 'admin-key', CRON_SECRET: 'cron-key' }    );
    assert.equal(denied.ok, false);
  });
});
