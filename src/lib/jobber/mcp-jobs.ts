/**
 * Read-only Jobber job lookups for the MCP gateway.
 * Same GraphQL client as quotes and invoices. Photo URLs come from
 * Job.noteAttachments (the file connection recent-jobs does not select).
 *
 * No create, update, complete, close, or send mutations live here.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import { searchClients, type JobberDeps } from './quotes.ts';

export const MCP_JOB_PAGE_SIZE = 15;
export const MCP_JOB_MAX_PAGE_SIZE = 25;
export const MCP_JOB_MAX_SCAN_PAGES = 6;
export const MCP_JOB_CLIENT_LIMIT = 5;
export const MCP_JOB_SEARCH_PHOTO_LIMIT = 6;
export const MCP_JOB_DETAIL_PHOTO_LIMIT = 40;
export const MCP_JOB_PHOTO_PAGES = 4;

const READ_ONLY_JOB_QUERY =
  /\bmutation\b|jobCreate|jobEdit|jobComplete|jobDelete|jobClose|visitComplete|jobNoteCreate|jobNoteEdit|noteCreate\b|sendJob/i;

export type JobberJobClient = {
  id?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
};

export type JobberJobFileNode = {
  id?: string | null;
  url?: string | null;
  fileUrl?: string | null;
  downloadUrl?: string | null;
  thumbnailUrl?: string | null;
  fileName?: string | null;
  filename?: string | null;
  contentType?: string | null;
};

export type JobberJobAttachmentConnection = {
  nodes?: Array<JobberJobFileNode | null> | null;
  edges?: Array<{ node?: JobberJobFileNode | null } | null> | null;
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
};

export type JobberJobDetail = {
  id: string;
  jobNumber?: string | number | null;
  title?: string | null;
  jobStatus?: string | null;
  completedAt?: string | null;
  createdAt?: string | null;
  jobberWebUri?: string | null;
  client?: JobberJobClient | null;
  property?: { id?: string | null; address?: { city?: string | null } | null } | null;
  noteAttachments?: JobberJobAttachmentConnection | null;
};

export type JobberJobPhoto = {
  id: string | null;
  url: string | null;
  thumbnailUrl: string | null;
  fileName: string | null;
  contentType: string | null;
};

export type JobberJobSummary = {
  id: string;
  jobNumber: string | number | null;
  title: string | null;
  jobStatus: string | null;
  completedAt: string | null;
  createdAt: string | null;
  jobberWebUri: string | null;
  city: string | null;
  client: {
    id: string | null;
    firstName: string | null;
    name: string | null;
  } | null;
  photos: JobberJobPhoto[];
  photoUrls: string[];
  photosTruncated: boolean;
};

export type JobberJobPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type SearchJobsInput = {
  query?: string | null;
  completedAfter?: string | null;
  completedBefore?: string | null;
  status?: string | null;
  first?: number;
  after?: string | null;
  photoLimit?: number;
};

export type SearchJobsResult = {
  jobs: JobberJobSummary[];
  pageInfo: JobberJobPageInfo;
  note?: string;
};

export type JobServerFilter = {
  status?: string;
  completedAt?: { after?: string; before?: string };
};

type JobEdge = {
  cursor: string | null;
  node: JobberJobDetail;
};

type UrlFieldName = 'url' | 'fileUrl' | 'downloadUrl';

type QueryShape = {
  searchTerm: boolean;
  edges: boolean;
  useFilter: boolean;
  noteAttachments: boolean;
  url: boolean;
  urlName: UrlFieldName;
  thumbnailUrl: boolean;
  fileName: boolean;
  fileNameField: 'fileName' | 'filename';
  contentType: boolean;
  statusUpper: boolean;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertReadOnlyJobQuery(query);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function assertReadOnlyJobQuery(query: string): void {
  if (READ_ONLY_JOB_QUERY.test(query)) {
    throw new Error('Job tools are read-only');
  }
}

function errorText(result: JobberGraphqlResult): string {
  return (result.errors || []).map((error) => error.message || '').join(' ');
}

export function pageSize(first?: number): number {
  const n = first ?? MCP_JOB_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) return MCP_JOB_PAGE_SIZE;
  return Math.min(Math.floor(n), MCP_JOB_MAX_PAGE_SIZE);
}

export function normalizeJobStatus(status: string | null | undefined): string {
  return (status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function normalizeJobNumber(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/^job\s*/, '');
}

