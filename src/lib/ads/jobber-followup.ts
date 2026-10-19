/**
 * Live Jobber reads the mirror does not store: archived/cancelled jobs, requests,
 * visit times, invoice numbers, due dates, and invoice send history.
 * A failed channel is reported, not counted as zero.
 */
import { jobberGraphql } from '../jobber/client.ts';
import { digits10 } from './call-dashboard.ts';
import { isInternalJob } from './internal-job.ts';
import type { CollectionEvent } from './callbacks.ts';

export interface JobberInvoiceExtra {
  id: string;
  number: string | null;
  dueAt: string | null;
  emails: string[];
  phones: string[];
  comms: CollectionEvent[];
}

export interface JobberFollowUp {
  work: Array<{ phone: string | null; at: string }>;
  invoices: JobberInvoiceExtra[];
  channels: { jobberTexts: boolean; emails: boolean };
  notes: string[];
}

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<{ data?: any; errors?: Array<{ message?: string }> }>;

function phonesOf(client: any): string[] {
  const raw = client?.phones ?? [];
  return raw.map((p: any) => digits10(typeof p === 'string' ? p : p?.number)).filter((p: string | null): p is string => !!p);
}

async function read(gql: Gql, query: string, variables: Record<string, unknown>): Promise<any> {
  const res = await gql(query, variables);
  const msg = res.errors?.[0]?.message;
  if (msg) throw new Error(msg);
  return res.data;
}

function pushWork(out: Array<{ phone: string | null; at: string }>, phones: string[], at: string | null | undefined) {
  if (!at || !Number.isFinite(Date.parse(at))) return;
  if (!phones.length) return;
  for (const phone of phones) out.push({ phone, at });
}

const JOBS = `query ArchJobs($first: Int!, $after: String, $filter: JobFilterAttributes) {
  jobs(first: $first, after: $after, filter: $filter) {
    nodes { id title createdAt jobStatus client { id name companyName phones { number } } VISITS }
    pageInfo { hasNextPage endCursor }
  }
}`;
const VISITS = `visits(first: 15) { nodes { id createdAt startAt } }`;

