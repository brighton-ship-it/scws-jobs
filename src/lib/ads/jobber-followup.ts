/**
 * Live Jobber reads the mirror does not store: archived/cancelled jobs, requests,
 * visit times, invoice numbers, due dates, and invoice send history.
 * A failed channel is reported, not counted as zero.
 */
import { jobberGraphql } from '../jobber/client.ts';
import { digits10 } from './call-dashboard.ts';
import type { CollectionEvent } from './callbacks.ts';

export interface JobberInvoiceExtra {
  id: string;
  number: string | null;
  dueAt: string | null;
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
    nodes { id createdAt jobStatus client { id phones { number } } VISITS }
    pageInfo { hasNextPage endCursor }
  }
}`;
const VISITS = `visits(first: 15) { nodes { id createdAt startAt } }`;

const NEW_CLIENTS = `query NewClients($first: Int!, $after: String, $filter: ClientFilterAttributes) {
  clients(first: $first, after: $after, filter: $filter) {
    nodes {
      id createdAt phones { number }
      jobs(first: 10) { nodes { id createdAt } }
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
      client { id }
      COMMS
    }
    pageInfo { hasNextPage endCursor }
  }
}`;
const COMMS = `linkedCommunications(first: 20) { nodes { __typename id createdAt } }`;

function classifyComm(node: any): 'email' | 'text' | null {
  const type = `${node?.__typename ?? ''} ${node?.channel ?? ''} ${node?.commType ?? ''}`.toLowerCase();
  if (/email/.test(type)) return 'email';
  if (/sms|text/.test(type)) return 'text';
  return null;
}

export function commsFromNodes(clientId: string | null, nodes: any[]): { events: CollectionEvent[]; classified: boolean } {
  let classified = false;
  const events: CollectionEvent[] = [];
  for (const node of nodes ?? []) {
    const kind = classifyComm(node);
    if (!kind) continue;
    classified = true;
    const at = node.createdAt || node.sentAt;
    if (!at || !Number.isFinite(Date.parse(at))) continue;
    events.push({
      at: String(at),
      channel: kind,
      source: kind === 'email' ? 'jobber_email' : 'jobber_sms',
      clientId,
      by: null,
    });
  }
  return { events, classified };
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
      for (const job of client.jobs?.nodes ?? []) pushWork(work, phones, job.createdAt || client.createdAt);
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
  let commsOk = true;
  try {
    const collected: any[] = [];
    for (const status of ['past_due', 'awaiting_payment']) {
      try {
        const nodes = await pageAll(gql, INVOICES.replace('COMMS', COMMS), { invoiceStatus: [status] }, (data) => ({
          nodes: data?.invoices?.nodes ?? [],
          next: data?.invoices?.pageInfo?.hasNextPage ? data.invoices.pageInfo.endCursor : null,
        }), 10);
        collected.push(...nodes);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (/linkedCommunications|createdAt|__typename/i.test(msg)) {
          commsOk = false;
          const nodes = await pageAll(gql, INVOICES.replace('COMMS', ''), { invoiceStatus: [status] }, (data) => ({
            nodes: data?.invoices?.nodes ?? [],
            next: data?.invoices?.pageInfo?.hasNextPage ? data.invoices.pageInfo.endCursor : null,
          }), 10);
          collected.push(...nodes);
        } else if (/invoiceStatus|enum/i.test(msg)) {
          const nodes = await pageAll(gql, INVOICES.replace('COMMS', commsOk ? COMMS : ''), { invoiceStatus: [status.toUpperCase()] }, (data) => ({
            nodes: data?.invoices?.nodes ?? [],
            next: data?.invoices?.pageInfo?.hasNextPage ? data.invoices.pageInfo.endCursor : null,
          }), 10);
          collected.push(...nodes);
        } else throw error;
      }
    }
    let classified = false;
    for (const inv of collected) {
      const parsed = commsFromNodes(inv.client?.id ?? null, inv.linkedCommunications?.nodes ?? []);
      if (parsed.classified) classified = true;
      invoices.push({
        id: String(inv.id),
        number: inv.invoiceNumber == null || inv.invoiceNumber === '' ? null : String(inv.invoiceNumber),
        dueAt: inv.dueDate ? String(inv.dueDate) : null,
        comms: parsed.events,
      });
    }
    if (commsOk && collected.length && !classified && collected.some((inv) => (inv.linkedCommunications?.nodes ?? []).length)) {
      commsOk = false;
      notes.push('Jobber send history could not be classified');
    }
  } catch (error) {
    commsOk = false;
    notes.push(`open invoices: ${error instanceof Error ? error.message : 'error'}`);
  }
  if (!commsOk) notes.push('Jobber invoice emails and texts unavailable');

  return { work, invoices, channels: { jobberTexts: commsOk, emails: commsOk }, notes };
}
