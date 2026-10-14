/**
 * Notes on a client, request, job, or quote.
 *
 * Public introspection (hightreequency/jobberschema; gateway pin stays
 * 2025-04-16) has no generic noteCreate. The mutations are:
 * - clientCreateNote(clientId, input: ClientCreateNoteInput!)
 * - requestCreateNote(requestId, input: RequestCreateNoteInput!)
 * - jobCreateNote(jobId, input: JobCreateNoteInput!)
 * - quoteCreateNote(quoteId, input: QuoteCreateNoteInput!)
 * Each input is { message, attachments, linkedTo }. This tool sends message
 * only. The 2025-04-16 changelog removed the older clientNoteCreate,
 * jobNoteCreate, and requestNoteCreate names.
 *
 * Reads use the notes connection on Client, Request, Quote, and Job, plus
 * Visit.notes (JobNoteUnionConnection — notes left on a visit). Each note
 * implements NoteInterface: message, createdAt, createdBy (User | Client |
 * Application), and fileAttachments (fileName, url). Jobber copies visit
 * notes onto the job as well; listNotes dedupes by note id.
 *
 * Notes do not email or text the client. linkedTo is omitted so a note is
 * not copied onto an invoice. list_notes is read-only.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
  type JobberGraphqlResult,
} from './client.ts';
import { looksLikeJobberEncodedId, normalizeJobNumber } from './mcp-jobs.ts';
import { assertWriteDoesNotDeliver } from './mcp-notify.ts';
import type { JobberDeps } from './quotes.ts';

export const NOTE_TARGETS = ['client', 'request', 'job', 'quote'] as const;
export type NoteTarget = (typeof NOTE_TARGETS)[number];

const NOTE_MUTATIONS: Record<NoteTarget, { name: string; idArg: string; document: string }> = {
  client: {
    name: 'clientCreateNote',
    idArg: 'clientId',
    document: `
      mutation McpClientCreateNote($clientId: EncodedId!, $input: ClientCreateNoteInput!) {
        clientCreateNote(clientId: $clientId, input: $input) {
          clientNote { id message }
          userErrors { message path }
        }
      }
    `,
  },
  request: {
    name: 'requestCreateNote',
    idArg: 'requestId',
    document: `
      mutation McpRequestCreateNote($requestId: EncodedId!, $input: RequestCreateNoteInput!) {
        requestCreateNote(requestId: $requestId, input: $input) {
          requestNote { id message }
          userErrors { message path }
        }
      }
    `,
  },
  job: {
    name: 'jobCreateNote',
    idArg: 'jobId',
    document: `
      mutation McpJobCreateNote($jobId: EncodedId!, $input: JobCreateNoteInput!) {
        jobCreateNote(jobId: $jobId, input: $input) {
          jobNote { id message }
          userErrors { message path }
        }
      }
    `,
  },
  quote: {
    name: 'quoteCreateNote',
    idArg: 'quoteId',
    document: `
      mutation McpQuoteCreateNote($quoteId: EncodedId!, $input: QuoteCreateNoteInput!) {
        quoteCreateNote(quoteId: $quoteId, input: $input) {
          quoteNote { id message }
          userErrors { message path }
        }
      }
    `,
  },
};

const NOTE_FIELD: Record<NoteTarget, string> = {
  client: 'clientNote',
  request: 'requestNote',
  job: 'jobNote',
  quote: 'quoteNote',
};

export type CreateNoteInput = {
  target: NoteTarget;
  id: string;
  message: string;
};

export type CreateNoteResult = {
  notified: false;
  target: NoteTarget;
  id: string;
  noteId: string;
  message: string;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertWriteDoesNotDeliver(query);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function parseCreateNoteArgs(args: Record<string, unknown>): CreateNoteInput {
  const message = typeof args.message === 'string' ? args.message.trim() : '';
  if (!message) throw new Error('message is required');
  const ids = [
    ['client', args.clientId],
    ['request', args.requestId],
    ['job', args.jobId],
    ['quote', args.quoteId],
  ] as const;
  const present = ids.filter(([, value]) => typeof value === 'string' && value.trim());
  if (present.length !== 1) {
    throw new Error('Pass exactly one of clientId, requestId, jobId, or quoteId');
  }
  const [target, id] = present[0];
  return { target, id: String(id).trim(), message };
}

export async function createNote(input: CreateNoteInput, deps?: JobberDeps): Promise<CreateNoteResult> {
  const spec = NOTE_MUTATIONS[input.target];
  if (!spec) throw new Error(`Notes are supported on ${NOTE_TARGETS.join(', ')}`);
  const message = input.message.trim();
  if (!message) throw new Error('message is required');
  const id = input.id.trim();
  if (!id) throw new Error(`${spec.idArg} is required`);
  const result = await graphql(spec.document, { [spec.idArg]: id, input: { message } }, deps);
  assertNoJobberErrors(result, spec.name);
  const payload = result.data?.[spec.name];
  const errors = jobberUserErrors(payload);
  if (errors.length) throw new Error(errors.join('; '));
  const note = payload?.[NOTE_FIELD[input.target]] as { id?: string; message?: string } | undefined;
  if (!note?.id) throw new Error(`Jobber ${spec.name} returned no note`);
  return {
    notified: false,
    target: input.target,
    id,
    noteId: note.id,
    message: note.message || message,
  };
}

export const NOTE_PAGE_DEFAULT = 25;
export const NOTE_PAGE_MAX = 50;
const NOTE_FILE_LIMIT = 8;
const VISIT_PAGE = 8;

const JOB_NOTE_MEMBERS = ['JobNote', 'ClientNote', 'QuoteNote', 'RequestNote'] as const;
const QUOTE_NOTE_MEMBERS = ['ClientNote', 'QuoteNote', 'RequestNote'] as const;
const REQUEST_NOTE_MEMBERS = ['ClientNote', 'RequestNote'] as const;

export type NoteQueryShape = {
  sort: boolean;
  createdBy: boolean;
  files: boolean;
  fileUrl: boolean;
  interfaceSpread: boolean;
};

export function initialNoteQueryShape(): NoteQueryShape {
  return { sort: true, createdBy: true, files: true, fileUrl: true, interfaceSpread: true };
}

function mentionsField(message: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`['"]${escaped}['"]`, 'i').test(message);
}

/** Drop one unsupported selection so a schema mismatch can be retried. */
export function relaxNoteQueryShape(message: string, shape: NoteQueryShape): boolean {
  if (shape.interfaceSpread && /NoteInterface|cannot be spread here/i.test(message)) {
    shape.interfaceSpread = false;
    return true;
  }
  if (shape.sort && (mentionsField(message, 'sort') || mentionsField(message, 'key') || /NotesSort/i.test(message))) {
    shape.sort = false;
    return true;
  }
  if (shape.createdBy && (mentionsField(message, 'createdBy') || mentionsField(message, 'full'))) {
    shape.createdBy = false;
    return true;
  }
  if (shape.files && shape.fileUrl && mentionsField(message, 'url')) {
    shape.fileUrl = false;
    return true;
  }
  if (
    shape.files &&
    (mentionsField(message, 'fileAttachments') ||
      mentionsField(message, 'fileName') ||
      mentionsField(message, 'contentType'))
  ) {
    shape.files = false;
    return true;
  }
  return false;
}

