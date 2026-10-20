import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientsToTag } from './lead-source-note.ts';
const from = Date.parse('2026-10-20T00:00:00Z');
test('tags only booked DM1 contacts after the start, once', () => {
  const out = clientsToTag({
    fromMs: from, done: new Set(['C3']),
    contacts: [
      { at: '2026-10-28T18:00:00Z', phone: '+17605550001', via: 'call' },
      { at: '2026-10-28T18:00:00Z', phone: '7605550002', via: 'form' },
      { at: '2026-10-10T18:00:00Z', phone: '7605550004', via: 'call' },
      { at: '2026-10-28T18:00:00Z', phone: '7605550003', via: 'call' },
    ],
    clients: [{ id: 'C1', phones: ['7605550001'] }, { id: 'C2', phones: ['7605550002'] }, { id: 'C3', phones: ['7605550003'] }, { id: 'C4', phones: ['7605550004'] }],
    jobs: [{ client_id: 'C1', created_at: '2026-10-29T18:00:00Z' }, { client_id: 'C3', created_at: '2026-10-29T18:00:00Z' }, { client_id: 'C4', created_at: '2026-10-29T18:00:00Z' }],
  });
  assert.deepEqual(out.map((o) => o.clientId), ['C1']);
});
