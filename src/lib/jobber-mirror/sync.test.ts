import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customFieldSelectionRejected } from '../jobber/job-custom-fields.ts';
import { confirmedDeletes, goneVerdict, idsMissingFromSweep, jobPruneSpec, jobWindowId, jobsMirrorQuery, parseProgress, pruneMirrorRows, pruneSpec, Q, readyJobIds, rollingTasks, rowsFor, withSweepIds } from './sync.ts';

test('invoice rows strip nested client to id and collect client + job ids', () => {
  const r = rowsFor('invoices', [{ id: 'I1', invoiceNumber: '5806', invoiceStatus: 'paid', issuedDate: '2026-10-01T00:00:00Z', dueDate: '2026-10-15T00:00:00Z', subject: 'Pump', amounts: { subtotal: 100 }, jobs: { nodes: [{ id: 'J1', title: 'Pump repair' }] }, client: { id: 'C1', name: 'A', createdAt: '2025-02-01T00:00:00Z', phones: [{ number: '+1 (760) 555-1212' }], emails: [{ address: 'Nancy@Example.com' }, { address: 'nancy@example.com' }] } }]);
  assert.equal(r.table, 'jobber_invoices');
  assert.equal(r.rows[0].data.invoiceNumber, '5806');
  assert.equal(r.rows[0].data.dueDate, '2026-10-15T00:00:00Z');
  assert.deepEqual(r.rows[0].job_ids, ['J1']);
  assert.deepEqual(r.rows[0].data.client, { id: 'C1' });
  assert.deepEqual(r.clients[0].phones_digits, ['7605551212']);
  assert.deepEqual(r.clients[0].data.emails, ['nancy@example.com']);
});
test('job rows keep costing and the Callback custom field', () => {
  const r = rowsFor('jobs', [{ id: 'J2923', jobNumber: 2923, title: 'Service Call - no water', createdAt: '2026-10-01T00:00:00Z', completedAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', jobCosting: { totalRevenue: 8001, totalCost: 139251 }, customFields: [{ __typename: 'CustomFieldTrueFalse', label: 'Callback', valueTrueFalse: false }], client: { id: 'C1', name: 'Pat', companyName: null, createdAt: '2025-02-01T00:00:00Z', phones: [], emails: [] } }]);
  assert.equal(r.table, 'jobber_jobs');
  assert.equal(r.rows[0].job_number, 2923);
  assert.equal(r.rows[0].data.jobCosting.totalCost, 139251);
  assert.equal(r.rows[0].data.customFields[0].label, 'Callback');
  assert.equal(r.rows[0].data.customFields[0].valueTrueFalse, false);
  assert.equal(r.rows[0].data.client.id, 'C1');
});

test('job mirror query reads Callback and can omit it when Jobber rejects the field', () => {
  const rich = jobsMirrorQuery(true);
  const plain = jobsMirrorQuery(false);
  assert.equal(Q.jobs, rich);
  assert.match(rich, /CustomFieldTrueFalse/);
  assert.match(rich, /valueTrueFalse/);
  assert.match(rich, /\blabel\b/);
  assert.equal(/customFields/.test(plain), false);
  assert.equal(customFieldSelectionRejected('An object of type CustomFieldTrueFalse was hidden due to permissions'), true);
  assert.equal(customFieldSelectionRejected("Field 'label' doesn't exist on type 'CustomFieldTrueFalse'"), true);
  assert.equal(customFieldSelectionRejected('Throttled'), false);
});

test('quote rows keep client phones for callback exclusion', () => {
  const r = rowsFor('quotes', [{ id: 'Q1', quoteStatus: 'awaiting_response', createdAt: '2026-10-14T18:00:00Z', updatedAt: '2026-10-14T18:00:00Z', client: { id: 'C9', name: 'Pat', phones: [{ number: '+1 (760) 555-0199' }] } }]);
  assert.equal(r.table, 'jobber_quotes');
  assert.equal(r.rows[0].data.client.phones[0].number, '+1 (760) 555-0199');
  assert.deepEqual(r.clients[0].phones_digits, ['7605550199']);
});
test('rolling windows: wide covers 200d quotes', () => {
  const t = rollingTasks(new Date('2026-10-12T00:00:00Z'), true).find((x) => x.field === 'quotes')!;
  assert.equal((t.filter.createdAt as any).after.slice(0, 10), '2026-03-26');
  assert.ok(rollingTasks(new Date(), false).some((x) => x.field === 'quotes' && (x.filter as any).status === 'approved'));
  assert.ok(rollingTasks(new Date(), false).some((x) => x.field === 'jobs' && (x.filter as any).status === 'archived'));
});

test('parseProgress reads a saved wide-pass position and rejects junk', async () => {
  const anchor = new Date(Date.now() - 600_000).toISOString();
  assert.deepEqual(parseProgress(JSON.stringify({ i: 3, cursor: 'abc', anchor })), { i: 3, cursor: 'abc', anchor, seen: null, windows: {} });
  assert.deepEqual(parseProgress(JSON.stringify({ i: 0, cursor: null })), { i: 0, cursor: null, anchor: null, seen: [], windows: {} });
  assert.deepEqual(parseProgress(JSON.stringify({ i: 1, cursor: 'abc', anchor, seen: ['J1'], windows: { 'jobs|a|b': { dated: ['J1'] } } })), {
    i: 1, cursor: 'abc', anchor, seen: ['J1'], windows: { 'jobs|a|b': { dated: ['J1'] } },
  });
  // A cursor from before ids were saved is not a finished window.
  assert.equal(parseProgress(JSON.stringify({ i: 4, cursor: 'abc', anchor }))!.seen, null);
  assert.equal(parseProgress(JSON.stringify({ i: 2, cursor: 'x', anchor: new Date(Date.now() - 2 * 86400_000).toISOString() })), null);
  assert.equal(parseProgress(null), null);
  assert.equal(parseProgress(''), null);
  assert.equal(parseProgress('not json'), null);
  assert.equal(parseProgress(JSON.stringify({ i: -1 })), null);
});

test('only a full date window is prunable; status slices are not', () => {
  const window = { after: '2026-10-03T00:00:00.000Z', before: '2026-10-19T00:00:00.000Z' };
  assert.deepEqual(pruneSpec('invoices', { issuedDate: window }), { table: 'jobber_invoices', column: 'issued_date', after: window.after, before: window.before });
  assert.deepEqual(pruneSpec('quotes', { createdAt: { after: '2025-01-01T00:00:00Z' } }), { table: 'jobber_quotes', column: 'created_at', after: '2025-01-01T00:00:00Z', before: null });
  assert.equal(pruneSpec('paymentRecords', { entryDate: window })?.table, 'jobber_payments');
  assert.equal(pruneSpec('invoices', { invoiceStatus: ['past_due'] }), null);
  assert.equal(pruneSpec('quotes', { status: 'approved' }), null);
  assert.equal(pruneSpec('jobs', { createdAt: window }), null);
  assert.equal(pruneSpec('jobs', { completedAt: window }), null);
  assert.equal(pruneSpec('jobs', null), null);
});

test('a deleted job is the diff of both createdAt walks, never of one walk or a partial cursor', () => {
  const window = { after: '2026-10-03T00:00:00.000Z', before: '2026-10-19T00:00:00.000Z' };
  const dated = jobWindowId({ createdAt: window });
  const archived = jobWindowId({ status: 'archived', createdAt: window });
  assert.equal(dated?.id, archived?.id);
  assert.equal(dated?.part, 'dated');
  assert.equal(archived?.part, 'archived');
  assert.equal(jobWindowId({ completedAt: window }), null);
  assert.equal(jobWindowId({ status: 'archived' })?.id, 'jobs:all');
  assert.equal(jobWindowId(null)?.part, 'dated');

  const half = withSweepIds({}, dated!.id, 'dated', ['live', 'also-live']);
  assert.equal(readyJobIds(half[dated!.id]), null);
  const both = withSweepIds(half, archived!.id, 'archived', ['archived-live']);
  const seen = readyJobIds(both[dated!.id]);
  assert.deepEqual(idsMissingFromSweep(['live', 'also-live', 'archived-live', 'deleted-3570'], seen), { deleteIds: ['deleted-3570'], skipped: null });
  assert.deepEqual(idsMissingFromSweep(['live', 'deleted-3570'], null), { deleteIds: [], skipped: 'incomplete' });
  assert.equal(idsMissingFromSweep(['live', 'deleted-3570'], []).skipped, 'empty-sweep');
  const many = Array.from({ length: 30 }, (_, i) => `J${i}`);
  assert.equal(idsMissingFromSweep(many, ['J0']).skipped, 'too-many:29');
  assert.deepEqual(jobPruneSpec(dated!.id), { table: 'jobber_jobs', column: 'created_at', after: window.after, before: window.before });
  assert.deepEqual(jobPruneSpec('jobs:all'), { table: 'jobber_jobs', column: null, after: null, before: null });
});

test('id checks delete only a record Jobber says is gone', () => {
  assert.equal(goneVerdict({ data: { job: null } }, 'job'), 'gone');
  assert.equal(goneVerdict({ data: { job: null }, errors: [{ message: 'Job not found' }] }, 'job'), 'gone');
  assert.equal(goneVerdict({ data: { job: { id: 'J1' } } }, 'job'), 'present');
  assert.equal(goneVerdict({ errors: [{ message: 'Throttled' }] }, 'job'), 'unknown');
  assert.equal(goneVerdict({ errors: [{ message: 'Cannot query field "paymentRecord" on type "Query"' }] }, 'paymentRecord'), 'unknown');
  assert.deepEqual(confirmedDeletes(['a', 'b', 'c'], ['gone', 'present', 'gone'], 'confirm'), ['a', 'c']);
  assert.deepEqual(confirmedDeletes(['a', 'b'], ['gone', 'unknown'], 'confirm'), ['a']);
  assert.deepEqual(confirmedDeletes(['a', 'b'], null, 'sweep'), ['a', 'b']);
  assert.deepEqual(confirmedDeletes(['a'], null, 'confirm'), []);
});

test('prune deletes the id Jobber no longer has and keeps rows a partial or live read still owns', async () => {
  const rows = [
    { id: 'border', created_at: '2026-10-03T00:00:00.000Z' },
    { id: 'live', created_at: '2026-10-08T00:00:00.000Z' },
    { id: 'deleted-3570', created_at: '2026-10-08T22:38:03.000Z' },
    { id: 'later', created_at: '2026-10-19T00:00:00.000Z' },
  ];
  const deleted: string[] = [];
  const db = {
    from() {
      const filters: Array<[string, string, string]> = [];
      const api: any = {
        select() { return api; },
        gt(col: string, val: string) { filters.push(['gt', col, val]); return api; },
        lt(col: string, val: string) { filters.push(['lt', col, val]); return api; },
        order() { return api; },
        range(from: number, to: number) {
          const list = rows.filter((row) => filters.every(([op, col, val]) => {
            const cell = (row as Record<string, string>)[col];
            return op === 'gt' ? cell > val : cell < val;
          }));
          return Promise.resolve({ data: list.slice(from, to + 1).map((row) => ({ id: row.id })), error: null });
        },
        delete() {
          return { eq(_col: string, id: string) { deleted.push(id); return Promise.resolve({ error: null }); } };
        },
      };
      return api;
    },
  };
  const spec = { table: 'jobber_jobs', column: 'created_at', after: '2026-10-03T00:00:00.000Z', before: '2026-10-19T00:00:00.000Z' };
  const seen = ['live'];
  const verdict: Record<string, 'gone' | 'present' | 'unknown'> = { 'deleted-3570': 'gone', live: 'present' };
  const result = await pruneMirrorRows(db, spec, seen, { mode: 'confirm', confirm: async (id) => verdict[id] ?? 'unknown' });
  assert.deepEqual(result.deleted, ['deleted-3570']);
  assert.deepEqual(deleted, ['deleted-3570']);
  assert.equal(rows.some((row) => row.id === 'border'), true);

  const blocked = await pruneMirrorRows(db, spec, null, { mode: 'confirm', confirm: async () => 'gone' });
  assert.deepEqual(blocked.deleted, []);
  assert.equal(blocked.skipped, 'incomplete');
  assert.deepEqual(deleted, ['deleted-3570']);
});
