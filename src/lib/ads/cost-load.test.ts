import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costPageOutcome, fallbackCompletedJobCosts, type CostLoad } from './cost-load.ts';

const job = { id: 'j1', jobCosting: { totalRevenue: 1000, totalCost: 400 } };

test('fallbackCompletedJobCosts uses the plain query only for a custom-field rejection', () => {
  const plain: CostLoad<typeof job> = { rows: [job] };
  const customField: CostLoad<typeof job> = { rows: null, error: "Field 'label' doesn't exist on type 'CustomFieldTrueFalse'" };
  const fell = fallbackCompletedJobCosts(customField, plain);
  assert.deepEqual(fell.rows, [job]);
  assert.match(fell.customFieldsError ?? '', /CustomFieldTrueFalse/);

  const costingHidden: CostLoad<typeof job> = { rows: null, error: 'An object of type JobCosting was hidden due to permissions' };
  const kept = fallbackCompletedJobCosts(costingHidden, plain);
  assert.equal(kept.rows, null);
  assert.match(kept.error ?? '', /JobCosting/);
  assert.equal(kept.customFieldsError, undefined);

  const already: CostLoad<typeof job> = { rows: [job], customFieldsError: 'customFields failed' };
  assert.equal(fallbackCompletedJobCosts(already, { rows: [], error: 'should not replace' }), already);
});

test('costPageOutcome keeps job nodes when an unrelated type is hidden', () => {
  const user = costPageOutcome({
    data: { jobs: { nodes: [job], pageInfo: { hasNextPage: false, endCursor: null } } },
    errors: [{ message: 'An object of type User was hidden due to permissions' }],
  });
  assert.equal(user.fatal, false);
  assert.deepEqual(user.rows, [job]);
  assert.equal(user.customFieldsError, undefined);

  const timesheet = costPageOutcome({
    data: { jobs: { nodes: [job], pageInfo: { hasNextPage: true, endCursor: 'c1' } } },
    errors: [{ message: 'An object of type TimeSheetEntry was hidden due to permissions' }],
  });
  assert.equal(timesheet.fatal, false);
  assert.equal(timesheet.hasNextPage, true);
  assert.equal(timesheet.endCursor, 'c1');
  assert.deepEqual(timesheet.rows, [job]);
});

test('costPageOutcome keeps nodes on a custom-field error and fails closed without them', () => {
  const withNodes = costPageOutcome({
    data: { jobs: { nodes: [job], pageInfo: { hasNextPage: false } } },
    errors: [{ message: 'An object of type CustomFieldTrueFalse was hidden due to permissions' }],
  });
  assert.equal(withNodes.fatal, false);
  assert.deepEqual(withNodes.rows, [job]);
  assert.match(withNodes.customFieldsError ?? '', /CustomFieldTrueFalse/);

  const noNodes = costPageOutcome({
    data: { jobs: { nodes: [], pageInfo: { hasNextPage: false } } },
    errors: [{ message: "Field 'label' doesn't exist on type 'CustomFieldTrueFalse'" }],
  });
  assert.equal(noNodes.fatal, true);
  assert.equal(noNodes.rows, null);
  assert.match(noNodes.error ?? '', /CustomFieldTrueFalse/);
  assert.equal(noNodes.retry, false);
});

test('a hidden Job or JobCosting blanks the page even when nodes are present', () => {
  const costing = costPageOutcome({
    data: { jobs: { nodes: [job], pageInfo: { hasNextPage: false } } },
    errors: [{ message: 'An object of type JobCosting was hidden due to permissions' }],
  });
  assert.equal(costing.fatal, true);
  assert.equal(costing.rows, null);
  assert.match(costing.error ?? '', /JobCosting/);
  assert.equal(costing.retry, false);

  const jobHidden = costPageOutcome({
    data: { jobs: { nodes: [job] } },
    errors: [{ message: 'An object of type Job was hidden due to permissions' }],
  });
  assert.equal(jobHidden.fatal, true);
  assert.equal(jobHidden.rows, null);

  const unrelatedEmpty = costPageOutcome({
    data: { jobs: { nodes: [] } },
    errors: [{ message: 'An object of type User was hidden due to permissions' }],
  });
  assert.equal(unrelatedEmpty.fatal, true);
  assert.equal(unrelatedEmpty.rows, null);
});
