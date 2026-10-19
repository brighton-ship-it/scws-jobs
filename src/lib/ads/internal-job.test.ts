import test from 'node:test';
import assert from 'node:assert/strict';
import { isInternalClientName, isInternalJob, isInternalJobTitle } from './internal-job.ts';
import { buildWeeklySales, categoryTotals } from './weekly-sales.ts';
import { buildRoasView } from './roas-view.ts';
import { mergeFullHistory } from './ltv-full.ts';

const TEST_CLIENT = { name: 'brighton scala', companyName: 'sc well service' };
const PERSONAL = { name: 'Brighton scala', companyName: null };
const COMPANY_CLIENT = { name: 'Sc Well Service', companyName: 'Sc Well Service' };

test('internal client is brighton scala at SC Well Service, not the other Brighton records', () => {
  assert.equal(isInternalClientName('brighton scala', 'sc well service'), true);
  assert.equal(isInternalClientName('Brighton Scala', 'SC Well Service, Inc.'), true);
  assert.equal(isInternalClientName('brighton'), true);
  assert.equal(isInternalClientName('Brighton scala', null), false);
  assert.equal(isInternalClientName('Sc Well Service', 'Sc Well Service'), false);
  assert.equal(isInternalClientName('Ken', null), false);
});

test('titles: training, shop meeting, and a job titled only test are internal', () => {
  for (const title of [
    'TRAINING - Close & Invoice ($5) - Colton',
    'Shop Meeting - Ramona',
    'Shop Meeting - Anza',
    'test',
    'Test.',
    'practice',
    'Tech training',
    'PTO - Cowin',
    'Internal: yard cleanup',
  ]) {
    assert.equal(isInternalJobTitle(title), true, title);
  }
});

test('titles: water test, pump test, flow test, test hole, and warranty work still count', () => {
  for (const title of [
    'Water test',
    'Water Test',
    'Pump test',
    'Pump Test',
    'Flow test',
    'Flow Test',
    'Water sample & flow test',
    'Test Pump',
    'Test Existing Pump in Well',
    'Flow Test And Test TDS',
    'bench test the pump ends at the shop',
    'test hole',
    'Pilot hole',
    'New Well Drilling',
    'Service Call',
    'Service Call - no water',
    'Replace Water Heater',
    'Two concrete slabs',
    'Job Walk - Brighton',
    'Warranty Pump install',
    'Meeting with cheryl',
    'For Services Rendered',
  ]) {
    assert.equal(isInternalJobTitle(title), false, title);
  }
});

test('a service call on the test client is internal; the same title for a customer is not', () => {
  assert.equal(isInternalJob({ title: 'Service Call', client: TEST_CLIENT }), true);
  assert.equal(isInternalJob({ title: 'Service Call', client: { name: 'Ada', companyName: null } }), false);
  assert.equal(isInternalJob({ title: 'test', client: PERSONAL }), true);
  assert.equal(isInternalJob({ title: 'New Well Drilling', client: PERSONAL }), false);
  assert.equal(isInternalJob({ title: 'Replace Water Heater', client: COMPANY_CLIENT }), false);
  assert.equal(isInternalJob({ title: 'Job Walk - Brighton', client: { name: 'Ken' } }), false);
  assert.equal(isInternalJob({
    subject: 'For Services Rendered',
    client: PERSONAL,
    jobs: { nodes: [{ title: 'test' }] },
  }), true);
  assert.equal(isInternalJob({
    subject: 'For Services Rendered',
    client: { name: 'Ada' },
    jobs: { nodes: [{ title: 'Pump Test' }] },
  }), false);
});

