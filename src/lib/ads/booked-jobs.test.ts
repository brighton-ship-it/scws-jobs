import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bookedValue, candidatesFromBookedJobs, type BookedJobInput } from './booked-jobs.ts';
import { planOfflineRows } from './offline-import.ts';

const call = (phone: string, startedAt: string) => ({ phone, startedAt });
const job = (p: Partial<BookedJobInput> & { id: string }): BookedJobInput => ({
  createdAt: '2026-10-02T18:00:00.000Z',
  clientId: `c-${p.id}`,
  phones: ['(760) 555-0100'],
  quoteSubtotal: 1000,
  ...p,
});

describe('booked-time candidates', () => {
  it('counts a new customer when the ad call precedes the job', () => {
    const r = candidatesFromBookedJobs({
      jobs: [job({ id: 'j1' })],
      leads: [],
      adsCalls: [call('7605550100', '2026-10-01T17:00:00.000Z')],
    });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0].valueUsd, 1000);
    assert.equal(r.candidates[0].conversionAt, '2026-10-02T18:00:00.000Z');
    assert.equal(r.candidates[0].signal, 'ads_call');
  });

  it('skips jobs before Sep 18, ad call after the job, and no signal', () => {
    const r = candidatesFromBookedJobs({
      jobs: [
        job({ id: 'old', createdAt: '2026-09-10T18:00:00.000Z', phones: ['7605550101'] }),
        job({ id: 'late', phones: ['7605550102'] }),
        job({ id: 'none', phones: ['7605550103'] }),
      ],
      leads: [],
      adsCalls: [call('7605550101', '2026-09-09T00:00:00.000Z'), call('7605550102', '2026-10-05T00:00:00.000Z')],
    });
    assert.equal(r.candidates.length, 0);
    assert.deepEqual(r.excluded.map((e) => e.reason).sort(), ['no_ads_signal', 'signal_after_job']);
  });

  it('skips an existing client with earlier work, even an invoice only', () => {
    const r = candidatesFromBookedJobs({
      jobs: [
        job({ id: 'earlier', createdAt: '2026-02-01T18:00:00.000Z', clientId: 'x' }),
        job({ id: 'now', clientId: 'x' }),
        job({
          id: 'inv-old',
          clientId: 'y',
          phones: ['7605550200'],
          createdAt: '2026-10-01T20:00:00.000Z',
          invoices: [{ invoiceStatus: 'paid', issuedDate: '2026-09-30', amounts: { subtotal: 50 } }],
        }),
        job({ id: 'inv-new', clientId: 'y', phones: ['7605550200'], createdAt: '2026-10-03T18:00:00.000Z' }),
      ],
      leads: [],
      adsCalls: [call('7605550100', '2026-10-01T17:00:00.000Z'), call('7605550200', '2026-10-02T17:00:00.000Z')],
    });
    assert.equal(r.candidates.length, 0);
    assert.ok(r.excluded.some((e) => e.jobId === 'now' && e.reason === 'existing_client'));
    assert.ok(r.excluded.some((e) => e.jobId === 'inv-new' && e.reason === 'existing_client'));
  });

  it('counts only the first booked job per new client', () => {
    const r = candidatesFromBookedJobs({
      jobs: [job({ id: 'a', clientId: 'z' }), job({ id: 'b', clientId: 'z', createdAt: '2026-10-05T18:00:00.000Z' })],
      leads: [],
      adsCalls: [call('7605550100', '2026-10-01T17:00:00.000Z')],
    });
    assert.deepEqual(r.candidates.map((c) => c.jobberJobId), ['a']);
    assert.equal(r.excluded[0].reason, 'repeat_job');
  });

  it('value: quote, then invoice pre-tax, then job total', () => {
    assert.equal(bookedValue({ id: 'a', quoteSubtotal: 900 })?.valueSource, 'quote_subtotal');
    const inv = bookedValue({ id: 'a', invoices: [{ invoiceStatus: 'sent', issuedDate: '2026-10-01', amounts: { subtotal: 400 } }] });
    assert.equal(inv?.valueSource, 'invoice_pretax');
    assert.equal(bookedValue({ id: 'a', jobTotal: 300 })?.valueSource, 'job_total');
    assert.equal(bookedValue({ id: 'a' }), null);
  });

  it('uses the job id as order_id so Google dedupes', () => {
    const r = candidatesFromBookedJobs({
      jobs: [job({ id: 'j9' })],
      leads: [{ id: 'l', source: 'booking_requests', phone: '7605550100', email: null, created_at: '2026-10-01T10:00:00.000Z', gclid: 'g1' }],
      adsCalls: [],
    });
    const plan = planOfflineRows({ candidates: r.candidates, existing: [], mode: 'dry_run', conversionAction: null });
    assert.equal(plan.rows[0].payload?.order_id, 'j9');
    assert.equal(plan.rows[0].payload?.gclid, 'g1');
    assert.equal(plan.rows[0].mode, 'dry_run');
  });
});
