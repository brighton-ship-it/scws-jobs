/**
 * Pure decisions for the ops job-cost load. No Next.js, no Jobber client.
 * A custom-field rejection falls back to the plain costing query.
 * An unrelated "hidden due to permissions" error keeps job nodes when Jobber
 * still returned them. A hidden Job or JobCosting does not.
 */

import { customFieldSelectionRejected } from '../jobber/job-custom-fields.ts';

export interface CostLoad<T> {
  rows: T[] | null;
  error?: string;
  truncated?: boolean;
  customFieldsError?: string;
}

export interface CostGraphqlPage<T> {
  data?: Record<string, {
    nodes?: T[] | null;
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
  } | null> | null;
  errors?: Array<{ message?: string | null } | null> | null;
}

export interface CostPageOutcome<T> {
  rows: T[] | null;
  error?: string;
  customFieldsError?: string;
  fatal: boolean;
  /** Throttle / query-cost: the pager should retry this page. */
  retry: boolean;
  hasNextPage: boolean;
  endCursor: string | null;
}

const HIDDEN_TYPE = /^An object of type (\w+) was hidden due to permissions/i;

/** True for errors that must blank costing. Custom-field errors are classified separately. */
export function isFatalCostError(message: string): boolean {
  const hidden = HIDDEN_TYPE.exec(message.trim());
  if (!hidden) return true;
  const type = hidden[1].toLowerCase();
  return type === 'job' || type === 'jobcosting';
}

function throttleMessage(message: string): boolean {
  return /throttl|rate limit|\b429\b|query cost/i.test(message);
}

/**
 * One jobs page. Keeps nodes when the only problems are a custom-field selection
 * or an unrelated hidden type (User, TimeSheetEntry, …) and at least one job came back.
 * A custom-field error with no nodes is fatal so the plain-query fallback can run.
 * Job / JobCosting hidden is fatal even when nodes are present (those costs would be $0).
 */
export function costPageOutcome<T>(result: CostGraphqlPage<T> | null | undefined, field = 'jobs'): CostPageOutcome<T> {
  const errors = (result?.errors ?? [])
    .map((error) => error?.message?.trim() ?? '')
    .filter((message) => message.length > 0);
  const conn = result?.data?.[field];
  const nodes = Array.isArray(conn?.nodes) ? conn.nodes : [];
  const custom = errors.filter((message) => customFieldSelectionRejected(message));
  const fatalErrors = errors.filter((message) => !customFieldSelectionRejected(message) && isFatalCostError(message));
  const empty: CostPageOutcome<T> = { rows: null, fatal: true, retry: false, hasNextPage: false, endCursor: null };

  if (fatalErrors.length) {
    const error = fatalErrors[0];
    return { ...empty, error, retry: throttleMessage(error) };
  }
  if (!conn && errors.length === 0) {
    return { ...empty, error: `metrics ${field} returned no ${field} connection` };
  }
  if (custom.length && nodes.length === 0) {
    return { ...empty, error: custom[0] };
  }
  if (nodes.length === 0 && errors.length > 0) {
    return { ...empty, error: errors[0] };
  }
  return {
    rows: nodes,
    fatal: false,
    retry: false,
    hasNextPage: conn?.pageInfo?.hasNextPage === true,
    endCursor: conn?.pageInfo?.endCursor ?? null,
    customFieldsError: custom[0],
  };
}

/**
 * Use the plain costing query only when the rich query failed because of custom fields
 * and returned no jobs. Any other failure is returned as-is so a permission error is
 * not papered over with a second query. Rows from the rich query are never discarded.
 */
export function fallbackCompletedJobCosts<T>(rich: CostLoad<T>, plain: CostLoad<T> | null): CostLoad<T> {
  if (rich.rows) return rich;
  if (!customFieldSelectionRejected(rich.error) || !plain) return rich;
  if (plain.rows) return { ...plain, customFieldsError: rich.error ?? plain.customFieldsError };
  return plain.error ? plain : { ...plain, error: rich.error };
}