export function isJobNumberQuery(query: string): boolean {
  return /^(?:job\s*)?#?\d+$/i.test(query.trim());
}

export function parseCompletedBound(value: string, endOfDay: boolean): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(endOfDay ? 'completedBefore is empty' : 'completedAfter is empty');
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('completedAfter and completedBefore must be ISO dates');
  }
  return parsed.toISOString();
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function fileNameOf(file: JobberJobFileNode): string | null {
  const name = file.fileName?.trim() || file.filename?.trim() || '';
  return name || null;
}

function downloadUrlOf(file: JobberJobFileNode): string | null {
  return httpsUrl(file.url) || httpsUrl(file.fileUrl) || httpsUrl(file.downloadUrl) || httpsUrl(file.thumbnailUrl);
}

export function isJobPhoto(file: JobberJobFileNode): boolean {
  const url = downloadUrlOf(file);
  if (!url) return false;
  const type = (file.contentType || '').trim().toLowerCase();
  if (type.startsWith('image/')) return true;
  if (type && !type.startsWith('image/')) return false;
  const name = `${fileNameOf(file) || ''} ${url}`.toLowerCase();
  if (/\.(pdf|docx?|xlsx?|csv|txt|pptx?|zip)(\?|$)/i.test(name)) return false;
  return true;
}