export function notePageSize(first?: number): number {
  const n = first ?? NOTE_PAGE_DEFAULT;
  if (!Number.isFinite(n) || n < 1) return NOTE_PAGE_DEFAULT;
  return Math.min(Math.floor(n), NOTE_PAGE_MAX);
}

function noteFieldBlock(shape: NoteQueryShape): string {
  const author = shape.createdBy
    ? `createdBy {
        __typename
        ... on User { id name { full } }
        ... on Client { id name }
        ... on Application { id name }
      }`
    : '';
  const files = shape.files
    ? `fileAttachments(first: ${NOTE_FILE_LIMIT}) {
        nodes { id fileName contentType ${shape.fileUrl ? 'url' : ''} }
        pageInfo { hasNextPage }
      }`
    : '';
  return ['id', 'message', 'createdAt', author, files].filter(Boolean).join('\n');
}

/** members=null selects fields directly (ClientNote). Unions need a fragment. */
export function notesConnectionSelection(shape: NoteQueryShape, members: readonly string[] | null): string {
  const sort = shape.sort ? ', sort: [{ key: CREATED_AT, direction: DESCENDING }]' : '';
  const fields = noteFieldBlock(shape);
  const nodes =
    members == null
      ? fields
      : shape.interfaceSpread
        ? `__typename\n... on NoteInterface { ${fields} }`
        : members.map((member) => `... on ${member} { __typename\n${fields} }`).join('\n');
  return `
    notes(first: $first${sort}) {
      nodes { ${nodes} }
      pageInfo { hasNextPage endCursor }
    }`;
}

