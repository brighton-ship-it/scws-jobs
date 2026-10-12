/**
 * Guarded cancel / reschedule writes for the authenticated Production MCP.
 *
 * Tools: cancel_job (visitDelete open visits, jobEdit invoicing NEVER,
 * jobClose, jobCreateNote "Cancelled: ..."), cancel_visit (visitDelete),
 * reschedule_visit (visitEditSchedule, optional visitEditAssignedUsers).
 * Mutation names and inputs follow the hightreequency/jobberschema docs
 * (mutations-jobs.md, mutations-visits.md). jobClose is the one validated
 * live (see mcp-job-writes.ts).
 *
 * NOT reachable from the receptionist (Mike) or any public webhook: this
 * module is only imported by src/lib/mcp/jobber-tools.ts, which sits behind
 * the Bearer-key MCP route. A test asserts the receptionist never imports it.
 *
 * Guards on every call:
 *  - explicit encoded job id (no job number lookup, no search)
 *  - reason string (>= 5 chars)
 *  - refuse when the job has invoices or payments, or is completed /
 *    archived / has a completed visit, unless force=true
 *  - dryRun=true reads the job and returns the before state and the plan
 *    without calling any mutation
 *  - before + after state, an undo note, and an audit line
 *    (console always, public.mcp_write_audit best effort)
 * Nothing here emails, texts, or notifies a client.
 */

import { assertNoJobberErrors, jobberGraphql, jobberUserErrors } from './client.ts';
import { assertNoClientNotification, assertWriteDoesNotDeliver } from './mcp-notify.ts';
import { toShopLocalDateTime, assertEndAfterStart, SHOP_TIMEZONE } from './mcp-schedule.ts';
import type { JobberDeps } from './quotes.ts';

export type CancelVisitState = {
  id: string;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  isComplete: boolean;
  completedAt: string | null;
  assignees: Array<{ id: string | null; name: string | null }>;
};

export type CancelJobState = {
  id: string;
  jobNumber: string | number | null;
  title: string | null;
  jobStatus: string | null;
  completedAt: string | null;
  jobberWebUri: string | null;
  client: { id: string | null; name: string | null } | null;
  address: string | null;
  invoices: Array<{ id: string | null; invoiceNumber: string | number | null; status: string | null; total: number | null; paymentsTotal: number | null }>;
  visits: CancelVisitState[];
};

export type AuditEntry = {
  tool: string;
  actor: string;
  dryRun: boolean;
  ok: boolean;
  refused?: boolean;
  force: boolean;
  reason: string;
  jobId: string | null;
  jobNumber: string | number | null;
  visitId: string | null;
  before: unknown;
  after: unknown;
  error?: string;
  at: string;
};

export type AuditSink = (entry: AuditEntry) => Promise<{ console: boolean; supabase: boolean }>;

export type CancelWriteResult = {
  tool: string;
  dryRun: boolean;
  changed: boolean;
  reason: string;
  plan: string;
  before: CancelJobState;
  after: CancelJobState | null;
  undo: string;
  warnings: string[];
  audit: { console: boolean; supabase: boolean };
  notified: false;
};

const DELIVERY_MUTATION =
  /sendJob|emailCreate|\bsms\b|visitReminder|jobComplete\b|invoiceSend|quoteSend|clientHubMessage|workObjectSend|bookingConfirmation/i;

const JOB_STATE = `
  query McpCancelJobState($id: EncodedId!) {
    job(id: $id) {
      id
      jobNumber
      title
      jobStatus
      completedAt
      jobberWebUri
      client { id name }
      property { address { street1 city province postalCode } }
      invoices(first: 25) {
        nodes { id invoiceNumber invoiceStatus amounts { total paymentsTotal } }
      }
      visits(first: 50) {
        nodes {
          id
          title
          startAt
          endAt
          completedAt
          isComplete
          assignedUsers(first: 10) { nodes { id name { full } } }
        }
      }
    }
  }
`;