export function jobMatchesQuery(job: JobberJobDetail, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (isJobNumberQuery(query)) {
    return normalizeJobNumber(job.jobNumber) === normalizeJobNumber(query);
  }
  const hay = [
    job.jobNumber,
    job.title,
    job.client?.name,
    job.client?.companyName,
    job.client?.firstName,
    job.client?.lastName,
    job.property?.address?.city,
  ]
    .filter((part) => part != null && String(part).trim())
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

export function jobMatchesSearchFilters(job: JobberJobDetail, input: SearchJobsInput): boolean {
  const query = input.query?.trim() || '';
  if (query && !jobMatchesQuery(job, query)) return false;

  const status = normalizeJobStatus(input.status);
  if (status && status !== 'all' && status !== 'completed') {
    if (normalizeJobStatus(job.jobStatus) !== status) return false;
  }

  const after = input.completedAfter?.trim() ? new Date(parseCompletedBound(input.completedAfter, false)) : null;
  const before = input.completedBefore?.trim() ? new Date(parseCompletedBound(input.completedBefore, true)) : null;
  const needsCompleted = status === 'completed' || Boolean(after) || Boolean(before);
  const completed = parseInstant(job.completedAt);
  if (needsCompleted && !completed) return false;
  if (after && completed && completed.getTime() < after.getTime()) return false;
  if (before && completed && completed.getTime() > before.getTime()) return false;
  return true;
}

export function buildJobServerFilter(input: SearchJobsInput): JobServerFilter | null {
  const filter: JobServerFilter = {};
  const status = normalizeJobStatus(input.status);
  if (status && status !== 'all' && status !== 'completed') {
    filter.status = status;
  }
  const after = input.completedAfter?.trim() ? parseCompletedBound(input.completedAfter, false) : '';
  const before = input.completedBefore?.trim() ? parseCompletedBound(input.completedBefore, true) : '';
  if (after || before) {
    filter.completedAt = {};
    if (after) filter.completedAt.after = after;
    if (before) filter.completedAt.before = before;
  }
  if (!filter.status && !filter.completedAt) return null;
  return filter;
}

function cloneFilter(filter: JobServerFilter | null): JobServerFilter | null {
  if (!filter) return null;
  return {
    status: filter.status,
    completedAt: filter.completedAt ? { ...filter.completedAt } : undefined,
  };
}

function filterIsEmpty(filter: JobServerFilter | null): boolean {
  return !filter?.status && !filter?.completedAt?.after && !filter?.completedAt?.before;
}

function attachmentSelection(shape: QueryShape, photoLimit: number, withAfter = false): string {
  if (!shape.noteAttachments) return '';
  const first = Math.min(Math.max(photoLimit, 1) + 4, 50);
  const fields = [
    'id',
    shape.fileName ? shape.fileNameField : '',
    shape.contentType ? 'contentType' : '',
    shape.url ? shape.urlName : '',
    shape.thumbnailUrl ? 'thumbnailUrl' : '',
  ]
    .filter(Boolean)
    .join('\n          ');
  const args = withAfter ? `after: $after, first: ${first}` : `first: ${first}`;
  return `
    noteAttachments(${args}) {
      nodes { ${fields} }
      pageInfo { hasNextPage endCursor }
    }`;
}

function jobNodeFields(shape: QueryShape, photoLimit: number): string {
  return `
    id
    jobNumber
    title
    jobStatus
    completedAt
    createdAt
    jobberWebUri
    client {
      id
      name
      firstName
      lastName
      companyName
    }
    property {
      id
      address { city }
    }${attachmentSelection(shape, photoLimit)}`;
}

function jobsConnectionSelection(shape: QueryShape, photoLimit: number): string {
  const fields = jobNodeFields(shape, photoLimit);
  if (shape.edges) return `edges { cursor node { ${fields} } }`;
  return `nodes { ${fields} }`;
}

function jobsQuery(shape: QueryShape, photoLimit: number): string {
  const searchDecl = shape.searchTerm ? ', $searchTerm: String' : '';
  const searchArg = shape.searchTerm ? ', searchTerm: $searchTerm' : '';
  const filterDecl = shape.useFilter ? ', $filter: JobFilterAttributes' : '';
  const filterArg = shape.useFilter ? ', filter: $filter' : '';
  return `
    query McpJobs($first: Int!, $after: String${filterDecl}${searchDecl}) {
      jobs(first: $first, after: $after${filterArg}${searchArg}) {
        ${jobsConnectionSelection(shape, photoLimit)}
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
}

function jobByIdQuery(shape: QueryShape, photoLimit: number): string {
  return `
    query McpJobById($id: EncodedId!) {
      job(id: $id) { ${jobNodeFields(shape, photoLimit)} }
    }
  `;
}

function jobPhotosQuery(shape: QueryShape, photoLimit: number): string {
  return `
    query McpJobPhotos($id: EncodedId!, $after: String) {
      job(id: $id) {
        id
        ${attachmentSelection(shape, photoLimit, true)}
      }
    }
  `;
}

function clientJobsQuery(shape: QueryShape, photoLimit: number): string {
  return `
    query McpClientJobs($id: EncodedId!, $first: Int!) {
      client(id: $id) {
        jobs(first: $first) {
          ${jobsConnectionSelection(shape, photoLimit)}
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
}

function mentionsField(message: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"]${escaped}['"]`, 'i').test(message);
}

function applySchemaFallback(message: string, shape: QueryShape, filter: JobServerFilter | null): boolean {
  let changed = false;
  if (shape.noteAttachments && mentionsField(message, 'noteAttachments')) {
    shape.noteAttachments = false;
    changed = true;
  }
  if (shape.fileName && shape.fileNameField === 'fileName' && mentionsField(message, 'fileName')) {
    shape.fileNameField = 'filename';
    changed = true;
  } else if (shape.fileName && shape.fileNameField === 'filename' && mentionsField(message, 'filename')) {
    shape.fileName = false;
    changed = true;
  }
  if (shape.contentType && mentionsField(message, 'contentType')) {
    shape.contentType = false;
    changed = true;
  }
  if (shape.thumbnailUrl && mentionsField(message, 'thumbnailUrl')) {
    shape.thumbnailUrl = false;
    changed = true;
  }
  if (shape.url && shape.urlName === 'url' && mentionsField(message, 'url') && /JobNoteFile|NoteFile|field/i.test(message)) {
    shape.urlName = 'fileUrl';
    changed = true;
  } else if (shape.url && shape.urlName === 'fileUrl' && mentionsField(message, 'fileUrl')) {
    shape.urlName = 'downloadUrl';
    changed = true;
  } else if (shape.url && shape.urlName === 'downloadUrl' && mentionsField(message, 'downloadUrl')) {
    shape.url = false;
    changed = true;
  }
  if (shape.edges && mentionsField(message, 'edges')) {
    shape.edges = false;
    changed = true;
  }
  if (shape.searchTerm && /searchTerm/i.test(message)) {
    shape.searchTerm = false;
    changed = true;
  }
  if (
    filter?.completedAt &&
    mentionsField(message, 'completedAt') &&
    /argument|accept|unknown|defined|JobFilter|Input/i.test(message)
  ) {
    filter.completedAt = undefined;
    changed = true;
  }
  if (
    filter?.status &&
    !shape.statusUpper &&
    /JobStatusTypeEnum|invalid value/i.test(message)
  ) {
    filter.status = filter.status.toUpperCase();
    shape.statusUpper = true;
    changed = true;
  } else if (
    filter?.status &&
    mentionsField(message, 'status') &&
    /argument|accept|unknown|defined|JobFilter/i.test(message)
  ) {
    filter.status = undefined;
    changed = true;
  }
  if (
    shape.useFilter &&
    /argument ['"]filter['"]|unknown type ['"]JobFilterAttributes['"]|JobFilterAttributes['"]? doesn't exist/i.test(
      message
    )
  ) {
    shape.useFilter = false;
    if (filter) {
      filter.status = undefined;
      filter.completedAt = undefined;
    }
    changed = true;
  }
  return changed;
}

function filterPayload(filter: JobServerFilter | null): Record<string, unknown> | null {
  if (!filter || filterIsEmpty(filter)) return null;
  const payload: Record<string, unknown> = {};
  if (filter.status) payload.status = filter.status;
  if (filter.completedAt?.after || filter.completedAt?.before) payload.completedAt = filter.completedAt;
  return Object.keys(payload).length ? payload : null;
}

async function queryWithFallback(
  build: (shape: QueryShape) => string,
  variablesFor: (shape: QueryShape, filter: JobServerFilter | null) => Record<string, unknown>,
  shape: QueryShape,
  filter: JobServerFilter | null,
  deps: JobberDeps | undefined,
  operation: string
): Promise<JobberGraphqlResult> {
  let current = cloneFilter(filter);
  for (let attempt = 0; attempt < 14; attempt++) {
    const result = await graphql(build(shape), variablesFor(shape, current), deps);
    if (!result.errors?.length) {
      if (filter) {
        filter.status = current?.status;
        filter.completedAt = current?.completedAt ? { ...current.completedAt } : undefined;
      }
      return result;
    }
    const changed = applySchemaFallback(errorText(result), shape, current);
    if (!changed) assertNoJobberErrors(result, operation);
  }
  throw new Error(`Jobber ${operation} query failed`);
}

function readConnection(connection: {
  edges?: Array<{ cursor?: string | null; node?: JobberJobDetail | null } | null> | null;
  nodes?: Array<JobberJobDetail | null> | null;
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
} | null | undefined): { edges: JobEdge[]; pageInfo: JobberJobPageInfo } {
  const pageInfo: JobberJobPageInfo = {
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    endCursor: connection?.pageInfo?.endCursor ?? null,
  };
  if (Array.isArray(connection?.edges)) {
    return {
      pageInfo,
      edges: connection.edges
        .filter((edge): edge is { cursor?: string | null; node: JobberJobDetail } => Boolean(edge?.node?.id))
        .map((edge) => ({ cursor: edge.cursor ?? null, node: edge.node })),
    };
  }
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : [];
  return {
    pageInfo,
    edges: nodes
      .filter((node): node is JobberJobDetail => Boolean(node?.id))
      .map((node) => ({ cursor: null, node })),
  };
}

function readFiles(connection: JobberJobAttachmentConnection | null | undefined): JobberJobFileNode[] {
  if (Array.isArray(connection?.nodes)) {
    return connection.nodes.filter((node): node is JobberJobFileNode => Boolean(node));
  }
  if (Array.isArray(connection?.edges)) {
    return connection.edges
      .map((edge) => edge?.node)
      .filter((node): node is JobberJobFileNode => Boolean(node));
  }
  return [];
}

function clientFirstName(client: JobberJobClient | null | undefined): string | null {
  const first = client?.firstName?.trim();
  return first || null;
}

function clientDisplayName(client: JobberJobClient | null | undefined): string | null {
  const first = clientFirstName(client);
  if (first) return first;
  const name = client?.name?.trim();
  if (name) return name;
  return client?.companyName?.trim() || null;
}

export function summarizeJob(job: JobberJobDetail, photoLimit: number): JobberJobSummary {
  const photos: JobberJobPhoto[] = [];
  const seen = new Set<string>();
  for (const file of readFiles(job.noteAttachments)) {
    if (!isJobPhoto(file)) continue;
    const url = downloadUrlOf(file);
    const thumbnailUrl = httpsUrl(file.thumbnailUrl);
    const key = file.id || url || thumbnailUrl || '';
    if (!key || seen.has(key)) continue;
    seen.add(key);
    photos.push({
      id: file.id ?? null,
      url,
      thumbnailUrl: thumbnailUrl && thumbnailUrl !== url ? thumbnailUrl : null,
      fileName: fileNameOf(file),
      contentType: file.contentType?.trim() || null,
    });
    if (photos.length >= photoLimit) break;
  }
  const photoUrls = photos.map((photo) => photo.url).filter((url): url is string => Boolean(url));
  const photoCount = readFiles(job.noteAttachments).filter(isJobPhoto).length;
  return {
    id: job.id,
    jobNumber: job.jobNumber ?? null,
    title: job.title ?? null,
    jobStatus: normalizeJobStatus(job.jobStatus) || null,
    completedAt: job.completedAt ?? null,
    createdAt: job.createdAt ?? null,
    jobberWebUri: job.jobberWebUri ?? null,
    city: job.property?.address?.city?.trim() || null,
    client: job.client
      ? {
          id: job.client.id ?? null,
          firstName: clientFirstName(job.client),
          name: clientDisplayName(job.client),
        }
      : null,
    photos,
    photoUrls,
    photosTruncated: Boolean(job.noteAttachments?.pageInfo?.hasNextPage) || photoCount > photoLimit,
  };
}

function initialShape(input: SearchJobsInput): QueryShape {
  return {
    searchTerm: Boolean(input.query?.trim()),
    edges: true,
    useFilter: true,
    noteAttachments: true,
    url: true,
    urlName: 'url',
    thumbnailUrl: true,
    fileName: true,
    fileNameField: 'fileName',
    contentType: true,
    statusUpper: false,
  };
}

function photoLimitFor(input: SearchJobsInput): number {
  const limit = input.photoLimit ?? MCP_JOB_SEARCH_PHOTO_LIMIT;
  if (!Number.isFinite(limit) || limit < 1) return MCP_JOB_SEARCH_PHOTO_LIMIT;
  return Math.min(Math.floor(limit), MCP_JOB_DETAIL_PHOTO_LIMIT);
}

async function fetchJobPage(
  input: {
    first: number;
    after: string | null;
    query: string;
    shape: QueryShape;
    filter: JobServerFilter | null;
    photoLimit: number;
  },
  deps?: JobberDeps
): Promise<{ edges: JobEdge[]; pageInfo: JobberJobPageInfo }> {
  const result = await queryWithFallback(
    (shape) => jobsQuery(shape, input.photoLimit),
    (shape, filter) => {
      const variables: Record<string, unknown> = {
        first: input.first,
        after: input.after,
      };
      if (shape.useFilter) {
        const payload = filterPayload(filter);
        if (payload) variables.filter = payload;
      }
      if (shape.searchTerm && input.query) variables.searchTerm = input.query;
      return variables;
    },
    input.shape,
    input.filter,
    deps,
    'jobs'
  );
  return readConnection(result.data?.jobs);
}

async function jobsFromClients(
  query: string,
  input: SearchJobsInput,
  shape: QueryShape,
  photoLimit: number,
  deps?: JobberDeps
): Promise<SearchJobsResult | null> {
  const clients = await searchClients(query, deps);
  const matches: JobberJobDetail[] = [];
  const seen = new Set<string>();
  let truncated = false;
  for (const client of clients.slice(0, MCP_JOB_CLIENT_LIMIT)) {
    if (!client?.id) continue;
    const result = await queryWithFallback(
      (current) => clientJobsQuery(current, photoLimit),
      () => ({ id: client.id, first: MCP_JOB_MAX_PAGE_SIZE }),
      shape,
      null,
      deps,
      'client jobs'
    );
    const page = readConnection(result.data?.client?.jobs);
    if (page.pageInfo.hasNextPage) truncated = true;
    for (const edge of page.edges) {
      if (!edge.node?.id || seen.has(edge.node.id)) continue;
      if (!jobMatchesSearchFilters(edge.node, input)) continue;
      seen.add(edge.node.id);
      matches.push(edge.node);
    }
  }
  if (!matches.length) return null;
  const want = pageSize(input.first);
  const capped = matches.slice(0, want);
  return {
    jobs: capped.map((job) => summarizeJob(job, photoLimit)),
    pageInfo: { hasNextPage: false, endCursor: null },
    note:
      truncated || matches.length > want
        ? 'Client-name fallback is capped (no job search cursor). Narrow the name to see the rest.'
        : undefined,
  };
}

export async function searchJobs(input: SearchJobsInput, deps?: JobberDeps): Promise<SearchJobsResult> {
  const query = input.query?.trim() || '';
  const want = pageSize(input.first);
  const photoLimit = photoLimitFor(input);
  const shape = initialShape(input);
  const filter = buildJobServerFilter(input);
  if (!filter) shape.useFilter = false;
  const collected: JobEdge[] = [];
  let after: string | null = input.after?.trim() || null;
  let hasNextPage = false;
  let endCursor: string | null = null;
  let triedClients = false;

  for (let pages = 0; pages < MCP_JOB_MAX_SCAN_PAGES && collected.length < want; pages++) {
    const page = await fetchJobPage(
      { first: MCP_JOB_MAX_PAGE_SIZE, after, query, shape, filter, photoLimit },
      deps
    );

    if (!triedClients && query && !shape.searchTerm && !isJobNumberQuery(query) && !input.after) {
      triedClients = true;
      const fromClients = await jobsFromClients(query, input, shape, photoLimit, deps);
      if (fromClients) {
        if (!shape.noteAttachments) {
          fromClients.note = [fromClients.note, 'Jobber did not return note attachment URLs on this schema.']
            .filter(Boolean)
            .join(' ');
        }
        return fromClients;
      }
    }

    let stoppedMidPage = false;
    for (let index = 0; index < page.edges.length; index++) {
      const edge = page.edges[index];
      if (!jobMatchesSearchFilters(edge.node, input)) continue;
      if (collected.length >= want && edge.cursor) {
        stoppedMidPage = true;
        break;
      }
      collected.push(edge);
      if (edge.cursor) endCursor = edge.cursor;
    }

    const cursors = page.edges.length === 0 || page.edges.every((edge) => edge.cursor);
    if (stoppedMidPage) {
      hasNextPage = true;
      break;
    }
    if (!cursors && collected.length > want) {
      hasNextPage = page.pageInfo.hasNextPage;
      endCursor = page.pageInfo.endCursor;
      break;
    }
    if (collected.length >= want) {
      hasNextPage = page.pageInfo.hasNextPage;
      endCursor = endCursor || page.pageInfo.endCursor;
      break;
    }
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) {
      hasNextPage = false;
      endCursor = endCursor || page.pageInfo.endCursor;
      break;
    }
    after = page.pageInfo.endCursor;
    endCursor = after;
    if (pages + 1 >= MCP_JOB_MAX_SCAN_PAGES) {
      hasNextPage = true;
      break;
    }
  }

  const cursors = collected.length === 0 || collected.every((edge) => edge.cursor);
  const jobs = (cursors ? collected.slice(0, want) : collected).map((edge) => summarizeJob(edge.node, photoLimit));
  const note = !shape.noteAttachments
    ? 'Jobber did not return note attachment URLs on this schema.'
    : undefined;

  return {
    jobs,
    pageInfo: { hasNextPage, endCursor },
    note,
  };
}

export function looksLikeJobberEncodedId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /^\d+$/.test(trimmed) || isJobNumberQuery(trimmed)) return false;
  return /^[A-Za-z0-9+/_=-]{12,}$/.test(trimmed);
}

async function appendPhotoPages(job: JobberJobDetail, shape: QueryShape, deps?: JobberDeps): Promise<void> {
  let cursor = job.noteAttachments?.pageInfo?.endCursor || null;
  let hasNext = Boolean(job.noteAttachments?.pageInfo?.hasNextPage && cursor);
  const merged = readFiles(job.noteAttachments);
  for (let page = 0; page < MCP_JOB_PHOTO_PAGES && hasNext && cursor; page++) {
    try {
      const result = await queryWithFallback(
        (current) => jobPhotosQuery(current, MCP_JOB_DETAIL_PHOTO_LIMIT),
        () => ({ id: job.id, after: cursor }),
        shape,
        null,
        deps,
        'job photos'
      );
      const connection = result.data?.job?.noteAttachments as JobberJobAttachmentConnection | undefined;
      merged.push(...readFiles(connection));
      hasNext = Boolean(connection?.pageInfo?.hasNextPage && connection.pageInfo.endCursor);
      cursor = connection?.pageInfo?.endCursor || null;
    } catch {
      hasNext = true;
      break;
    }
    job.noteAttachments = {
      nodes: merged,
      pageInfo: { hasNextPage: hasNext, endCursor: cursor },
    };
  }
  job.noteAttachments = {
    nodes: merged,
    pageInfo: { hasNextPage: hasNext, endCursor: cursor },
  };
}

async function getJobById(jobId: string, deps?: JobberDeps): Promise<JobberJobSummary> {
  const shape = initialShape({});
  const result = await queryWithFallback(
    (current) => jobByIdQuery(current, MCP_JOB_DETAIL_PHOTO_LIMIT),
    () => ({ id: jobId }),
    shape,
    null,
    deps,
    'job'
  );
  const job = result.data?.job as JobberJobDetail | undefined;
  if (!job?.id) throw new Error(`Jobber job ${jobId} not found`);
  if (shape.noteAttachments && job.noteAttachments?.pageInfo?.hasNextPage) {
    await appendPhotoPages(job, shape, deps);
  }
  return summarizeJob(job, MCP_JOB_DETAIL_PHOTO_LIMIT);
}

export async function getJob(
  input: { jobId?: string | null; jobNumber?: string | null },
  deps?: JobberDeps
): Promise<JobberJobSummary> {
  const jobId = input.jobId?.trim() || '';
  const jobNumber = input.jobNumber?.trim() || '';
  if (!jobId && !jobNumber) throw new Error('jobId or jobNumber is required');

  if (jobId && looksLikeJobberEncodedId(jobId)) {
    try {
      return await getJobById(jobId, deps);
    } catch (error) {
      if (!jobNumber) throw error;
    }
  }

  const number = jobNumber || jobId;
  const wanted = normalizeJobNumber(number);
  if (!wanted) throw new Error('jobNumber is required');
  const page = await searchJobs(
    { query: number, first: MCP_JOB_PAGE_SIZE, photoLimit: MCP_JOB_SEARCH_PHOTO_LIMIT },
    deps
  );
  const match = page.jobs.find((job) => normalizeJobNumber(job.jobNumber) === wanted);
  if (!match) throw new Error(`Jobber job ${number} not found`);
  return getJobById(match.id, deps);
}
