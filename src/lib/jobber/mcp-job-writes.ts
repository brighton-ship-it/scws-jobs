/**
 * Job writes: close, create a one-off job, and schedule a visit.
 *
 * jobClose(jobId: EncodedId!, input: JobCloseInput!) was validated against
 * Jobber's live schema on 2026-09-24 (API 2026-05-12). JobCloseInput requires
 * modifyIncompleteVisitsBy: DESTROY_ALL | COMPLETE_PAST_DESTROY_FUTURE.
 * There is no default: DESTROY_ALL deletes incomplete visits.
 *
 * jobCreate and visitCreate were checked against the public introspection at
 * API version 2025-01-20. The gateway pin stays 2025-04-16. The 2025-04-16
 * changelog changes JobCreateAttributes.jobFormIds and customFields only;
 * this module sends neither.
 *
 * jobCreate cannot take a visit datetime. JobSchedulingAttributes has
 * createVisits, notifyTeam (both required), assignedTo, startTime/endTime
 * (time of day, not a date), and recurrence. create_job always sends
 * createVisits: false and notifyTeam: false, omits recurrence (that is the
 * one-off job; jobType is not an input), and calls visitCreate when startAt
 * and endAt are provided.
 *
 * visitCreate(jobId, input: VisitCreateInput!). VisitCreateInput.visits is
 * [VisitCreateAttributes!]!. The schedule is ScheduledItemAttributes, not an
 * ISO timestamp. notifyTeam is false. teamReminderOffset is omitted.
 *
 * JobCreateLineItemAttributes has no productOrServiceId. A catalog id is
 * loaded with product(id) and name / street defaultUnitCost are copied.
 * saveToProductsAndServices is false. allowReviewRequest is false.
 *
 * This does not email or text the client. No visit-reminder mutation is called.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { propertyIds } from './mcp-client-writes.ts';
import { getJob, type JobberJobSummary } from './mcp-jobs.ts';
import { assertNoClientNotification, assertWriteDoesNotDeliver } from './mcp-notify.ts';
import { getClientById } from './mcp-quotes.ts';
import { buildScheduledItemAttributes } from './mcp-schedule.ts';
import { resolveQuoteCreatePropertyId, type JobberDeps } from './quotes.ts';

export const INCOMPLETE_VISIT_DECISIONS = ['DESTROY_ALL', 'COMPLETE_PAST_DESTROY_FUTURE'] as const;
export type IncompleteVisitDecision = (typeof INCOMPLETE_VISIT_DECISIONS)[number];

const DELIVERY_MUTATION =
  /sendJob|emailCreate|\bsms\b|visitReminder|jobComplete\b|invoiceSend|quoteSend|clientHubMessage|workObjectSend|bookingConfirmation/i;

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
    throw new Error('Job writes cannot email, text, or send a job');
  }
  assertWriteDoesNotDeliver(query);
  assertNoClientNotification(variables);
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

const JOB_CREATE = `
  mutation McpJobCreate($input: JobCreateAttributes!) {
    jobCreate(input: $input) {
      job {
        id
        jobNumber
        title
        jobStatus
        jobType
        instructions
        jobberWebUri
        client { id name }
        property { id address { street1 city } }
      }
      userErrors { message path }
    }
  }
`;

const VISIT_CREATE = `
  mutation McpVisitCreate($jobId: EncodedId!, $input: VisitCreateInput!) {
    visitCreate(jobId: $jobId, input: $input) {
      createdVisits {
        id
        title
        startAt
        endAt
        instructions
        assignedUsers(first: 8) { nodes { id name { full } } }
      }
      userErrors { message path }
    }
  }
`;

const PRODUCT_BY_ID = `
  query McpProductById($id: EncodedId!) {
    product(id: $id) {
      id
      name
      description
      defaultUnitCost
      taxable
      category
    }
  }
`;

export const JOB_CREATE_LIMITATIONS = [
  'jobCreate cannot set a visit start/end datetime. JobSchedulingAttributes.startTime and endTime are times of day, so create_job sets createVisits false and notifyTeam false, then calls visitCreate when startAt and endAt are set.',
  'JobCreateLineItemAttributes has no productOrServiceId. A catalog id is loaded with product(id) and the street price (defaultUnitCost) is copied. saveToProductsAndServices is false.',
  'Recurrence is omitted. That is the one-off job. jobType is not an argument on jobCreate.',
  'notifyTeam and allowReviewRequest are false. visitConfirmationStatus is not set. Nothing is emailed or texted.',
];

export type JobLineDraft = {
  name?: string;
  description?: string;
  quantity: number;
  unitPrice?: number;
  taxable?: boolean;
  productOrServiceId?: string;
};

export type CreatedJob = {
  id: string;
  jobNumber: string | number | null;
  title: string | null;
  jobStatus: string | null;
  jobType: string | null;
  instructions: string | null;
  jobberWebUri: string | null;
  client: { id: string | null; name: string | null } | null;
  property: { id: string | null; city: string | null; street1: string | null } | null;
};

export type CreatedVisit = {
  id: string;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  instructions: string | null;
  assignees: Array<{ id: string | null; name: string | null }>;
};

export type CreateJobResult = {
  notified: false;
  job: CreatedJob;
  visits: CreatedVisit[];
  visitError: string | null;
  limitations: string[];
};

type ProductNode = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  defaultUnitCost?: number | null;
  taxable?: boolean | null;
  category?: string | null;
};

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function parseAssigneeIds(value: unknown, field = 'assigneeIds'): string[] {
  if (value == null || value === '') return [];
  const list = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(list)) throw new Error(`${field} must be an array of user ids`);
  return list.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) throw new Error(`${field}[${index}] must be a user id`);
    return item.trim();
  });
}

export function parseJobLineDrafts(value: unknown): JobLineDraft[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('lineItems must be an array');
  return value.map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const name = optionalText(row.name);
    const productOrServiceId = optionalText(row.productOrServiceId);
    const quantity = Number(row.quantity);
    const unitPrice = row.unitPrice == null || row.unitPrice === '' ? undefined : Number(row.unitPrice);
    if (!name && !productOrServiceId) throw new Error(`lineItems[${index}].name is required`);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`lineItems[${index}].quantity must be a positive number`);
    }
    if (unitPrice != null && !Number.isFinite(unitPrice)) {
      throw new Error(`lineItems[${index}].unitPrice must be a number`);
    }
    if (unitPrice == null && !productOrServiceId) {
      throw new Error(`lineItems[${index}].unitPrice is required`);
    }
    let taxable: boolean | undefined;
    if (row.taxable === true || row.taxable === false) taxable = row.taxable;
    return {
      name,
      description: optionalText(row.description),
      quantity,
      unitPrice,
      taxable,
      productOrServiceId,
    };
  });
}

export function buildJobCreateInput(input: {
  propertyId: string;
  title: string;
  instructions?: string | null;
  lineItems?: Array<Record<string, unknown>>;
}): Record<string, unknown> {
  const title = input.title.trim();
  if (!title) throw new Error('title is required');
  const attributes: Record<string, unknown> = {
    propertyId: input.propertyId,
    title,
    allowReviewRequest: false,
    scheduling: {
      createVisits: false,
      notifyTeam: false,
    },
    invoicing: {
      invoicingType: 'FIXED_PRICE',
      invoicingSchedule: 'ON_COMPLETION',
    },
  };
  const instructions = input.instructions?.trim();
  if (instructions) attributes.instructions = instructions;
  if (input.lineItems?.length) attributes.lineItems = input.lineItems;
  assertNoClientNotification(attributes);
  return attributes;
}

export function buildVisitCreateInput(input: {
  title?: string | null;
  instructions?: string | null;
  startAt: string;
  endAt: string;
  assigneeIds?: string[];
}): Record<string, unknown> {
  const visit: Record<string, unknown> = {
    schedule: buildScheduledItemAttributes({
      startAt: input.startAt,
      endAt: input.endAt,
      assigneeIds: input.assigneeIds,
    }),
  };
  const title = input.title?.trim();
  const instructions = input.instructions?.trim();
  if (title) visit.title = title;
  if (instructions) visit.instructions = instructions;
  const payload = { visits: [visit] };
  assertNoClientNotification(payload);
  return payload;
}

async function lineItemsForJob(lines: JobLineDraft[], deps?: JobberDeps): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const [index, line] of lines.entries()) {
    let name = line.name;
    let description = line.description;
    let unitPrice = line.unitPrice;
    let taxable = line.taxable;
    let category: string | undefined;
    if (line.productOrServiceId) {
      const result = await graphql(PRODUCT_BY_ID, { id: line.productOrServiceId }, deps);
      assertNoJobberErrors(result, 'product');
      const product = result.data?.product as ProductNode | null | undefined;
      if (!product?.id) throw new Error(`Jobber product ${line.productOrServiceId} not found`);
      name = name || product.name || undefined;
      if (!description && product.description) description = product.description;
      if (unitPrice == null && typeof product.defaultUnitCost === 'number') unitPrice = product.defaultUnitCost;
      if (taxable == null && typeof product.taxable === 'boolean') taxable = product.taxable;
      if (product.category === 'PRODUCT' || product.category === 'SERVICE') category = product.category;
    }
    if (!name) throw new Error(`lineItems[${index}].name is required`);
    if (unitPrice == null || !Number.isFinite(unitPrice)) {
      throw new Error(`lineItems[${index}].unitPrice is required`);
    }
    const row: Record<string, unknown> = {
      name,
      quantity: line.quantity,
      unitPrice,
      saveToProductsAndServices: false,
    };
    if (description) row.description = description;
    if (typeof taxable === 'boolean') row.taxable = taxable;
    if (category) row.category = category;
    rows.push(row);
  }
  return rows;
}

function summarizeCreatedJob(node: Record<string, unknown> | null | undefined): CreatedJob | null {
  if (!node || typeof node.id !== 'string') return null;
  const client = node.client as { id?: string | null; name?: string | null } | null | undefined;
  const property = node.property as
    | { id?: string | null; address?: { street1?: string | null; city?: string | null } | null }
    | null
    | undefined;
  return {
    id: node.id,
    jobNumber: (node.jobNumber as string | number | null) ?? null,
    title: (node.title as string | null) ?? null,
    jobStatus: (node.jobStatus as string | null) ?? null,
    jobType: (node.jobType as string | null) ?? null,
    instructions: (node.instructions as string | null) ?? null,
    jobberWebUri: (node.jobberWebUri as string | null) ?? null,
    client: client ? { id: client.id ?? null, name: client.name ?? null } : null,
    property: property
      ? {
          id: property.id ?? null,
          city: property.address?.city ?? null,
          street1: property.address?.street1 ?? null,
        }
      : null,
  };
}

function summarizeVisit(node: Record<string, unknown>): CreatedVisit | null {
  if (typeof node.id !== 'string') return null;
  const assigned = node.assignedUsers as
    | { nodes?: Array<{ id?: string | null; name?: { full?: string | null } | null } | null> | null }
    | null
    | undefined;
  return {
    id: node.id,
    title: (node.title as string | null) ?? null,
    startAt: (node.startAt as string | null) ?? null,
    endAt: (node.endAt as string | null) ?? null,
    instructions: (node.instructions as string | null) ?? null,
    assignees: (assigned?.nodes || [])
      .filter((user): user is NonNullable<typeof user> => Boolean(user))
      .map((user) => ({ id: user.id ?? null, name: user.name?.full ?? null })),
  };
}

export async function createJob(
  input: {
    clientId: string;
    propertyId?: string | null;
    title: string;
    instructions?: string | null;
    lineItems?: JobLineDraft[];
    startAt?: string | null;
    endAt?: string | null;
    assigneeIds?: string[];
  },
  deps?: JobberDeps
): Promise<CreateJobResult> {
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error('clientId is required');
  const startAt = input.startAt?.trim() || '';
  const endAt = input.endAt?.trim() || '';
  if (Boolean(startAt) !== Boolean(endAt)) {
    throw new Error('startAt and endAt are both required to schedule the first visit');
  }
  if ((input.assigneeIds?.length || 0) > 0 && !startAt) {
    throw new Error('startAt and endAt are required when assigneeIds are set');
  }
  const client = await getClientById(clientId, deps);
  const propertyId = resolveQuoteCreatePropertyId(input.propertyId, client.properties);
  if (!propertyIds(client).includes(propertyId)) {
    throw new Error(`propertyId ${propertyId} is not on client ${clientId}`);
  }
  const lineItems = await lineItemsForJob(input.lineItems || [], deps);
  const attributes = buildJobCreateInput({
    propertyId,
    title: input.title,
    instructions: input.instructions,
    lineItems,
  });
  const created = await graphql(JOB_CREATE, { input: attributes }, deps);
  assertNoJobberErrors(created, 'jobCreate');
  const payload = created.data?.jobCreate;
  const errors = jobberUserErrors(payload);
  if (errors.length) throw new Error(errors.join('; '));
  const job = summarizeCreatedJob(payload?.job);
  if (!job) throw new Error('Jobber jobCreate returned no job');

  let visits: CreatedVisit[] = [];
  let visitError: string | null = null;
  if (startAt) {
    try {
      visits = await scheduleVisit(
        job.id,
        {
          title: input.title,
          instructions: input.instructions,
          startAt,
          endAt,
          assigneeIds: input.assigneeIds,
        },
        deps
      );
    } catch (error) {
      visitError = error instanceof Error ? error.message : 'visitCreate failed';
    }
  }

  return {
    notified: false,
    job,
    visits,
    visitError,
    limitations: JOB_CREATE_LIMITATIONS,
  };
}

async function scheduleVisit(
  jobId: string,
  input: {
    title?: string | null;
    instructions?: string | null;
    startAt: string;
    endAt: string;
    assigneeIds?: string[];
  },
  deps?: JobberDeps
): Promise<CreatedVisit[]> {
  const variables = {
    jobId,
    input: buildVisitCreateInput(input),
  };
  const created = await graphql(VISIT_CREATE, variables, deps);
  assertNoJobberErrors(created, 'visitCreate');
  const payload = created.data?.visitCreate;
  const errors = jobberUserErrors(payload);
  if (errors.length) throw new Error(errors.join('; '));
  const visits = ((payload?.createdVisits || []) as Array<Record<string, unknown>>)
    .map(summarizeVisit)
    .filter((visit): visit is CreatedVisit => Boolean(visit));
  if (!visits.length) throw new Error('Jobber visitCreate returned no visit');
  return visits;
}

export async function createVisit(
  input: {
    jobId?: string | null;
    jobNumber?: string | null;
    title?: string | null;
    instructions?: string | null;
    startAt: string;
    endAt: string;
    assigneeIds?: string[];
  },
  deps?: JobberDeps
): Promise<CreatedVisit[]> {
  const existing = await getJob({ jobId: input.jobId, jobNumber: input.jobNumber }, deps);
  return scheduleVisit(existing.id, input, deps);
}

export function parseCreateJobArgs(args: Record<string, unknown>): {
  clientId: string;
  propertyId?: string;
  title: string;
  instructions?: string;
  lineItems: JobLineDraft[];
  startAt?: string;
  endAt?: string;
  assigneeIds: string[];
} {
  return {
    clientId: requiredText(args.clientId, 'clientId'),
    propertyId: optionalText(args.propertyId),
    title: requiredText(args.title, 'title'),
    instructions: optionalText(args.instructions),
    lineItems: parseJobLineDrafts(args.lineItems),
    startAt: optionalText(args.startAt),
    endAt: optionalText(args.endAt),
    assigneeIds: parseAssigneeIds(args.assigneeIds),
  };
}

export function parseCreateVisitArgs(args: Record<string, unknown>): {
  jobId?: string;
  jobNumber?: string;
  title?: string;
  instructions?: string;
  startAt: string;
  endAt: string;
  assigneeIds: string[];
} {
  return {
    jobId: optionalText(args.jobId),
    jobNumber: optionalText(args.jobNumber),
    title: optionalText(args.title),
    instructions: optionalText(args.instructions),
    startAt: requiredText(args.startAt, 'startAt'),
    endAt: requiredText(args.endAt, 'endAt'),
    assigneeIds: parseAssigneeIds(args.assigneeIds),
  };
}