test('dashboards drop internal jobs, their invoices, payments, and quotes, and keep pump tests', () => {
  const at = '2026-10-18T21:48:00Z';
  const input = {
    now: new Date('2026-10-19T20:00:00Z'),
    invoices: [
      {
        id: 'real', invoiceStatus: 'paid', issuedDate: '2026-10-10', subject: 'Pump',
        amounts: { subtotal: 1000, total: 1000, paymentsTotal: 1000 },
        jobs: { nodes: [{ title: 'Pump Test' }] },
        client: { id: 'c-real', name: 'Rex' },
        paymentRecords: { nodes: [{ id: 'pay-real' }] },
      },
      {
        id: 'test-inv', invoiceStatus: 'paid', issuedDate: '2026-10-16', subject: 'For Services Rendered',
        amounts: { subtotal: 5, total: 5, paymentsTotal: 5 },
        jobs: { nodes: [{ title: 'test' }] },
        client: PERSONAL,
        paymentRecords: { nodes: [{ id: 'pay-test' }] },
      },
      {
        id: 'train-inv', invoiceStatus: 'paid', issuedDate: '2026-10-19', subject: 'TRAINING - Close & Invoice ($5) - Colton',
        amounts: { subtotal: 5, total: 5, paymentsTotal: 5 },
        client: TEST_CLIENT,
        paymentRecords: { nodes: [{ id: 'pay-train' }] },
      },
    ],
    quotes: [
      { title: 'New Well Drilling', quoteStatus: 'approved', sentAt: at, transitionedAt: at, amounts: { subtotal: 20000 }, client: PERSONAL },
      { title: 'TRAINING - Close & Invoice ($5) - Colton', quoteStatus: 'approved', sentAt: at, transitionedAt: at, amounts: { subtotal: 5 }, client: TEST_CLIENT },
      { title: 'Service Call', quoteStatus: 'converted', sentAt: at, transitionedAt: at, amounts: { subtotal: 200 }, client: TEST_CLIENT },
    ],
    jobsCreated: [
      { title: 'Pump Test', createdAt: at, client: { name: 'Rex' } },
      { title: 'TRAINING - Close & Invoice ($5) - Cowin', createdAt: at, client: TEST_CLIENT },
      { title: 'Shop Meeting - Ramona', createdAt: at, client: TEST_CLIENT },
      { title: 'Service Call', createdAt: at, client: TEST_CLIENT },
      { title: 'test', createdAt: at, client: PERSONAL },
      { title: 'Flow test', createdAt: at, client: { name: 'Rick Slaughter' } },
    ],
    jobsCompleted: [
      { title: 'test', completedAt: at, client: PERSONAL },
      { title: 'Service Call', completedAt: at, client: TEST_CLIENT },
      { title: 'Pump Test', completedAt: at, client: { name: 'Rex' } },
    ],
    payments: [
      { id: 'pay-real', amount: 1000, entryDate: '2026-10-10', adjustmentType: 'PAYMENT' },
      { id: 'pay-test', amount: 5, entryDate: '2026-10-16', adjustmentType: 'PAYMENT' },
      { id: 'pay-train', amount: 5, entryDate: '2026-10-19', adjustmentType: 'PAYMENT' },
      { id: 'pay-other', amount: 5, entryDate: '2026-10-12', adjustmentType: 'PAYMENT' },
    ],
    callTimes: [],
    bookedAt: [],
    range: { range: 'since', startKey: '2026-09-18', endKey: '2026-10-19', name: 'since' },
  };
  const w = buildWeeklySales(input);
  assert.equal(w.totals!.jobsBooked, 2);
  assert.equal(w.totals!.jobsCompleted, 1);
  assert.equal(w.totals!.invoiced, 1000);
  assert.equal(w.totals!.invoiceCount, 1);
  assert.equal(w.totals!.paid, 1000);
  assert.equal(w.totals!.cash, 1005);
  assert.equal(w.totals!.quotesSent, 1);
  const cats = categoryTotals(input, '2026-09-18', '2026-10-19')!;
  assert.equal(cats.pump.jobsBooked, 2);
  assert.equal(cats.service_call.jobsBooked, 0);
  assert.equal(cats.pump.invoiced, 1000);
  assert.ok(w.sources.some((line) => /internal, training, and test jobs are excluded/i.test(line)));
});

test('ROAS and lifetime value skip the $5 test invoice and keep a pump test', () => {
  const invoices = [
    {
      id: 'real', invoiceStatus: 'paid', issuedDate: '2026-10-10T18:00:00Z', subject: 'Pump',
      amounts: { subtotal: 1000, total: 1000, paymentsTotal: 1000 },
      jobs: { nodes: [{ title: 'Pump Test' }] },
      client: { id: 'c-real', name: 'Rex', phones: [{ number: '7605550100' }], jobs: { nodes: [] } },
    },
    {
      id: 'test-inv', invoiceStatus: 'paid', issuedDate: '2026-10-16T02:11:02Z', subject: 'For Services Rendered',
      amounts: { subtotal: 5, total: 5, paymentsTotal: 5 },
      jobs: { nodes: [{ title: 'test' }] },
      client: { id: 'c-bright', ...PERSONAL, phones: [{ number: '4083181171' }], jobs: { nodes: [] } },
    },
  ];
  const start = new Date('2026-09-18T07:00:00Z');
  const now = new Date('2026-10-19T20:00:00Z');
  const roas = buildRoasView({
    invoices,
    adCalls: [{ started_at: '2026-10-01T18:00:00Z', caller_phone: '7605550100', campaign_name: 'Pump Search' }],
    spend: [{ date: '2026-10-10', costUsd: 100, campaign: 'Pump Search', clicks: 1 }],
    start, now,
  });
  assert.equal(roas!.overall.invoiced, 1000);
  assert.equal(roas!.blended!.invoiced, 1000);
  assert.equal(roas!.blended!.invoices, 1);
  assert.ok(roas!.method.some((line) => /internal, training, and test jobs are excluded/i.test(line)));
  const ltv = mergeFullHistory({ source: 't', customers: [] }, invoices);
  assert.equal(ltv.customers.length, 1);
  assert.equal(ltv.customers[0].rev, 1000);
});