const JOB_CLOSE = `
  mutation McpCancelJobClose($jobId: EncodedId!, $input: JobCloseInput!) {
    jobClose(jobId: $jobId, input: $input) {
      job { id jobNumber jobStatus completedAt }
      userErrors { message path }
    }
  }
`;

const JOB_REOPEN = `
  mutation McpCancelJobReopen($jobId: EncodedId!) {
    jobReopen(jobId: $jobId) {
      job { id jobStatus }
      userErrors { message path }
    }
  }
`;

/**
 * A closed Jobber job with no invoice lands in "Requires invoicing", which the
 * office reads as finished work. Setting the invoicing schedule to NEVER first
 * means the close files it under Archived instead. Jobber has no jobDelete and
 * no "cancelled" status, so archived + a cancellation note is the closest.
 */
const JOB_EDIT_NO_INVOICE = `
  mutation McpCancelJobNoInvoice($jobId: EncodedId!, $input: JobEditInput!) {
    jobEdit(jobId: $jobId, input: $input) {
      job { id jobStatus }
      userErrors { message path }
    }
  }
`;

const JOB_NOTE = `
  mutation McpCancelJobNote($jobId: EncodedId!, $input: JobCreateNoteInput!) {
    jobCreateNote(jobId: $jobId, input: $input) {
      jobNote { id }
      userErrors { message path }
    }
  }
`;

const VISIT_DELETE = `
  mutation McpCancelVisitDelete($ids: [EncodedId!]!) {
    visitDelete(visitIds: $ids) {
      visits { id }
      userErrors { message path }
    }
  }
`;

const VISIT_EDIT_SCHEDULE = `
  mutation McpVisitEditSchedule($id: EncodedId!, $input: VisitEditScheduleInput!) {
    visitEditSchedule(id: $id, input: $input) {
      visit { id startAt endAt }
      userErrors { message path }
    }
  }
`;

const VISIT_EDIT_ASSIGNED = `
  mutation McpVisitEditAssigned($visitId: EncodedId!, $input: VisitEditAssignedUsersInput!) {
    visitEditAssignedUsers(visitId: $visitId, input: $input) {
      visit { id }
      userErrors { message path }
    }
  }
`;

function gql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  if (DELIVERY_MUTATION.test(query)) throw new Error('Cancel/reschedule tools cannot email, text, or send');
  assertWriteDoesNotDeliver(query);
  assertNoClientNotification(variables);
  return jobberGraphql(query, variables, { token: deps?.token, fetchImpl: deps?.fetchImpl, env: deps?.env });
}

export function parseReason(value: unknown): string {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason.length < 5) throw new Error('reason is required (at least 5 characters): say who asked and why.');
  return reason.slice(0, 500);
}

