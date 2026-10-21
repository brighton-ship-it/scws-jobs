import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMetrics, TIMESHEET_PERMISSION_STATE, type MetricCard } from './metrics.ts';
import type { CostJob, TimeEntry } from './metrics-data.ts';

const NOW = new Date('2026-10-21T19:00:00Z'); // Oct 21, 2026 afternoon Pacific

function base(costs: CostJob[], extra: { marginSince?: string | null; callbackSince?: string | null; time?: { rows: TimeEntry[] | null; error?: string }; customFieldsError?: string } = {}) {
  return {
    now: NOW,
    histFrom: new Date('2024-10-21T00:00:00Z'),
    history: { rows: [] as never[] },
    roasSince: null,
    sinceLabel: 'Since Sep 18, 2026',
    quotes: [],
    quotesFrom: new Date('2026-04-21T00:00:00Z'),
    costs: { rows: costs, customFieldsError: extra.customFieldsError },
    costFrom: new Date('2026-07-23T07:00:00Z'),
    marginSince: extra.marginSince,
    callbackSince: extra.callbackSince,
    time: extra.time ?? { rows: [] as TimeEntry[] },
    timeFrom: new Date('2026-09-21T07:00:00Z'),
    qboConnected: false,
    qbo: null,
  };
}

function job(partial: { rev: number; cost: number; title?: string; jobNumber?: number; completedAt?: string; customFields?: CostJob['customFields'] }): CostJob {
  return {
    id: `j${partial.jobNumber ?? partial.title ?? partial.rev}-${partial.cost}-${partial.completedAt ?? 'oct'}`,
    jobNumber: partial.jobNumber ?? null,
    title: partial.title ?? 'Replace pump',
    completedAt: partial.completedAt ?? '2026-10-01T18:00:00Z',
    jobCosting: { totalRevenue: partial.rev, totalCost: partial.cost },
    customFields: partial.customFields,
  };
}

