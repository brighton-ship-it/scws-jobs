import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildRestatement, nextRestatement, sentStateOf, stageValues } from './conversion-stages.ts';
import { candidatesFromBookedJobs, type BookedJobInput } from './booked-jobs.ts';

const anchor = Date.parse('2026-10-01T17:00:00.000Z');
const inv = (id: string, sub: number, issued = '2026-10-20') => ({
  id,
  invoiceStatus: 'awaiting_payment',
  issuedDate: issued,
  amounts: { subtotal: sub, total: sub * 1.0775, taxAmount: sub * 0.0775 },
});

describe('stageValues', () => {
  it('booking only', () => {
    assert.deepEqual(stageValues({ bookingValue: 200, anchorMs: anchor, quotes: [], invoices: [] }), {
      booking: 200,
      approved: null,
      invoiced: null,
    });
  });
  it('sums approved/converted quotes created after the signal, ignores drafts and old quotes', () => {
    const s = stageValues({
      bookingValue: 200,
      anchorMs: anchor,
      quotes: [
        { id: 'a', status: 'converted', createdAt: '2026-10-02T00:00:00Z', subtotal: 200 },
        { id: 'b', status: 'approved', createdAt: '2026-10-05T00:00:00Z', subtotal: 4000 },
        { id: 'c', status: 'draft', createdAt: '2026-10-05T00:00:00Z', subtotal: 9000 },
        { id: 'd', status: 'approved', createdAt: '2026-02-05T00:00:00Z', subtotal: 7000 },
      ],
      invoices: [],
    });
    assert.equal(s.approved, 4200);
  });
  it('invoiced uses pretax subtotals, dedupes, and never drops below the earlier stage', () => {
    const s = stageValues({
      bookingValue: 200,
      anchorMs: anchor,
      quotes: [{ id: 'b', status: 'approved', createdAt: '2026-10-05T00:00:00Z', subtotal: 4000 }],
      invoices: [inv('i1', 3000), inv('i1', 3000), { ...inv('i2', 500), invoiceStatus: 'draft' }],
    });
    assert.equal(s.invoiced, 4000); // invoice 3000 < approved 4000: not reduced
    const s2 = stageValues({ bookingValue: 200, anchorMs: anchor, quotes: [], invoices: [inv('i1', 3000), inv('i2', 1722.5)] });
    assert.equal(s2.invoiced, 4722.5);
  });
});

describe('nextRestatement', () => {
  const stages = { booking: 200, approved: 4000, invoiced: 4722.5 };
  it('jumps straight to the highest stage that beats what was sent', () => {
    assert.deepEqual(nextRestatement(stages, { stage: 1, value: 200 }), { stage: 3, name: 'invoiced', value: 4722.5 });
    assert.deepEqual(nextRestatement({ ...stages, invoiced: null }, { stage: 1, value: 200 }), {
      stage: 2,
      name: 'approved',
      value: 4000,
    });
  });
  it('never reduces or repeats', () => {
    assert.equal(nextRestatement(stages, { stage: 3, value: 4722.5 }), null);
    assert.equal(nextRestatement({ booking: 200, approved: 150, invoiced: null }, { stage: 1, value: 200 }), null);
    assert.equal(nextRestatement(stages, { stage: 3, value: 5000 }), null);
    assert.equal(nextRestatement({ ...stages, invoiced: null }, { stage: 2, value: 4000 }), null);
  });
});

describe('sentStateOf / buildRestatement', () => {
  it('reads stored state and falls back to legacy value_usd', () => {
    assert.deepEqual(sentStateOf({ payload: { sent_stage: 2, sent_value: 4000 } }), { stage: 2, value: 4000 });
    assert.deepEqual(sentStateOf({ value_usd: '200', payload: { order_id: 'x' } }), { stage: 1, value: 200 });
    assert.equal(sentStateOf(undefined), null);
  });
  it('builds a RESTATEMENT keyed on order_id', () => {
    const a = buildRestatement('customers/1/conversionActions/2', {
      jobberJobId: 'job1',
      value: 4722.5,
      nowIso: '2026-10-20T20:00:00.000Z',
      hashedPhone: 'abc',
    });
    assert.equal(a.adjustment_type, 'RESTATEMENT');
    assert.equal(a.order_id, 'job1');
    assert.equal(a.restatement_value.adjusted_value, 4722.5);
    assert.equal(a.adjustment_date_time, '2026-10-20 20:00:00+00:00');
    assert.deepEqual(a.user_identifiers, [{ hashed_phone_number: 'abc' }]);
  });
});

describe('candidates carry stages', () => {
  it('uses client-level quotes and invoices', () => {
    const base: BookedJobInput = {
      id: 'j1',
      createdAt: '2026-10-02T18:00:00.000Z',
      clientId: 'c1',
      phones: ['7605550100'],
      quoteSubtotal: 200,
      clientQuotes: [
        { id: 'q1', status: 'converted', createdAt: '2026-10-02T00:00:00Z', subtotal: 200 },
        { id: 'q2', status: 'approved', createdAt: '2026-10-06T00:00:00Z', subtotal: 4000 },
      ],
    };
    const drill: BookedJobInput = {
      id: 'j2',
      createdAt: '2026-10-07T18:00:00.000Z',
      clientId: 'c1',
      phones: ['7605550100'],
      quoteSubtotal: 4000,
      invoices: [inv('i1', 4722.5)],
    };
    const r = candidatesFromBookedJobs({
      jobs: [base, drill],
      leads: [],
      adsCalls: [{ phone: '7605550100', startedAt: '2026-10-01T17:00:00.000Z' }],
    });
    assert.equal(r.candidates.length, 1);
    assert.deepEqual(r.candidates[0].stages, { booking: 200, approved: 4200, invoiced: 4722.5 });
    assert.equal(r.candidates[0].valueUsd, 200);
  });
});
