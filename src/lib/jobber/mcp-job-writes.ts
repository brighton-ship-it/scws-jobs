/**
 * Close a Jobber job. jobComplete was removed.
 *
 * jobClose(jobId: EncodedId!, input: JobCloseInput!) was validated against
 * Jobber's live schema on 2026-09-24 (API 2026-05-12). JobCloseInput requires
 * modifyIncompleteVisitsBy: DESTROY_ALL | COMPLETE_PAST_DESTROY_FUTURE.
 * There is no default: DESTROY_ALL deletes incomplete visits.
 *
 * This does not email or text the client. No visit-reminder mutation is called.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { getJob, type JobberJobSummary } from './mcp-jobs.ts';
import type { JobberDeps } from './quotes.ts';

export const INCOMPLETE_VISIT_DECISIONS = ['DESTROY_ALL', 'COMPLETE_PAST_DESTROY_FUTURE'] as const;
export type IncompleteVisitDecision = (typeof INCOMPLETE_VISIT_DECISIONS)[number];

const DELIVERY_MUTATION = /sendJob|email|sms|visitReminder|jobComplete\b/i;

const JOB_CLOSE = `
  mutation McpJobClose($jobId: EncodedId!, $input: JobCloseInput!) {
    jobClose(jobId: $jobId, input: $input) {
      job { id jobNumber jobStatus completedAt }
      userErrors { message path }
    }
  }
`;

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  if (DELIVERY_MUTATION.test(query)) {
    throw new Error('close_job cannot email, text, or send a job');
  }
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function normalizeIncompleteVisits(value: string | null | undefined): IncompleteVisitDecision {
  const normalized = (value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'DESTROY_ALL' || normalized === 'COMPLETE_PAST_DESTROY_FUTURE') {
    return normalized;
  }
  throw new Error(
    'incompleteVisits is required: DESTROY_ALL (deletes every incomplete visit) or COMPLETE_PAST_DESTROY_FUTURE. jobComplete no longer exists.'
  );
}

export function buildJobCloseInput(incompleteVisits: IncompleteVisitDecision): Record<string, unknown> {
  return { modifyIncompleteVisitsBy: incompleteVisits };
}

export async function closeJob(
  input: {
    jobId?: string | null;
    jobNumber?: string | null;
    incompleteVisits: IncompleteVisitDecision;
  },
  deps?: JobberDeps
): Promise<JobberJobSummary> {
  const existing = await getJob({ jobId: input.jobId, jobNumber: input.jobNumber }, deps);
  const result = await graphql(
    JOB_CLOSE,
    { jobId: existing.id, input: buildJobCloseInput(input.incompleteVisits) },
    deps
  );
  assertNoJobberErrors(result, 'jobClose');
  const payload = result.data?.jobClose;
  const errors = jobberUserErrors(payload);
  if (errors.length) throw new Error(errors.join('; '));
  const job = payload?.job as { id?: string } | undefined;
  if (!job?.id) throw new Error('Jobber jobClose returned no job');
  return getJob({ jobId: job.id }, deps);
}