const NEW_CLIENTS = `query NewClients($first: Int!, $after: String, $filter: ClientFilterAttributes) {
  clients(first: $first, after: $after, filter: $filter) {
    nodes {
      id name companyName createdAt phones { number }
      jobs(first: 10) { nodes { id title createdAt } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const REQUESTS = `query ShopReqs($first: Int!, $after: String, $filter: RequestFilterAttributes) {
  requests(first: $first, after: $after, filter: $filter) {
    nodes { id createdAt client { id phones { number } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const INVOICES = `query OpenInv($first: Int!, $after: String, $filter: InvoiceFilterAttributes) {
  invoices(first: $first, after: $after, filter: $filter) {
    nodes {
      id invoiceNumber invoiceStatus issuedDate dueDate
      client { id emails { address } phones { number } }
      COMMS
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

/** Tried in order. A selection that errors is skipped. Undated nodes are not counted as zero. */
export const COMM_PROBES = [
  `linkedCommunications(first: 20) { nodes { __typename id createdAt channel commType } }`,
  `linkedCommunications(first: 20) { nodes { __typename id sentAt channel commType } }`,
  `linkedCommunications(first: 20) { nodes { __typename id timestamp } }`,
  `linkedCommunications(first: 20) { nodes { __typename id createdAt } }`,
  `linkedCommunications(first: 20) { nodes { __typename id } }`,
  `linkedCommunications(first: 20) { nodes { __typename id ... on EmailMessage { createdAt subject } ... on SmsMessage { createdAt } ... on TextMessage { createdAt } ... on ClientEmail { createdAt } ... on ClientSms { createdAt } } }`,
];

function classifyComm(node: any): 'email' | 'text' | null {
  const type = `${node?.__typename ?? ''} ${node?.channel ?? ''} ${node?.commType ?? ''} ${node?.messageType ?? ''} ${node?.deliveryType ?? ''} ${node?.kind ?? ''}`.toLowerCase();
  if (/email/.test(type)) return 'email';
  if (/\bsms\b|\btext\b/.test(type)) return 'text';
  return null;
}

function emailsOf(client: any): string[] {
  const raw = Array.isArray(client?.emails) ? client.emails : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const email = String(typeof entry === 'string' ? entry : entry?.address ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

export function commsFromNodes(
  clientId: string | null,
  nodes: any[],
  invoiceNumber?: string | null,
): { events: CollectionEvent[]; classified: boolean } {
  let classified = false;
  const events: CollectionEvent[] = [];
  const num = invoiceNumber == null || invoiceNumber === '' ? null : String(invoiceNumber);
  for (const node of nodes ?? []) {
    const kind = classifyComm(node);
    if (!kind) continue;
    classified = true;
    const at = node.createdAt || node.sentAt || node.timestamp;
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    events.push({
      at: String(at),
      channel: kind,
      source: kind === 'email' ? 'jobber_email' : 'jobber_sms',
      clientId,
      by: node.sender?.name ?? node.user?.name ?? null,
      subject: typeof node.subject === 'string' ? node.subject : null,
      invoiceNumbers: num ? [num] : null,
    });
  }
  return { events, classified };
}

/**
 * Jobber's InvoiceFilterAttributes takes `status` (one InvoiceStatusTypeEnum). Older code sent
 * `invoiceStatus: [..]`, which Jobber rejects ("Field is not defined on InvoiceFilterAttributes").
 * Tried in order; the first shape Jobber accepts is used for every page.
 */
export type InvoiceStatusFilterShape = 'status' | 'STATUS' | 'invoiceStatus' | 'INVOICE_STATUS';
export const INVOICE_FILTER_SHAPES: InvoiceStatusFilterShape[] = ['status', 'STATUS', 'invoiceStatus', 'INVOICE_STATUS'];

export function invoiceStatusFilter(shape: InvoiceStatusFilterShape, status: string): Record<string, unknown> {
  const lower = status.toLowerCase();
  switch (shape) {
    case 'status': return { status: lower };
    case 'STATUS': return { status: lower.toUpperCase() };
    case 'invoiceStatus': return { invoiceStatus: [lower] };
    case 'INVOICE_STATUS': return { invoiceStatus: [lower.toUpperCase()] };
  }
}

function filterShapeError(msg: string): boolean {
  return /invoiceStatus|status|InvoiceStatusTypeEnum|enum|InvoiceFilterAttributes|invalid value/i.test(msg);
}

/** First filter shape Jobber accepts for a past-due invoice read (no comms selection). */
export async function probeInvoiceFilter(gql: Gql): Promise<InvoiceStatusFilterShape | null> {
  let lastError: unknown = null;
  for (const shape of INVOICE_FILTER_SHAPES) {
    try {
      await read(gql, INVOICES.replace('COMMS', ''), { first: 1, after: null, filter: invoiceStatusFilter(shape, 'past_due') });
      return shape;
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : '';
      if (!filterShapeError(msg)) throw error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

async function probeInvoiceComms(gql: Gql, shape: InvoiceStatusFilterShape): Promise<{ selection: string; dated: boolean } | null> {
  for (const selection of COMM_PROBES) {
    try {
      await read(gql, INVOICES.replace('COMMS', selection), { first: 1, after: null, filter: invoiceStatusFilter(shape, 'past_due') });
      return { selection, dated: /createdAt|sentAt|timestamp/.test(selection) };
    } catch {
      // that selection is not in this Jobber schema; try the next one
    }
  }
  return null;
}

async function pageAll(gql: Gql, query: string, filter: Record<string, unknown>, pick: (data: any) => { nodes: any[]; next: string | null }, cap: number): Promise<any[]> {
  const rows: any[] = [];
  let after: string | null = null;
  for (let i = 0; i < cap; i++) {
    const data = await read(gql, query, { first: 25, after, filter });
    const page = pick(data);
    rows.push(...page.nodes);
    after = page.next;
    if (!after) break;
  }
  return rows;
}

export async function loadJobberFollowUp(sinceIso: string, gql: Gql = jobberGraphql): Promise<JobberFollowUp> {
  const work: Array<{ phone: string | null; at: string }> = [];
  const notes: string[] = [];
  const created = { after: sinceIso };

  let visitsOk = true;
  try {
    let nodes: any[] = [];
    try {
      nodes = await pageAll(gql, JOBS.replace('VISITS', VISITS), { status: 'archived', createdAt: created }, (data) => ({
        nodes: data?.jobs?.nodes ?? [],
        next: data?.jobs?.pageInfo?.hasNextPage ? data.jobs.pageInfo.endCursor : null,
      }), 8);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (/visit/i.test(msg)) {
        visitsOk = false;
        notes.push('Jobber visits unavailable');
        nodes = await pageAll(gql, JOBS.replace('VISITS', ''), { status: 'archived', createdAt: created }, (data) => ({
          nodes: data?.jobs?.nodes ?? [],
          next: data?.jobs?.pageInfo?.hasNextPage ? data.jobs.pageInfo.endCursor : null,
        }), 8);
      } else if (/status|archived|enum/i.test(msg)) {
        nodes = await pageAll(gql, JOBS.replace('VISITS', visitsOk ? VISITS : ''), { status: 'ARCHIVED', createdAt: created }, (data) => ({
          nodes: data?.jobs?.nodes ?? [],
          next: data?.jobs?.pageInfo?.hasNextPage ? data.jobs.pageInfo.endCursor : null,
        }), 8);
      } else throw error;
    }
    for (const job of nodes) {
      if (isInternalJob(job)) continue;
      const phones = phonesOf(job.client);
      pushWork(work, phones, job.createdAt);
      for (const visit of job.visits?.nodes ?? []) pushWork(work, phones, visit.createdAt || visit.startAt);
    }
  } catch (error) {
    notes.push(`archived jobs: ${error instanceof Error ? error.message : 'error'}`);
  }

  try {
    const nodes = await pageAll(gql, NEW_CLIENTS, { createdAt: created }, (data) => ({
      nodes: data?.clients?.nodes ?? [],
      next: data?.clients?.pageInfo?.hasNextPage ? data.clients.pageInfo.endCursor : null,
    }), 12);
    for (const client of nodes) {
      const phones = phonesOf(client);
      for (const job of client.jobs?.nodes ?? []) {
        if (isInternalJob({ title: job.title, client })) continue;
        pushWork(work, phones, job.createdAt || client.createdAt);
      }
    }
  } catch (error) {
    notes.push(`new client jobs: ${error instanceof Error ? error.message : 'error'}`);
  }

  try {
    const nodes = await pageAll(gql, REQUESTS, { createdAt: created }, (data) => ({
      nodes: data?.requests?.nodes ?? [],
      next: data?.requests?.pageInfo?.hasNextPage ? data.requests.pageInfo.endCursor : null,
    }), 6);
    for (const req of nodes) pushWork(work, phonesOf(req.client), req.createdAt);
  } catch (error) {
    notes.push(`Jobber requests unavailable${error instanceof Error ? `: ${error.message}` : ''}`);
  }

  const invoices: JobberInvoiceExtra[] = [];
  let commsOk = false;
  try {
    const shape = await probeInvoiceFilter(gql);
    if (!shape) throw new Error('Jobber rejected every invoice status filter');
    const probed = await probeInvoiceComms(gql, shape);
    const selection = probed?.dated ? probed.selection : '';
    commsOk = !!probed?.dated;
    if (!probed) notes.push('Jobber invoice emails and texts unavailable');
    else if (!probed.dated) notes.push('Jobber messages have no timestamp');
    const collected: any[] = [];
    let pageFailed = false;
    const pick = (data: any) => ({
      nodes: data?.invoices?.nodes ?? [],
      next: data?.invoices?.pageInfo?.hasNextPage ? data.invoices.pageInfo.endCursor : null,
    });
    for (const status of ['past_due', 'awaiting_payment']) {
      const filter = invoiceStatusFilter(shape, status);
      try {
        const nodes = await pageAll(gql, INVOICES.replace('COMMS', selection), filter, pick, 10);
        collected.push(...nodes);
      } catch (error) {
        pageFailed = true;
        const nodes = await pageAll(gql, INVOICES.replace('COMMS', ''), filter, pick, 10);
        collected.push(...nodes);
        notes.push(`Jobber send history: ${error instanceof Error ? error.message : 'error'}`);
      }
    }
    let classified = false;
    let sawNodes = false;
    for (const inv of collected) {
      const number = inv.invoiceNumber == null || inv.invoiceNumber === '' ? null : String(inv.invoiceNumber);
      const nodes = inv.linkedCommunications?.nodes ?? [];
      if (nodes.length) sawNodes = true;
      const parsed = commsFromNodes(inv.client?.id ?? null, nodes, number);
      if (parsed.classified) classified = true;
      invoices.push({
        id: String(inv.id),
        number,
        dueAt: inv.dueDate ? String(inv.dueDate) : null,
        emails: emailsOf(inv.client),
        phones: phonesOf(inv.client),
        comms: parsed.events,
      });
    }
    if (pageFailed || (commsOk && sawNodes && !classified)) {
      commsOk = false;
      for (const inv of invoices) inv.comms = [];
      if (!pageFailed) notes.push('Jobber send history could not be classified');
    }
  } catch (error) {
    commsOk = false;
    notes.push(`open invoices: ${error instanceof Error ? error.message : 'error'}`);
  }
  if (!commsOk && !notes.some((note) => /email|text|send history|timestamp/i.test(note))) {
    notes.push('Jobber invoice emails and texts unavailable');
  }

  return { work, invoices, channels: { jobberTexts: commsOk, emails: commsOk }, notes };
}
