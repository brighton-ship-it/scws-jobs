import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMissedCallTextView, deliveryLabel, ptStamp, type TextLogRow } from './missed-call-text-feed.ts';
import { recordInboundSms, saveDeliveryStatus, threadWithInbound } from '../receptionist/missed-call-inbound.ts';
import { refreshDeliveries, resetDeliveryColumnCache } from './missed-call-text-data.ts';

const SINCE = Date.parse('2026-10-01T00:00:00Z');
const SENT = '2026-10-19T17:00:00.000Z'; // 10:00 AM PT

function row(over: Partial<TextLogRow> = {}): TextLogRow {
  return {
    id: 't1', caller_phone: '6195550142', called_number: '+17603312502', customer_name: 'Pat Lee',
    missed_at: '2026-10-19T16:50:00.000Z', sent_at: SENT, outcome: 'sent',
    body: 'Hi, this is Mike with Southern California Well Service.', thread_status: 'open', thread: [
      { role: 'assistant', content: 'Hi, this is Mike with Southern California Well Service.', at: SENT },
    ],
    twilio_message_sid: 'SM1', delivery_status: 'delivered', ...over,
  };
}

describe('missed-call text dashboard view', () => {
  it('formats Pacific time and delivery status', () => {
    assert.equal(ptStamp(SENT), 'Oct 19, 10:00 AM PT');
    assert.deepEqual(deliveryLabel('sent', 'delivered', null), { label: 'Delivered', tone: 'ok' });
    assert.deepEqual(deliveryLabel('sent', 'undelivered', '30005'), { label: 'Undelivered · 30005', tone: 'bad' });
    assert.deepEqual(deliveryLabel('failed', null, null), { label: 'Not sent', tone: 'bad' });
    assert.deepEqual(deliveryLabel('sent', null, null), { label: 'Sent', tone: 'wait' });
  });

  it('lists the text, every reply, the line, and a Jobber link when Mike booked', () => {
    const gid = Buffer.from('gid://Jobber/Job/159691229').toString('base64');
    const view = buildMissedCallTextView({
      sinceMs: SINCE,
      rows: [row({
        thread_status: 'booked',
        thread: [
          { role: 'assistant', content: 'Sorry we missed your call.', at: SENT },
          { role: 'user', content: 'No water in Ramona', at: '2026-10-19T17:05:00.000Z' },
          { role: 'user', content: 'Yes Thursday works', at: '2026-10-19T17:20:00.000Z' },
          { role: 'tool', name: 'book_job', content: JSON.stringify({ booked: true, visit: { jobId: gid, jobNumber: 4401 } }), at: '2026-10-19T17:21:00.000Z' },
        ],
      })],
      extraReplies: [
        { phone: '+16195550142', at: '2026-10-19T17:05:30.000Z', body: 'No water in Ramona', sid: 'IN1' },
        { phone: '+16195550142', at: '2026-10-19T18:00:00.000Z', body: 'Gate code is 1234', sid: 'IN2' },
      ],
    });
    assert.equal(view.sent, 1);
    assert.equal(view.replied, 1);
    assert.equal(view.replyRate, 1);
    assert.equal(view.booked, 1);
    assert.equal(view.rows[0].timeLabel, 'Oct 19, 10:00 AM PT');
    assert.equal(view.rows[0].line, 'Google Ads (760) 331-2502');
    assert.equal(view.rows[0].phoneDisplay, '(619) 555-0142');
    assert.equal(view.rows[0].name, 'Pat Lee');
    assert.deepEqual(view.rows[0].replies.map((r) => r.body), ['No water in Ramona', 'Yes Thursday works', 'Gate code is 1234']);
    assert.equal(view.rows[0].booked, true);
    assert.equal(view.rows[0].jobUrl, 'https://secure.getjobber.com/jobs/159691229');
    assert.equal(view.rows[0].jobLabel, 'Job #4401');
    assert.equal(view.rows[0].delivery, 'Delivered');
  });

  it('summarizes reply rate and does not count a text outside the range or a send that failed', () => {
    const view = buildMissedCallTextView({
      sinceMs: Date.parse('2026-10-19T00:00:00Z'),
      rows: [
        row({ id: 'a' }),
        row({ id: 'b', caller_phone: '6195550199', customer_name: null, thread: [{ role: 'assistant', content: 'Hi', at: SENT }], thread_status: 'open' }),
        row({ id: 'old', sent_at: '2026-09-01T17:00:00.000Z', missed_at: '2026-09-01T16:00:00.000Z' }),
        row({ id: 'bad', outcome: 'failed', sent_at: null, body: 'Hi', thread_status: null, thread: [], delivery_status: null }),
      ],
      extraReplies: [{ phone: '6195550142', at: '2026-10-19T18:00:00.000Z', body: 'Pump is out', sid: 'IN9' }],
    });
    assert.equal(view.sent, 2);
    assert.equal(view.replied, 1);
    assert.equal(view.replyRate, 0.5);
    assert.equal(view.booked, 0);
    assert.equal(view.failed, 1);
    assert.equal(view.rows.some((r) => r.id === 'old'), false);
    assert.equal(view.rows.find((r) => r.id === 'a')?.replies[0].body, 'Pump is out');
    assert.equal(view.rows.find((r) => r.id === 'b')?.booked, false);
    assert.equal(view.rows.find((r) => r.id === 'bad')?.delivery, 'Not sent');
  });

  it('links the Jobber job created after a text booking when the thread has no id', () => {
    const view = buildMissedCallTextView({
      sinceMs: SINCE,
      rows: [row({ thread_status: 'booked', thread: [{ role: 'user', content: 'Book me', at: '2026-10-19T17:10:00.000Z' }] })],
      jobs: [
        { phone: '6195550142', id: 'earlier', jobNumber: 1, createdAt: '2026-10-18T17:00:00.000Z' },
        { phone: '6195550142', id: '4401', jobNumber: 4401, createdAt: '2026-10-19T17:30:00.000Z' },
      ],
    });
    assert.equal(view.booked, 1);
    assert.equal(view.rows[0].jobUrl, 'https://secure.getjobber.com/jobs/4401');
    assert.equal(view.rows[0].jobLabel, 'Job #4401');
  });
});

