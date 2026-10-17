import test from 'node:test';
import assert from 'node:assert/strict';
import { commsFromNodes, loadJobberFollowUp, probeInvoiceFilter } from './jobber-followup.ts';

test('Jobber messages count only when they have a channel and a time, on that invoice', () => {
  const parsed = commsFromNodes('C1', [
    { __typename: 'EmailMessage', id: 'e1', createdAt: '2026-10-08T18:00:00Z' },
    { __typename: 'Message', id: 't1', channel: 'SMS', sentAt: '2026-10-09T18:00:00Z' },
    { __typename: 'Message', id: 'x1', createdAt: '2026-10-10T18:00:00Z' },
    { __typename: 'EmailMessage', id: 'e2' },
  ], '5818');
  assert.equal(parsed.classified, true);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0].source, 'jobber_email');
  assert.equal(parsed.events[1].source, 'jobber_sms');
  assert.deepEqual(parsed.events[0].invoiceNumbers, ['5818']);
  assert.deepEqual(parsed.events[1].invoiceNumbers, ['5818']);
  const blank = commsFromNodes('C1', [{ __typename: 'Message', id: 'x', createdAt: '2026-10-10T18:00:00Z' }], '1');
  assert.equal(blank.classified, false);
  assert.equal(blank.events.length, 0);
});

const REJECT_INVOICE_STATUS = 'Variable $filter of type InvoiceFilterAttributes was provided invalid value for invoiceStatus (Field is not defined on InvoiceFilterAttributes)';

test('open invoices use the status filter Jobber accepts, never the rejected invoiceStatus field', async () => {
  const filters: any[] = [];
  const gql = async (query: string, variables?: Record<string, unknown>) => {
    if (!/OpenInv/.test(query)) return { data: { jobs: { nodes: [], pageInfo: {} }, clients: { nodes: [], pageInfo: {} }, requests: { nodes: [], pageInfo: {} } } };
    const filter = (variables?.filter ?? {}) as Record<string, unknown>;
    filters.push(filter);
    if ('invoiceStatus' in filter) return { errors: [{ message: REJECT_INVOICE_STATUS }] };
    if (/linkedCommunications/.test(query)) return { errors: [{ message: "Field 'linkedCommunications' doesn't exist on type 'Invoice'" }] };
    const status = String(filter.status);
    const nodes = status === 'past_due'
      ? [{ id: 'i1', invoiceNumber: 5757, invoiceStatus: 'past_due', issuedDate: '2026-09-18T00:00:00Z', dueDate: '2026-09-18T07:00:00Z', client: { id: 'c1', emails: [], phones: [{ number: '4026199383' }] } }]
      : [{ id: 'i2', invoiceNumber: 5921, invoiceStatus: 'awaiting_payment', issuedDate: '2026-10-15T00:00:00Z', dueDate: '2026-11-14T08:00:00Z', client: { id: 'c2', emails: [], phones: [] } }];
    return { data: { invoices: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } };
  };
  assert.equal(await probeInvoiceFilter(gql), 'status');
  const out = await loadJobberFollowUp('2026-09-18T00:00:00Z', gql);
  assert.deepEqual(out.invoices.map((i) => [i.number, i.dueAt]), [['5757', '2026-09-18T07:00:00Z'], ['5921', '2026-11-14T08:00:00Z']]);
  assert.ok(!out.notes.some((n) => /^open invoices:/.test(n)), out.notes.join(' | '));
  assert.ok(filters.every((f) => !('invoiceStatus' in f)));
});

test('invoice filter falls back to uppercase status when Jobber wants the enum name', async () => {
  const gql = async (_q: string, variables?: Record<string, unknown>) => {
    const f = (variables?.filter ?? {}) as Record<string, unknown>;
    if (f.status === 'PAST_DUE') return { data: { invoices: { nodes: [], pageInfo: {} } } };
    return { errors: [{ message: 'Variable $filter of type InvoiceFilterAttributes was provided invalid value for status (Expected "past_due" to be one of: PAST_DUE)' }] };
  };
  assert.equal(await probeInvoiceFilter(gql), 'STATUS');
});