export type ListNotesInput = {
  target: NoteTarget;
  id?: string;
  jobNumber?: string;
  visitId?: string;
  first?: number;
};

function argString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseListNotesArgs(args: Record<string, unknown>): ListNotesInput {
  const jobId = argString(args.jobId);
  const jobNumber = argString(args.jobNumber);
  const clientId = argString(args.clientId);
  const quoteId = argString(args.quoteId);
  const requestId = argString(args.requestId);
  const visitId = argString(args.visitId);
  const present = [
    jobId || jobNumber ? 'job' : '',
    clientId ? 'client' : '',
    quoteId ? 'quote' : '',
    requestId ? 'request' : '',
  ].filter(Boolean);
  if (present.length !== 1) {
    throw new Error('Pass exactly one of jobId/jobNumber, clientId, quoteId, or requestId');
  }
  if (visitId && present[0] !== 'job') {
    throw new Error('visitId is only valid with a jobId or jobNumber');
  }
  let first: number | undefined;
  if (args.first != null && args.first !== '') {
    const parsed = typeof args.first === 'number' ? args.first : Number(args.first);
    if (!Number.isFinite(parsed)) throw new Error('first must be a number');
    first = notePageSize(parsed);
  }
  if (present[0] === 'job') {
    return { target: 'job', id: jobId || undefined, jobNumber: jobNumber || undefined, visitId: visitId || undefined, first };
  }
  if (present[0] === 'client') return { target: 'client', id: clientId, first };
  if (present[0] === 'quote') return { target: 'quote', id: quoteId, first };
  return { target: 'request', id: requestId, first };
}

export type ListedNoteAuthor = {
  type: string;
  id: string | null;
  name: string | null;
};

export type ListedNoteAttachment = {
  id: string | null;
  fileName: string | null;
  url: string | null;
  contentType: string | null;
};

export type ListedNoteVisit = {
  id: string;
  title: string | null;
  startAt: string | null;
};

export type ListedNote = {
  id: string;
  message: string;
  createdAt: string | null;
  author: ListedNoteAuthor | null;
  attachments: ListedNoteAttachment[];
  attachmentsTruncated: boolean;
  sources: string[];
  visits: ListedNoteVisit[];
};

export type ListNotesResult = {
  target: NoteTarget;
  id: string;
  jobNumber: string | number | null;
  title: string | null;
  clientName: string | null;
  quoteNumber: string | number | null;
  count: number;
  truncated: boolean;
  visitNotesError: string | null;
  notes: ListedNote[];
};

type RawAuthor = {
  __typename?: string;
  id?: string | null;
  name?: string | { full?: string | null } | null;
};

type RawNote = {
  __typename?: string;
  id?: string | null;
  message?: string | null;
  createdAt?: string | null;
  createdBy?: RawAuthor | null;
  fileAttachments?: {
    nodes?: Array<{
      id?: string | null;
      fileName?: string | null;
      url?: string | null;
      contentType?: string | null;
    } | null> | null;
    pageInfo?: { hasNextPage?: boolean | null } | null;
  } | null;
};

type RawConnection = {
  nodes?: Array<RawNote | null> | null;
  pageInfo?: { hasNextPage?: boolean | null } | null;
};

function readGraphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  if (/\bmutation\b/i.test(query)) throw new Error('list_notes is read-only');
  return graphql(query, variables, deps);
}

function authorFrom(createdBy: RawAuthor | null | undefined): ListedNoteAuthor | null {
  if (!createdBy) return null;
  const type = createdBy.__typename || 'unknown';
  const name =
    createdBy.name && typeof createdBy.name === 'object'
      ? createdBy.name.full || null
      : typeof createdBy.name === 'string'
        ? createdBy.name
        : null;
  return { type, id: createdBy.id ?? null, name };
}

function noteFromRaw(raw: RawNote | null | undefined, source: string, visit?: ListedNoteVisit | null): ListedNote | null {
  const id = raw?.id?.trim();
  if (!id) return null;
  const attachments = (raw?.fileAttachments?.nodes || [])
    .filter((file): file is NonNullable<typeof file> => Boolean(file))
    .map((file) => ({
      id: file.id ?? null,
      fileName: file.fileName ?? null,
      url: file.url ?? null,
      contentType: file.contentType ?? null,
    }));
  return {
    id,
    message: raw?.message ?? '',
    createdAt: raw?.createdAt ?? null,
    author: authorFrom(raw?.createdBy),
    attachments,
    attachmentsTruncated: Boolean(raw?.fileAttachments?.pageInfo?.hasNextPage),
    sources: [source],
    visits: visit ? [visit] : [],
  };
}