/** Only an encoded Jobber id. Job numbers are refused on purpose. */
export function parseExplicitId(value: unknown, field: string): string {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw new Error(`${field} is required (explicit encoded Jobber id, not a job number)`);
  if (/^#?\d{1,7}$/.test(id)) throw new Error(`${field} must be the encoded Jobber id, not a job number`);
  if (!/^[A-Za-z0-9+/_=-]{8,}$/.test(id)) throw new Error(`${field} is not a valid encoded Jobber id`);
  return id;
}

function money(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function summarizeJobState(raw: any): CancelJobState {
  const addr = raw?.property?.address;
  const address = addr ? [addr.street1, addr.city, addr.province, addr.postalCode].filter(Boolean).join(', ') || null : null;
  return {
    id: String(raw.id),
    jobNumber: raw.jobNumber ?? null,
    title: raw.title ?? null,
    jobStatus: raw.jobStatus ?? null,
    completedAt: raw.completedAt ?? null,
    jobberWebUri: raw.jobberWebUri ?? null,
    client: raw.client ? { id: raw.client.id ?? null, name: raw.client.name ?? null } : null,
    address,
    invoices: ((raw.invoices?.nodes || []) as any[]).filter(Boolean).map((i) => ({
      id: i.id ?? null,
      invoiceNumber: i.invoiceNumber ?? null,
      status: i.invoiceStatus ?? null,
      total: money(i.amounts?.total),
      paymentsTotal: money(i.amounts?.paymentsTotal),
    })),
    visits: ((raw.visits?.nodes || []) as any[]).filter(Boolean).map((v) => ({
      id: String(v.id),
      title: v.title ?? null,
      startAt: v.startAt ?? null,
      endAt: v.endAt ?? null,
      isComplete: Boolean(v.isComplete || v.completedAt),
      completedAt: v.completedAt ?? null,
      assignees: ((v.assignedUsers?.nodes || []) as any[]).filter(Boolean).map((u) => ({
        id: u.id ?? null,
        name: u.name?.full ?? (typeof u.name === 'string' ? u.name : null),
      })),
    })),
  };
}

export async function loadJobState(jobId: string, deps?: JobberDeps): Promise<CancelJobState> {
  const result = await gql(JOB_STATE, { id: jobId }, deps);
  assertNoJobberErrors(result, 'job');
  const job = result.data?.job;
  if (!job?.id) throw new Error(`Jobber job ${jobId} not found`);
  return summarizeJobState(job);
}

const DONE_STATUSES = new Set(['completed', 'archived', 'requires_invoicing', 'closed']);

/** Pure guard check. Returns the reasons to refuse (empty = ok). */
export function guardBlockers(
  state: CancelJobState,
  op: 'cancel_job' | 'cancel_visit' | 'reschedule_visit',
  visit?: CancelVisitState
): string[] {
  const out: string[] = [];
  const status = (state.jobStatus || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (state.completedAt || DONE_STATUSES.has(status)) out.push(`job is ${status || 'completed'}`);
  if (op === 'cancel_job' && state.visits.some((v) => v.isComplete)) out.push('job has a completed visit');
  if (visit?.isComplete) out.push('visit is already completed');
  if (state.invoices.length) {
    out.push(`job has ${state.invoices.length} invoice(s)`);
  }
  const paid = state.invoices.reduce((sum, i) => sum + (i.paymentsTotal || 0), 0);
  if (paid > 0) out.push(`job has $${paid.toFixed(2)} in payments`);
  return out;
}

function visitUndoArgs(jobId: string, v: CancelVisitState) {
  return {
    jobId,
    title: v.title,
    startAt: v.startAt,
    endAt: v.endAt,
    assigneeIds: v.assignees.map((a) => a.id).filter(Boolean),
  };
}

export const defaultAuditSink: AuditSink = async (entry) => {
  const line = JSON.stringify(entry);
  let consoleOk = false;
  try {
    console.log(`[mcp-write-audit] ${line}`);
    consoleOk = true;
  } catch {
    /* ignore */
  }
  let supabaseOk = false;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (url && key && url !== 'your-supabase-url') {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await client.from('mcp_write_audit').insert({
        tool: entry.tool,
        actor: entry.actor,
        dry_run: entry.dryRun,
        ok: entry.ok,
        refused: entry.refused ?? false,
        force: entry.force,
        reason: entry.reason,
        job_id: entry.jobId,
        job_number: entry.jobNumber == null ? null : String(entry.jobNumber),
        visit_id: entry.visitId,
        before_state: entry.before as any,
        after_state: entry.after as any,
        error: entry.error ?? null,
      });
      supabaseOk = !error;
    }
  } catch {
    /* table may not exist yet; console line is the durable record */
  }
  return { console: consoleOk, supabase: supabaseOk };
};

type CommonInput = {
  jobId: unknown;
  reason: unknown;
  force?: boolean;
  dryRun?: boolean;
  actor?: string;
};

async function run(
  tool: 'cancel_job' | 'cancel_visit' | 'reschedule_visit',
  input: CommonInput & { visitId?: unknown },
  deps: JobberDeps | undefined,
  audit: AuditSink,
  exec: (ctx: { state: CancelJobState; visit?: CancelVisitState }) => Promise<{ plan: string; undo: string; warnings: string[]; apply: () => Promise<void> }>
): Promise<CancelWriteResult> {
  const reason = parseReason(input.reason);
  const jobId = parseExplicitId(input.jobId, 'jobId');
  const visitId = tool === 'cancel_job' ? null : parseExplicitId(input.visitId, 'visitId');
  const force = input.force === true;
  const dryRun = input.dryRun === true;
  const actor = input.actor || 'mcp';
  const base = { tool, actor, dryRun, force, reason, jobId, visitId };

  const state = await loadJobState(jobId, deps);
  const visit = visitId ? state.visits.find((v) => v.id === visitId) : undefined;
  if (visitId && !visit) {
    const error = `visit ${visitId} does not belong to job ${state.jobNumber ?? jobId}`;
    await audit({ ...base, ok: false, refused: true, jobNumber: state.jobNumber, before: state, after: null, error, at: new Date().toISOString() });
    throw new Error(error);
  }
  const blockers = guardBlockers(state, tool, visit);
  if (blockers.length && !force) {
    const error = `Refused: ${blockers.join('; ')}. Pass force=true only if the office confirmed this.`;
    await audit({ ...base, ok: false, refused: true, jobNumber: state.jobNumber, before: state, after: null, error, at: new Date().toISOString() });
    throw new Error(error);
  }

  const plan = await exec({ state, visit });
  const warnings = [...plan.warnings];
  if (blockers.length) warnings.push(`force=true overrode: ${blockers.join('; ')}`);

  if (dryRun) {
    const sink = await audit({ ...base, ok: true, jobNumber: state.jobNumber, before: state, after: null, at: new Date().toISOString() });
    return {
      tool, dryRun: true, changed: false, reason, plan: `DRY RUN, nothing changed. Would: ${plan.plan}`,
      before: state, after: null, undo: plan.undo, warnings, audit: sink, notified: false,
    };
  }

  try {
    await plan.apply();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit({ ...base, ok: false, jobNumber: state.jobNumber, before: state, after: null, error: message, at: new Date().toISOString() });
    throw error;
  }
  const after = await loadJobState(jobId, deps).catch(() => null);
  const sink = await audit({ ...base, ok: true, jobNumber: state.jobNumber, before: state, after, at: new Date().toISOString() });
  return { tool, dryRun: false, changed: true, reason, plan: plan.plan, before: state, after, undo: plan.undo, warnings, audit: sink, notified: false };
}

export function cancelJob(input: CommonInput, deps?: JobberDeps, audit: AuditSink = defaultAuditSink) {
  return run('cancel_job', input, deps, audit, async ({ state }) => {
    const open = state.visits.filter((v) => !v.isComplete);
    const status = (state.jobStatus || '').toLowerCase();
    const alreadyClosed = Boolean(state.completedAt) || status === 'requires_invoicing' || status === 'archived';
    const reason = parseReason(input.reason);
    const step = async (query: string, vars: Record<string, unknown>, key: string) => {
      const result = await gql(query, vars, deps);
      assertNoJobberErrors(result, key);
      const errors = jobberUserErrors(result.data?.[key]);
      if (errors.length) throw new Error(`${key}: ${errors.join('; ')}`);
    };
    return {
      plan:
        (alreadyClosed ? `jobReopen job #${state.jobNumber} (it was closed as ${status || 'completed'}), then ` : '') +
        `visitDelete ${open.length} open visit(s) on job #${state.jobNumber} (${state.client?.name || 'client'}), ` +
        `set invoicing to NEVER so it is not "Requires invoicing", jobClose (no visit is marked complete), ` +
        `and add the note "Cancelled: ${reason}"`,
      undo:
        `Reopen job #${state.jobNumber} in Jobber (job page > More > Reopen job), set invoicing back to On completion, then recreate the visits with create_visit: ` +
        JSON.stringify(open.map((v) => visitUndoArgs(state.id, v))),
      warnings: [],
      apply: async () => {
        if (alreadyClosed) await step(JOB_REOPEN, { jobId: state.id }, 'jobReopen');
        // Delete the scheduled visits explicitly. Never visitComplete, never COMPLETE_PAST_*.
        if (open.length) await step(VISIT_DELETE, { ids: open.map((v) => v.id) }, 'visitDelete');
        await step(JOB_EDIT_NO_INVOICE, { jobId: state.id, input: { invoicing: { invoicingSchedule: 'NEVER' } } }, 'jobEdit');
        await step(JOB_CLOSE, { jobId: state.id, input: { modifyIncompleteVisitsBy: 'DESTROY_ALL' } }, 'jobClose');
        await step(JOB_NOTE, { jobId: state.id, input: { message: `Cancelled: ${reason}. Visits removed, not completed. No invoice needed.` } }, 'jobCreateNote');
      },
    };
  });
}

export function cancelVisit(input: CommonInput & { visitId: unknown }, deps?: JobberDeps, audit: AuditSink = defaultAuditSink) {
  return run('cancel_visit', input, deps, audit, async ({ state, visit }) => {
    const v = visit!;
    const remaining = state.visits.filter((x) => !x.isComplete && x.id !== v.id);
    return {
      plan: `visitDelete visit ${v.id} (${v.startAt} to ${v.endAt}, ${v.assignees.map((a) => a.name).join(', ') || 'unassigned'}) on job #${state.jobNumber}`,
      undo: `Recreate with create_visit: ${JSON.stringify(visitUndoArgs(state.id, v))}`,
      warnings: remaining.length ? [] : ['This is the last open visit; the job will have no scheduled visit. Use cancel_job if the job itself is cancelled.'],
      apply: async () => {
        const result = await gql(VISIT_DELETE, { ids: [v.id] }, deps);
        assertNoJobberErrors(result, 'visitDelete');
        const errors = jobberUserErrors(result.data?.visitDelete);
        if (errors.length) throw new Error(errors.join('; '));
      },
    };
  });
}

export function rescheduleVisit(
  input: CommonInput & { visitId: unknown; startAt: unknown; endAt: unknown; assigneeIds?: string[] },
  deps?: JobberDeps,
  audit: AuditSink = defaultAuditSink
) {
  const startRaw = typeof input.startAt === 'string' ? input.startAt : '';
  const endRaw = typeof input.endAt === 'string' ? input.endAt : '';
  const start = toShopLocalDateTime(startRaw, 'startAt');
  const end = toShopLocalDateTime(endRaw, 'endAt');
  assertEndAfterStart(start, end);
  const assigneeIds = (input.assigneeIds || []).filter((x) => typeof x === 'string' && x.trim());
  return run('reschedule_visit', input, deps, audit, async ({ state, visit }) => {
    const v = visit!;
    const who = assigneeIds.length ? ` and assign to ${assigneeIds.join(', ')}` : '';
    return {
      plan: `visitEditSchedule visit ${v.id} to ${start.date} ${start.time} - ${end.date} ${end.time} ${SHOP_TIMEZONE}${who}`,
      undo:
        `reschedule_visit with jobId ${state.id}, visitId ${v.id}, startAt ${v.startAt}, endAt ${v.endAt}` +
        (assigneeIds.length ? `, assigneeIds ${JSON.stringify(v.assignees.map((a) => a.id))}` : ''),
      warnings: [],
      apply: async () => {
        const input1 = { startAt: start, endAt: end };
        assertNoClientNotification(input1);
        const result = await gql(VISIT_EDIT_SCHEDULE, { id: v.id, input: input1 }, deps);
        assertNoJobberErrors(result, 'visitEditSchedule');
        const errors = jobberUserErrors(result.data?.visitEditSchedule);
        if (errors.length) throw new Error(errors.join('; '));
        if (assigneeIds.length) {
          const r2 = await gql(VISIT_EDIT_ASSIGNED, { visitId: v.id, input: { assignedUserIds: assigneeIds } }, deps);
          assertNoJobberErrors(r2, 'visitEditAssignedUsers');
          const e2 = jobberUserErrors(r2.data?.visitEditAssignedUsers);
          if (e2.length) throw new Error(`Time was changed but assignment failed: ${e2.join('; ')}. Undo: ${JSON.stringify(visitUndoArgs(state.id, v))}`);
        }
      },
    };
  });
}
