/**
 * Notes on a client, request, job, or quote.
 *
 * Public introspection at API version 2025-01-20 (gateway pin stays
 * 2025-04-16) has no generic noteCreate. The mutations are:
 * - clientCreateNote(clientId, input: ClientCreateNoteInput!)
 * - requestCreateNote(requestId, input: RequestCreateNoteInput!)
 * - jobCreateNote(jobId, input: JobCreateNoteInput!)
 * - quoteCreateNote(quoteId, input: QuoteCreateNoteInput!)
 * Each input is { message, attachments, linkedTo }. This tool sends message
 * only. The 2025-04-16 changelog removed the older clientNoteCreate,
 * jobNoteCreate, and requestNoteCreate names.
 *
 * Notes do not email or text the client. linkedTo is omitted so a note is
 * not copied onto an invoice.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
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