function repeat(n: number, make: (i: number) => CostJob): CostJob[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

function card(cards: MetricCard[], id: string): MetricCard {
  const found = cards.find((c) => c.id === id);
  assert.ok(found, id);
  return found;
}

test('gross margin drops implausible Jobber unit costs and still reports a margin', () => {
  // Same failure mode as Jobber's all-time report ($16.4M cost vs $7.7M revenue) and job #2923
  // ($8,001 revenue, $139,251 cost): the whole line cost was typed into the per-unit field.
  const goodPump = repeat(80, (i) => job({ rev: 4000, cost: 1600, title: 'Replace pump', jobNumber: 4000 + i }));
  const goodDrill = repeat(40, (i) => job({ rev: 20000, cost: 14000, title: 'New Well Drilling', jobNumber: 5000 + i }));
  const scaled = repeat(100, (i) => job({ rev: 5000, cost: 80000, title: 'Pull pump', jobNumber: 6000 + i }));
  const zeroRevenue = repeat(9, (i) => job({ rev: 0, cost: 50000, title: 'Service Call - no water', jobNumber: 7000 + i }));
  const job2923 = job({ rev: 8001, cost: 139251, title: 'Replace pump', jobNumber: 2923 });
  const rows = [...goodPump, ...goodDrill, ...scaled, ...zeroRevenue, job2923];

  let rawRev = 0;
  let rawCost = 0;
  for (const row of rows) {
    rawRev += row.jobCosting?.totalRevenue ?? 0;
    rawCost += row.jobCosting?.totalCost ?? 0;
  }
  assert.ok(rawCost > rawRev * 2, `fixture stays distorted (${rawCost} cost vs ${rawRev} revenue)`);

  const withRev = rows.filter((row) => (row.jobCosting?.totalRevenue ?? 0) > 0);
  const naiveRev = withRev.reduce((s, row) => s + (row.jobCosting?.totalRevenue ?? 0), 0);
  const naiveCost = withRev.reduce((s, row) => s + (row.jobCosting?.totalCost ?? 0), 0);
  assert.ok((naiveRev - naiveCost) / naiveRev < 0, 'unfiltered margin on this shape is negative');

  const margin = card(buildMetrics(base(rows)), 'margin');
  // 80 pump jobs at $2,400 profit (60%) and 40 drilling jobs at $6,000 (30%).
  assert.equal(margin.value, '$3,600 · 38.6%');
  assert.match(margin.sub ?? '', /120 jobs in the average/);
  assert.match(margin.sub ?? '', /101 excluded/);
  assert.match(margin.sub ?? '', /9 warranty \/ \$0 revenue \(\$450,000 cost/);
  assert.equal(margin.rows?.find((row) => row.label === 'Pump & service')?.value, '$2,400 · 60%');
  assert.equal(margin.rows?.find((row) => row.label === 'Drilling')?.value, '$6,000 · 30%');
  assert.equal(margin.rows?.find((row) => row.label === 'Excluded')?.value, '101');
  const warranty = margin.rows?.find((row) => row.label === 'Warranty / $0 revenue');
  assert.equal(warranty?.value, '9');
  assert.match(warranty?.note ?? '', /\$450,000/);
  assert.match(margin.hover ?? '', /#2923/);
  assert.match(margin.hover ?? '', /\$139,251/);
  assert.match(margin.hover ?? '', /\$8,001/);
  assert.equal(margin.needs, undefined);
});

test('cost equal to 2× revenue stays in; a dollar over, a $0-revenue cost, and internal jobs stay out', () => {
  const rows = [
    ...repeat(12, (i) => job({ rev: 1000, cost: 500, jobNumber: i + 1 })),
    job({ rev: 1000, cost: 2000, jobNumber: 13, title: 'Replace booster' }),
    job({ rev: 1000, cost: 2000.01, jobNumber: 14, title: 'Replace booster' }),
    job({ rev: 0, cost: 9000, jobNumber: 15, title: 'Service Call - dry hole' }),
    job({ rev: 100, cost: 999999, jobNumber: 16, title: 'Training' }),
  ];
  const margin = card(buildMetrics(base(rows)), 'margin');
  assert.equal(margin.value, '$385 · 38.5%');
  assert.equal(margin.rows?.find((row) => row.label === 'Excluded')?.value, '1');
  const warranty = margin.rows?.find((row) => row.label === 'Warranty / $0 revenue');
  assert.equal(warranty?.value, '1');
  assert.match(warranty?.note ?? '', /\$9,000/);
  assert.match(margin.sub ?? '', /13 jobs in the average/);
});

test('OPS_MARGIN_SINCE drops older completions, including a bad job, without calling them implausible', () => {
  const rows = [
    ...repeat(12, (i) => job({ rev: 1000, cost: 400, jobNumber: 100 + i, completedAt: '2026-10-01T18:00:00Z' })),
    ...repeat(5, (i) => job({ rev: 1000, cost: 400, jobNumber: 200 + i, completedAt: '2026-06-15T18:00:00Z' })),
    job({ rev: 8001, cost: 139251, jobNumber: 2923, completedAt: '2026-06-20T18:00:00Z' }),
  ];
  const margin = card(buildMetrics(base(rows, { marginSince: '2026-09-01' })), 'margin');
  assert.equal(margin.value, '$600 · 60%');
  assert.match(margin.range, /^Sep 1, 2026/);
  assert.match(margin.sub ?? '', /6 completed before Sep 1, 2026/);
  assert.equal(margin.rows?.find((row) => row.label === 'Before cost tracking')?.value, '6');
  assert.equal(margin.rows?.find((row) => row.label === 'Excluded'), undefined);
  assert.match(margin.measures, /Completions before Sep 1, 2026/);
});

test('a bad OPS_MARGIN_SINCE does not apply a cutoff', () => {
  const rows = repeat(12, (i) => job({ rev: 1000, cost: 400, jobNumber: i + 1 }));
  const margin = card(buildMetrics(base(rows, { marginSince: 'yesterday' })), 'margin');
  assert.equal(margin.value, '$600 · 60%');
  assert.match(margin.sub ?? '', /yesterday/);
});

test('excluding bad costs does not change the other metric cards', () => {
  const good = repeat(12, (i) => job({ rev: 1000, cost: 400, jobNumber: i + 1 }));
  const bad = job({ rev: 8001, cost: 139251, jobNumber: 2923 });
  const clean = buildMetrics(base(good));
  const dirty = buildMetrics(base([...good, bad]));
  for (const id of ['ltv', 'ltv-cac', 'ftf', 'util', 'cycle', 'repeat', 'cac', 'nrr']) {
    assert.deepEqual(card(dirty, id), card(clean, id), id);
  }
  assert.equal(card(dirty, 'margin').value, card(clean, 'margin').value);
  assert.match(card(dirty, 'margin').sub ?? '', /1 excluded/);
  assert.doesNotMatch(card(clean, 'margin').sub ?? '', /excluded/);
});

test('timesheet permission is a visible card state, not a blank value', () => {
  const rows = repeat(12, (i) => job({ rev: 1000, cost: 400, jobNumber: i + 1 }));
  const denied = card(buildMetrics(base(rows, { time: { rows: null, error: 'An object of type TimeSheetEntry was hidden due to permissions' } })), 'util');
  assert.equal(denied.value, TIMESHEET_PERMISSION_STATE);
  assert.match(denied.needs ?? '', /Timesheets read/);
  assert.match(denied.needs ?? '', /re-authorize/);
  assert.match(denied.needs ?? '', /TimeSheetEntry/);
  const other = card(buildMetrics(base(rows, { time: { rows: null, error: 'Jobber GraphQL HTTP 500' } })), 'util');
  assert.equal(other.value, '—');
  assert.match(other.needs ?? '', /HTTP 500/);
  const entries: TimeEntry[] = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, finalDuration: 7200, job: { id: i % 2 ? 'j' : null }, user: { id: 'u1' } }));
  const util = card(buildMetrics(base(rows, { time: { rows: entries } })), 'util');
  assert.equal(util.value, '50%');
});

