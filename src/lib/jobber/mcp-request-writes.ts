/**
 * Create a Jobber request and, when asked, schedule its on-site assessment.
 *
 * Schema (public introspection, API version 2025-01-20; gateway pin stays
 * 2025-04-16):
 * - requestCreate(input: RequestCreateInput!)
 *   clientId is required. propertyId, title, and assessment are optional.
 *   requestDetails is a structured form (FormInput), not free text, so this
 *   module does not send it.
 * - AssessmentCreateInput is { instructions, schedule }. It has no title and
 *   no clientConfirmed flag. The request title is the only title.
 * - schedule is ScheduledItemAttributes (LocalDateTimeAttributes plus
 *   teamMemberIdsToAssign). notifyTeam is forced false. teamReminderOffset
 *   is omitted.
 * - Free-text details are assessment instructions (when an assessment is
 *   scheduled) and requestCreateNote(requestId, input: { message }).
 *   The 2025-04-16 changelog removed the older requestNoteCreate name.
 *   requestCreateNote was already the field on the 2025-01-20 schema.
 *
 * Nothing here emails, texts, or sends a booking confirmation.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  jobberUserErrors,
} from './client.ts';
import { getClientById } from './mcp-quotes.ts';
import { assertNoClientNotification, assertWriteDoesNotDeliver } from './mcp-notify.ts';
import { buildScheduledItemAttributes } from './mcp-schedule.ts';
import { propertyIds } from './mcp-client-writes.ts';
import { summarizeRequest, type RequestSummary } from './mcp-requests.ts';
import { resolveQuoteCreatePropertyId, type JobberDeps } from './quotes.ts';

const REQUEST_CREATE = `
  mutation McpRequestCreate($input: RequestCreateInput!) {
    requestCreate(input: $input) {
      request {
        id
        title
        requestStatus
        jobberWebUri
        isScheduled
        client { id name }
        property { id address { street1 city province postalCode } }
        assessment {
          id
          startAt
          endAt
          instructions
          assignedUsers(first: 8) { nodes { id name { full } } }
        }
      }
      userErrors { message path }
    }
  }
`;

const REQUEST_NOTE = `
  mutation McpRequestCreateNote($requestId: EncodedId!, $input: RequestCreateNoteInput!) {
    requestCreateNote(requestId: $requestId, input: $input) {
      requestNote { id message }
      userErrors { message path }
    }
  }
`;

export type CreateRequestInput = {
  clientId: string;
  propertyId?: string | null;
  title: string;
  details?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  assigneeIds?: string[];
};

export type CreateRequestResult = {
  notified: false;
  scheduledAssessment: boolean;
  request: RequestSummary;
  noteId: string | null;
  noteError: string | null;
  limitations: string[];
};

export const REQUEST_ASSESSMENT_LIMITATIONS = [
  'AssessmentCreateInput has instructions and schedule only. The assessment title cannot be set; the request title is the title.',
  'requestDetails is a structured form, not notes. Details are saved as assessment instructions when an assessment is scheduled, and as requestCreateNote.',
  'notifyTeam is false. teamReminderOffset is omitted. clientConfirmed is not set. Nothing is emailed or texted.',
];

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertWriteDoesNotDeliver(query);
  assertNoClientNotification(variables);
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function buildRequestCreateInput(
  input: CreateRequestInput & { propertyId: string }
): Record<string, unknown> {
  const startAt = input.startAt?.trim() || '';
  const endAt = input.endAt?.trim() || '';
  if (Boolean(startAt) !== Boolean(endAt)) {
    throw new Error('startAt and endAt are both required to schedule an on-site assessment');
  }
  if ((input.assigneeIds?.length || 0) > 0 && !startAt) {
    throw new Error('startAt and endAt are required when assigneeIds are set');
  }
  const attributes: Record<string, unknown> = {
    clientId: input.clientId.trim(),
    propertyId: input.propertyId,
    title: input.title.trim(),
  };
  if (!attributes.title) throw new Error('title is required');
  if (startAt) {
    const assessment: Record<string, unknown> = {
      schedule: buildScheduledItemAttributes({
        startAt,
        endAt,
        assigneeIds: input.assigneeIds,
      }),
    };
    const details = input.details?.trim();
    if (details) assessment.instructions = details;
    attributes.assessment = assessment;
  }
  assertNoClientNotification(attributes);
  return attributes;
}

export async function createRequest(
  input: CreateRequestInput,
  deps?: JobberDeps
): Promise<CreateRequestResult> {
  const clientId = input.clientId.trim();
  if (!clientId) throw new Error('clientId is required');
  const client = await getClientById(clientId, deps);
  const propertyId = resolveQuoteCreatePropertyId(input.propertyId, client.properties);
  const known = propertyIds(client);
  if (!known.includes(propertyId)) {
    throw new Error(`propertyId ${propertyId} is not on client ${clientId}`);
  }
  const variables = { input: buildRequestCreateInput({ ...input, clientId, propertyId }) };
  const created = await graphql(REQUEST_CREATE, variables, deps);
  assertNoJobberErrors(created, 'requestCreate');
  const payload = created.data?.requestCreate;
  const errors = jobberUserErrors(payload);
  if (errors.length) throw new Error(errors.join('; '));
  const request = summarizeRequest(payload?.request);
  if (!request) throw new Error('Jobber requestCreate returned no request');

  const details = input.details?.trim() || '';
  let noteId: string | null = null;
  let noteError: string | null = null;
  if (details) {
    try {
      const noted = await graphql(REQUEST_NOTE, { requestId: request.id, input: { message: details } }, deps);
      assertNoJobberErrors(noted, 'requestCreateNote');
      const notePayload = noted.data?.requestCreateNote;
      const noteErrors = jobberUserErrors(notePayload);
      if (noteErrors.length) noteError = noteErrors.join('; ');
      else noteId = notePayload?.requestNote?.id ?? null;
      if (!noteId && !noteError) noteError = 'Jobber requestCreateNote returned no note';
    } catch (error) {
      noteError = error instanceof Error ? error.message : 'requestCreateNote failed';
    }
  }

  return {
    notified: false,
    scheduledAssessment: Boolean(input.startAt?.trim()),
    request,
    noteId,
    noteError,
    limitations: REQUEST_ASSESSMENT_LIMITATIONS,
  };
}