function memoryDb(row: { id: string; thread: unknown } | null) {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    from() {
      const state = {
        select() { return state; },
        eq() { return state; },
        order() { return state; },
        limit: async () => ({ data: row ? [row] : [], error: null }),
        update(patch: Record<string, unknown>) {
          return { eq: async () => { updates.push(patch); return { error: null }; } };
        },
      };
      return state;
    },
  };
}

describe('inbound SMS persistence', () => {
  it('appends a reply without changing thread status and skips a duplicate', async () => {
    const db = memoryDb({ id: 't1', thread: [{ role: 'assistant', content: 'Hi', at: SENT }] });
    const now = new Date('2026-10-19T17:05:00.000Z');
    assert.equal(await recordInboundSms(db, { from: '+16195550142', body: 'No water', sid: 'IN1', now }), 'saved');
    assert.equal(db.updates.length, 1);
    assert.equal('thread_status' in db.updates[0], false);
    const thread = db.updates[0].thread as Array<{ role: string; content: string; sid?: string }>;
    assert.equal(thread.at(-1)?.content, 'No water');
    assert.equal(thread.at(-1)?.sid, 'IN1');
    const again = memoryDb({ id: 't1', thread });
    assert.equal(await recordInboundSms(again, { from: '+16195550142', body: 'No water', sid: 'IN1', now }), 'duplicate');
    assert.equal(again.updates.length, 0);
  });

  it('stamps a sid onto the reply the text agent already stored', () => {
    const next = threadWithInbound(
      [{ role: 'user', content: 'No water', at: '2026-10-19T17:05:00.000Z' }],
      { body: 'No water', at: '2026-10-19T17:05:01.000Z', sid: 'IN1' },
    );
    assert.equal(next.changed, true);
    assert.equal(next.thread.length, 1);
    assert.equal(next.thread[0].sid, 'IN1');
  });

  it('stores a delivery receipt and does not invent a row', async () => {
    const db = memoryDb(null);
    assert.equal(await saveDeliveryStatus(db, { sid: 'SM1', status: 'Delivered', error: null, now: new Date(SENT) }), 'saved');
    assert.equal(db.updates[0].delivery_status, 'delivered');
    assert.equal(await saveDeliveryStatus(db, { sid: '', status: 'delivered', error: null, now: new Date(SENT) }), 'ignored');
  });
});

describe('delivery refresh', () => {
  it('reads Twilio with GET and does not send', async () => {
    resetDeliveryColumnCache();
    const calls: Array<{ method: string; url: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method || 'GET', url });
      return new Response(JSON.stringify({ status: 'delivered', error_code: null }), { status: 200 });
    }) as unknown as typeof fetch;
    const db = memoryDb(null);
    const got = await refreshDeliveries([
      row({ delivery_status: null }),
    ], { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok' } as unknown as NodeJS.ProcessEnv, fetchImpl, db, Date.parse('2026-10-19T18:00:00.000Z'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'GET');
    assert.match(calls[0].url, /\/Messages\/SM1\.json$/);
    assert.equal(got.t1.status, 'delivered');
    assert.equal(db.updates[0].delivery_status, 'delivered');
    resetDeliveryColumnCache();
  });
});