const AFTER_CALLBACK = '2026-10-21T04:00:00Z'; // Oct 20, 2026 21:00 Pacific, after the field existed

test('first-time fix uses the Callback true/false custom field when jobs include it', () => {
  const fields = (value: boolean | null): CostJob['customFields'] => [{ label: ' Callback ', valueTrueFalse: value }];
  const rows = [
    ...repeat(8, (i) => job({ rev: 200, cost: 80, title: 'Service Call - no water', jobNumber: 10 + i, completedAt: AFTER_CALLBACK, customFields: fields(false) })),
    ...repeat(2, (i) => job({ rev: 200, cost: 80, title: 'Service Call - return', jobNumber: 20 + i, completedAt: AFTER_CALLBACK, customFields: fields(true) })),
    job({ rev: 4000, cost: 1600, title: 'Replace pump', jobNumber: 30, completedAt: AFTER_CALLBACK, customFields: fields(false) }),
    job({ rev: 20000, cost: 14000, title: 'New Well Drilling', jobNumber: 31, completedAt: AFTER_CALLBACK, customFields: [{ label: 'Callback', valueTrueFalse: true }] }),
    job({ rev: 100, cost: 50, title: 'Service Call - training', jobNumber: 32, completedAt: AFTER_CALLBACK, customFields: fields(true) }),
  ];
  // 8 fixes + 2 service callbacks + 1 drilling callback. The training service call is internal. The pump job is not a callback.
  const ftf = card(buildMetrics(base(rows)), 'ftf');
  assert.equal(ftf.value, '72.7%');
  assert.match(ftf.sub ?? '', /8 of 11 not marked Callback/);
  assert.match(ftf.sub ?? '', /3 callbacks/);
  const margin = card(buildMetrics(base(rows)), 'margin');
  assert.equal(margin.needs, undefined);
});