function connectionTruncated(connection: RawConnection | null | undefined): boolean {
  return Boolean(connection?.pageInfo?.hasNextPage);
}

function mergeNote(into: ListedNote, extra: ListedNote): void {
  for (const source of extra.sources) {
    if (!into.sources.includes(source)) into.sources.push(source);
  }
  for (const visit of extra.visits) {
    if (!into.visits.some((existing) => existing.id === visit.id)) into.visits.push(visit);
  }
  if (!into.attachments.length && extra.attachments.length) into.attachments = extra.attachments;
  if (extra.attachmentsTruncated) into.attachmentsTruncated = true;
}

async function queryWithNoteFallback(
  build: (shape: NoteQueryShape) => string,
  variables: Record<string, unknown>,
  deps: JobberDeps | undefined,
  label: string
): Promise<JobberGraphqlResult> {
  const shape = initialNoteQueryShape();
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await readGraphql(build(shape), variables, deps);
    if (!result.errors?.length) return result;
    const message = result.errors.map((error) => error.message || '').join('\n');
    if (!relaxNoteQueryShape(message, shape)) assertNoJobberErrors(result, label);
  }
  throw new Error(`${label} failed after schema fallbacks`);
}

const JOB_LOOKUP = `
  query McpNotesJobLookup($searchTerm: String!) {
    jobs(first: 8, searchTerm: $searchTerm) {
      nodes { id jobNumber }
    }
  }
`;

async function resolveJobId(
  input: ListNotesInput,
  deps?: JobberDeps
): Promise<{ id: string; jobNumber: string | number | null }> {
  const jobId = input.id?.trim() || '';
  const jobNumber = input.jobNumber?.trim() || '';
  if (jobId && looksLikeJobberEncodedId(jobId)) return { id: jobId, jobNumber: jobNumber || null };
  const number = jobNumber || jobId;
  const wanted = normalizeJobNumber(number);
  if (!wanted) throw new Error('jobId or jobNumber is required');
  const result = await readGraphql(JOB_LOOKUP, { searchTerm: number }, deps);
  assertNoJobberErrors(result, 'jobs');
  const nodes = (result.data?.jobs?.nodes || []) as Array<{ id?: string; jobNumber?: string | number | null } | null>;
  const match = nodes.find((job) => job?.id && normalizeJobNumber(job.jobNumber) === wanted);
  if (!match?.id) throw new Error(`Jobber job ${number} not found`);
  return { id: match.id, jobNumber: match.jobNumber ?? wanted };
}

function parentNotesQuery(target: NoteTarget, shape: NoteQueryShape): string {
  const notes =
    target === 'client'
      ? notesConnectionSelection(shape, null)
      : target === 'quote'
        ? notesConnectionSelection(shape, QUOTE_NOTE_MEMBERS)
        : target === 'request'
          ? notesConnectionSelection(shape, REQUEST_NOTE_MEMBERS)
          : notesConnectionSelection(shape, JOB_NOTE_MEMBERS);
  if (target === 'job') {
    return `
      query McpJobNotes($id: EncodedId!, $first: Int!) {
        job(id: $id) {
          id
          jobNumber
          title
          client { id name }
          ${notes}
        }
      }`;
  }
  if (target === 'client') {
    return `
      query McpClientNotes($id: EncodedId!, $first: Int!) {
        client(id: $id) {
          id
          name
          ${notes}
        }
      }`;
  }
  if (target === 'quote') {
    return `
      query McpQuoteNotes($id: EncodedId!, $first: Int!) {
        quote(id: $id) {
          id
          quoteNumber
          title
          ${notes}
        }
      }`;
  }
  return `
    query McpRequestNotes($id: EncodedId!, $first: Int!) {
      request(id: $id) {
        id
        title
        ${notes}
      }
    }`;
}

function visitNotesQuery(shape: NoteQueryShape, singleVisit: boolean): string {
  const notes = notesConnectionSelection(shape, JOB_NOTE_MEMBERS);
  if (singleVisit) {
    return `
      query McpVisitNotes($id: EncodedId!, $first: Int!) {
        visit(id: $id) {
          id
          title
          startAt
          job { id jobNumber }
          ${notes}
        }
      }`;
  }
  return `
    query McpJobVisitNotes($id: EncodedId!, $first: Int!) {
      job(id: $id) {
        id
        visits(first: ${VISIT_PAGE}) {
          nodes {
            id
            title
            startAt
            ${notes}
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`;
}

