import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDismissals, isDismissed, addDismissals, removeDismissals } from './lead-dismissals.ts';
import { needsCallback } from './callbacks.ts';

describe('lead dismissals', () => {
  const list = parseDismissals({ items: [{ phone: '(619) 634-0760', through: '2026-10-13T14:28:49Z', dismissedAt: 'x', reason: 'hang-up' }, { phone: 'junk', through: 'x' }] });
  it('parses and drops bad entries', () => {
    assert.equal(list.length, 1);
    assert.equal(list[0].phone, '6196340760');
    assert.deepEqual(parseDismissals(null), []);
  });
  it('hides calls up to `through` (+60s slack) but not later calls', () => {
    assert.equal(isDismissed('+16196340760', '2026-10-13T14:28:49Z', list), true);
    assert.equal(isDismissed('6196340760', '2026-10-01T10:00:00Z', list), true);
    assert.equal(isDismissed('6196340760', '2026-10-13T14:29:30Z', list), true);
    assert.equal(isDismissed('6196340760', '2026-10-14T09:00:00Z', list), false);
    assert.equal(isDismissed('6195550100', '2026-10-13T14:28:49Z', list), false);
  });
  it('add is idempotent, keeps the latest through, and restore undoes it', () => {
    const a = addDismissals([], [{ phone: '(760) 750-5006', at: '2026-10-05T17:56:00Z' }, { phone: 'bad', at: 'x' }], 'office', new Date('2026-10-17T19:00:00Z'));
    assert.equal(a.added, 1); assert.equal(a.invalid.length, 1);
    const b = addDismissals(a.list, [{ phone: '7607505006', at: '2026-10-01T00:00:00Z' }], 'office');
    assert.equal(b.list.length, 1); assert.equal(b.list[0].through, '2026-10-05T17:56:00.000Z');
    const r = removeDismissals(b.list, ['(760) 750-5006']);
    assert.equal(r.removed, 1); assert.equal(r.list.length, 0);
  });
  it('needsCallback skips dismissed callers and shows them again after a newer call', () => {
    const cand = (phone: string, at: string) => ({ at, phone, name: null, line: 'Mike', outcome: 'ai', durationSeconds: 60, ringSeconds: null, aiBooked: false, spam: false, vendor: false } as any);
    const base = { sources: [], work: new Map(), fromMs: Date.parse('2026-09-18T07:00:00Z'), now: new Date('2026-10-17T19:00:00Z') };
    const before = needsCallback({ ...base, candidates: [cand('6196340760', '2026-10-13T14:28:49Z'), cand('7605550101', '2026-10-12T14:00:00Z')] });
    assert.equal(before.leads.rows.length, 2);
    const after = needsCallback({ ...base, dismissed: list, candidates: [cand('6196340760', '2026-10-13T14:28:49Z'), cand('7605550101', '2026-10-12T14:00:00Z')] });
    assert.deepEqual(after.leads.rows.map((r) => r.phone), ['(760) 555-0101']);
    const again = needsCallback({ ...base, dismissed: list, candidates: [cand('6196340760', '2026-10-15T14:00:00Z')] });
    assert.equal(again.leads.rows.length, 1);
  });
});