test('first-time fix stays blank until custom fields are actually on the jobs', () => {
  const rows = repeat(12, (i) => job({ rev: 200, cost: 80, title: 'Service Call - no water', jobNumber: i + 1 }));
  const ftf = card(buildMetrics(base(rows)), 'ftf');
  assert.equal(ftf.value, '—');
  assert.match(ftf.needs ?? '', /Callback/);
  assert.match(ftf.needs ?? '', /Nothing is written to Jobber/);
  const otherLabel = card(buildMetrics(base(rows.map((row) => ({ ...row, customFields: [{ label: 'Warranty', valueTrueFalse: false }] })))), 'ftf');
  assert.equal(otherLabel.value, '—');
  assert.match(otherLabel.needs ?? '', /named Callback/);
  const failed = card(buildMetrics(base(rows, { customFieldsError: "Field 'label' doesn't exist on type 'CustomFieldTrueFalse'" })), 'ftf');
  assert.equal(failed.value, '—');
  assert.match(failed.needs ?? '', /CustomFieldTrueFalse/);
  assert.equal(card(buildMetrics(base(rows, { customFieldsError: failed.needs })), 'margin').needs, undefined);
});

test('first-time fix ignores jobs completed before the Callback field existed', () => {
  const fields = (value: boolean): CostJob['customFields'] => [{ label: 'Callback', valueTrueFalse: value }];
  const before = repeat(6, (i) => job({ rev: 200, cost: 80, title: 'Service Call - no water', jobNumber: i + 1, completedAt: '2026-10-15T18:00:00Z', customFields: fields(false) }));
  const after = repeat(4, (i) => job({ rev: 200, cost: 80, title: 'Service Call - no water', jobNumber: 10 + i, completedAt: AFTER_CALLBACK, customFields: fields(false) }));
  const pending = card(buildMetrics(base([...before, ...after])), 'ftf');
  assert.equal(pending.value, 'n/a');
  assert.doesNotMatch(pending.value, /%/);
  assert.match(pending.sub ?? '', /4 service jobs since Oct 20, 2026/);
  assert.match(pending.sub ?? '', /0 callbacks/);
  assert.match(pending.sub ?? '', /6 earlier jobs not counted/);
  assert.match(pending.needs ?? '', /100%/);

  const tagged = job({ rev: 200, cost: 80, title: 'Service Call - return', jobNumber: 99, completedAt: '2026-10-21T05:00:00Z', customFields: fields(true) });
  const rated = card(buildMetrics(base([...before, ...after, tagged])), 'ftf');
  assert.equal(rated.value, '80%');
  assert.match(rated.sub ?? '', /4 of 5 not marked Callback/);
  assert.match(rated.sub ?? '', /6 earlier jobs not counted/);

  const oldTrue = job({ rev: 200, cost: 80, title: 'Service Call - return', jobNumber: 50, completedAt: '2026-10-15T18:00:00Z', customFields: fields(true) });
  const stillPending = card(buildMetrics(base([...after, oldTrue])), 'ftf');
  assert.equal(stillPending.value, 'n/a');
  assert.match(stillPending.sub ?? '', /0 callbacks/);
  assert.match(stillPending.sub ?? '', /1 earlier job not counted/);
});

test('OPS_CALLBACK_SINCE includes earlier jobs, and a bad value keeps the default cutoff', () => {
  const fields = (value: boolean): CostJob['customFields'] => [{ label: 'Callback', valueTrueFalse: value }];
  const rows = [
    job({ rev: 200, cost: 80, title: 'Service Call - no water', jobNumber: 1, completedAt: '2026-10-15T18:00:00Z', customFields: fields(false) }),
    job({ rev: 200, cost: 80, title: 'Service Call - return', jobNumber: 2, completedAt: '2026-10-15T20:00:00Z', customFields: fields(true) }),
  ];
  const opened = card(buildMetrics(base(rows, { callbackSince: '2026-10-01' })), 'ftf');
  assert.equal(opened.value, '50%');
  const closed = card(buildMetrics(base(rows)), 'ftf');
  assert.equal(closed.value, '—');
  assert.match(closed.needs ?? '', /Oct 20, 2026|Callback field was added/);
  const bad = card(buildMetrics(base(rows, { callbackSince: 'yesterday' })), 'ftf');
  assert.equal(bad.value, '—');
  assert.match(bad.needs ?? '', /yesterday/);
  assert.match(bad.needs ?? '', /Oct 20, 2026/);
});