function sortNotes(notes: ListedNote[]): ListedNote[] {
  return [...notes].sort((a, b) => {
    const left = a.createdAt || '';
    const right = b.createdAt || '';
    if (left === right) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return left < right ? 1 : -1;
  });
}

export async function listNotes(input: ListNotesInput, deps?: JobberDeps): Promise<ListNotesResult> {
  const first = notePageSize(input.first);
  let id = input.id?.trim() || '';
  let jobNumber: string | number | null = input.jobNumber?.trim() || null;
  if (input.target === 'job') {
    const resolved = await resolveJobId(input, deps);
    id = resolved.id;
    jobNumber = resolved.jobNumber ?? jobNumber;
  }
  if (!id) throw new Error('id is required');

  const parent = await queryWithNoteFallback(
    (shape) => parentNotesQuery(input.target, shape),
    { id, first },
    deps,
    `${input.target} notes`
  );
  const record = parent.data?.[input.target] as
    | {
        id?: string;
        jobNumber?: string | number | null;
        quoteNumber?: string | number | null;
        title?: string | null;
        name?: string | null;
        client?: { name?: string | null } | null;
        notes?: RawConnection | null;
      }
    | null
    | undefined;
  if (!record?.id) throw new Error(`Jobber ${input.target} ${id} not found`);

  const source = input.target === 'job' ? 'job' : input.target;
  const notes = new Map<string, ListedNote>();
  let truncated = connectionTruncated(record.notes);
  for (const raw of record.notes?.nodes || []) {
    const note = noteFromRaw(raw, source);
    if (note) notes.set(note.id, note);
  }

  let visitNotesError: string | null = null;
  if (input.target === 'job') {
    try {
      const visitFirst = Math.min(first, 15);
      const visitResult = await queryWithNoteFallback(
        (shape) => visitNotesQuery(shape, Boolean(input.visitId)),
        { id: input.visitId || id, first: visitFirst },
        deps,
        'visit notes'
      );
      if (input.visitId) {
        const visit = visitResult.data?.visit as
          | {
              id?: string;
              title?: string | null;
              startAt?: string | null;
              job?: { id?: string | null } | null;
              notes?: RawConnection | null;
            }
          | null
          | undefined;
        if (!visit?.id) throw new Error(`Jobber visit ${input.visitId} not found`);
        if (visit.job?.id && visit.job.id !== id) {
          throw new Error(`Visit ${input.visitId} is not on job ${jobNumber ?? id}`);
        }
        truncated = truncated || connectionTruncated(visit.notes);
        const visitRef = { id: visit.id, title: visit.title ?? null, startAt: visit.startAt ?? null };
        for (const raw of visit.notes?.nodes || []) {
          const note = noteFromRaw(raw, 'visit', visitRef);
          if (!note) continue;
          const existing = notes.get(note.id);
          if (existing) mergeNote(existing, note);
          else notes.set(note.id, note);
        }
      } else {
        const job = visitResult.data?.job as
          | {
              visits?: {
                nodes?: Array<{
                  id?: string | null;
                  title?: string | null;
                  startAt?: string | null;
                  notes?: RawConnection | null;
                } | null> | null;
                pageInfo?: { hasNextPage?: boolean | null } | null;
              } | null;
            }
          | null
          | undefined;
        if (job?.visits?.pageInfo?.hasNextPage) truncated = true;
        for (const visit of job?.visits?.nodes || []) {
          if (!visit?.id) continue;
          if (connectionTruncated(visit.notes)) truncated = true;
          const visitRef = { id: visit.id, title: visit.title ?? null, startAt: visit.startAt ?? null };
          for (const raw of visit.notes?.nodes || []) {
            const note = noteFromRaw(raw, 'visit', visitRef);
            if (!note) continue;
            const existing = notes.get(note.id);
            if (existing) mergeNote(existing, note);
            else notes.set(note.id, note);
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'visit notes failed';
      if (/not on job|not found/i.test(message)) throw error;
      visitNotesError = message;
    }
  }

  const listed = sortNotes([...notes.values()]);
  return {
    target: input.target,
    id: record.id,
    jobNumber: input.target === 'job' ? (record.jobNumber ?? jobNumber) : null,
    title: record.title ?? null,
    clientName: input.target === 'client' ? record.name ?? null : record.client?.name ?? null,
    quoteNumber: input.target === 'quote' ? (record.quoteNumber ?? null) : null,
    count: listed.length,
    truncated,
    visitNotesError,
    notes: listed,
  };
}
