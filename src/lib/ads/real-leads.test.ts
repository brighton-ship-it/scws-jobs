import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRealLeads, type LeadCall } from './real-leads.ts';

const c = (at: string, phone: string, dur: number, extra: Partial<LeadCall> = {}): LeadCall => ({ at, phone, durationSec: dur, cat: 'pump', live: false, ...extra });

test('one lead per caller; junk, existing and hang-ups excluded; booked always a lead', () => {
  const r = classifyRealLeads({
    calls: [
      c('2026-10-01T17:00:00Z', '7605550001', 0),            // missed...
      c('2026-10-01T18:00:00Z', '7605550001', 120),          // ...then reached -> lead (first call) + 1 repeat
      c('2026-10-02T18:00:00Z', '7605550001', 60),
      c('2026-10-02T18:00:00Z', '8005551234', 40),           // toll-free -> spam
      c('2026-10-03T18:00:00Z', '7605550002', 90),           // existing customer
      c('2026-10-03T19:00:00Z', '7605550003', 4),            // hang-up never reached
      c('2026-10-04T19:00:00Z', '7605550004', 5, { cat: 'drilling' }), // short but booked -> lead
      c('2026-10-04T20:00:00Z', '7605550005', 70, { live: true, cat: null, text: 'Caller from a marketing company offering SEO services' }),
      c('2026-10-05T20:00:00Z', '6193208264', 70),           // staff
    ],
    firstJobAt: new Map([['7605550002', Date.parse('2025-05-01T00:00:00Z')], ['7605550001', null]]),
    booked: new Map([['7605550004', 'drilling' as const]]),
  });
  assert.deepEqual(r.leads.map((l) => l.phone).sort(), ['7605550001', '7605550004']);
  const n = (k: string) => r.reasons.filter((x) => x.reason === k).length;
  assert.equal(n('lead'), 2); assert.equal(n('missed_later_reached') + n('repeat'), 2);
  assert.equal(n('spam'), 2); assert.equal(n('existing'), 1); assert.equal(n('hangup'), 1); assert.equal(n('internal'), 1);
  assert.equal(r.leads.find((l) => l.phone === '7605550004')!.cat, 'drilling');
});

test('owner/test caller exclusion: flags Brighton cell and the Twilio test line in any format, but not customers', async () => {
  const { isExcludedCaller, isTestCallerPhone, isOwnNumber } = await import('./real-leads.ts');
  for (const p of ['+14083181171', '4083181171', '(408) 318-1171', '+17608237963']) assert.equal(isExcludedCaller(p), true, p);
  assert.equal(isTestCallerPhone('+19515513430'), false);
  assert.equal(isExcludedCaller('+19515513430'), false);
  // Mike/callback paths still see Brighton's cell as a normal caller.
  assert.equal(isOwnNumber('+14083181171'), false);
});
