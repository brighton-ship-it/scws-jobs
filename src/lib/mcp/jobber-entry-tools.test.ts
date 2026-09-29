import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callJobberMcpTool } from './jobber-tools.ts';
import { toShopLocalDateTime } from '../jobber/mcp-schedule.ts';
import { findClientDuplicates } from '../jobber/mcp-client-writes.ts';
import { buildJobCreateInput, buildVisitCreateInput } from '../jobber/mcp-job-writes.ts';
import { buildRequestCreateInput } from '../jobber/mcp-request-writes.ts';

const CLIENT = {
  id: 'client-1',
  name: 'Pat Example',
  firstName: 'Pat',
  lastName: 'Example',
  emails: [{ address: 'pat@example.com' }],
  phones: [{ number: '7605550100' }],
  properties: [{ id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona', province: 'CA', postalCode: '92065' } }],
  quotes: { nodes: [] },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockJobberFetch(handlers: Array<(query: string, variables: Record<string, unknown>) => Response | null>) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = String(init?.body || '');
    bodies.push(body);
    const parsed = JSON.parse(body || '{}') as { query?: string; variables?: Record<string, unknown> };
    const query = parsed.query || '';
    for (const handler of handlers) {
      const match = handler(query, parsed.variables || {});
      if (match) return match;
    }
    return jsonResponse({ errors: [{ message: `unexpected query: ${query.slice(0, 80)}` }] });
  };
  return { fetchImpl, bodies };
}

function parsedBodies(bodies: string[]) {
  return bodies.map((body) => JSON.parse(body) as { query?: string; variables?: Record<string, unknown> });
}

describe('shop local datetimes', () => {
  it('converts an absolute instant to America/Los_Angeles', () => {
    const local = toShopLocalDateTime('2026-09-30T16:00:00Z', 'startAt');
    assert.equal(local.timezone, 'America/Los_Angeles');
    assert.equal(local.date, '2026-09-30');
    assert.equal(local.time, '09:00:00');
  });

  it('keeps a zone-less datetime as Los Angeles wall time', () => {
    const local = toShopLocalDateTime('2026-09-30T09:30', 'startAt');
    assert.deepEqual(local, { date: '2026-09-30', time: '09:30:00', timezone: 'America/Los_Angeles' });
  });
});

describe('duplicate clients', () => {
  it('matches the same email or the same full name only', () => {
    const matches = findClientDuplicates([CLIENT], {
      firstName: 'Pat',
      lastName: 'Other',
      emails: [{ address: 'pat@example.com' }],
    });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].matchedBy, 'email');

    const byName = findClientDuplicates([CLIENT], { firstName: 'Pat', lastName: 'Example', emails: [] });
    assert.equal(byName[0].matchedBy, 'name');

    const miss = findClientDuplicates([CLIENT], { firstName: 'Pat', lastName: 'Examples', emails: [] });
    assert.equal(miss.length, 0);
  });
});

describe('write payloads stay quiet', () => {
  it('forces job and assessment notify flags off and omits a job visit datetime', () => {
    const job = buildJobCreateInput({ propertyId: 'prop-1', title: 'One off', lineItems: [] });
    const scheduling = job.scheduling as { createVisits: boolean; notifyTeam: boolean; startAt?: string };
    assert.equal(scheduling.createVisits, false);
    assert.equal(scheduling.notifyTeam, false);
    assert.equal('startAt' in scheduling, false);
    assert.equal(job.allowReviewRequest, false);
    assert.equal('recurrence' in (job.scheduling as object), false);
    assert.equal(JSON.stringify(job).includes('productOrServiceId'), false);

    const visit = buildVisitCreateInput({
      startAt: '2026-09-30T09:00:00',
      endAt: '2026-09-30T10:00:00',
      assigneeIds: ['user-brighton'],
    });
    const schedule = (visit.visits as Array<{ schedule: { notifyTeam: boolean; teamReminderOffset?: number } }>)[0]
      .schedule;
    assert.equal(schedule.notifyTeam, false);
    assert.equal('teamReminderOffset' in schedule, false);

    const request = buildRequestCreateInput({
      clientId: 'client-1',
      propertyId: 'prop-1',
      title: 'Job walk',
      startAt: '2026-09-30T09:00:00',
      endAt: '2026-09-30T10:00:00',
      assigneeIds: ['user-brighton'],
      details: 'Gate code 4',
    });
    const assessment = request.assessment as { instructions: string; schedule: { notifyTeam: boolean } };
    assert.equal(assessment.instructions, 'Gate code 4');
    assert.equal(assessment.schedule.notifyTeam, false);
    assert.equal(JSON.stringify(request).includes('clientConfirmed'), false);
  });
});

describe('callJobberMcpTool entry writes', () => {
  it('refuses a duplicate client unless force=true, and never opts them into messages', async () => {
    const blocked = mockJobberFetch([
      (query) =>
        query.includes('ClientSearch')
          ? jsonResponse({ data: { clients: { nodes: [CLIENT] } } })
          : null,
    ]);
    const refused = await callJobberMcpTool(
      'create_client',
      { firstName: 'Pat', lastName: 'Example', emails: [{ address: 'pat@example.com' }] },
      { fetchImpl: blocked.fetchImpl, token: 'test' }
    );
    assert.equal(refused.isError, undefined);
    const payload = JSON.parse(refused.content[0].text) as { created: boolean; matches: unknown[] };
    assert.equal(payload.created, false);
    assert.equal(payload.matches.length, 1);
    assert.equal(blocked.bodies.some((body) => body.includes('clientCreate')), false);

    const created = mockJobberFetch([
      (query) =>
        query.includes('McpClientCreate')
          ? jsonResponse({
              data: {
                clientCreate: {
                  client: {
                    id: 'client-2',
                    name: 'Pat Example',
                    firstName: 'Pat',
                    lastName: 'Example',
                    emails: [{ address: 'pat@example.com' }],
                    phones: [{ number: '7605550100' }],
                    properties: [{ id: 'prop-9', address: { street1: '100 Oak Rd', city: 'Ramona' } }],
                  },
                  userErrors: [],
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'create_client',
      {
        firstName: 'Pat',
        lastName: 'Example',
        emails: [{ address: 'pat@example.com', description: 'MAIN' }],
        phones: [{ number: '7605550100' }],
        property: { street1: '100 Oak Rd', city: 'Ramona', province: 'CA', postalCode: '92065' },
        force: true,
      },
      { fetchImpl: created.fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const input = parsedBodies(created.bodies)[0].variables?.input as {
      receivesReminders: boolean;
      phones: Array<{ smsAllowed: boolean }>;
      properties: Array<{ address: { country: string } }>;
    };
    assert.equal(input.receivesReminders, false);
    assert.equal(input.phones[0].smsAllowed, false);
    assert.equal(input.properties[0].address.country, 'US');
    assert.equal(JSON.stringify(input).includes('"smsAllowed":true'), false);
  });

  it('rejects a notify argument', async () => {
    const result = await callJobberMcpTool(
      'create_client',
      { firstName: 'A', lastName: 'B', notify: true },
      { token: 'test' }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /cannot send, email, text, or notify/i);
  });

  it('creates a property with PropertyCreateInput.properties', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('McpPropertyCreate')
          ? jsonResponse({
              data: {
                propertyCreate: {
                  properties: [{ id: 'prop-2', address: { street1: '5 Elm', city: 'Ramona', province: 'CA' } }],
                  userErrors: [],
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'create_property',
      { clientId: 'client-1', street1: '5 Elm', city: 'Ramona', province: 'CA', postalCode: '92065' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const variables = parsedBodies(bodies)[0].variables as {
      input: { properties: Array<{ address: { street1: string; country: string } }> };
    };
    assert.equal(variables.input.properties[0].address.street1, '5 Elm');
    assert.equal(variables.input.properties[0].address.country, 'US');
    assert.equal('address' in (variables.input as object), false);
  });

  it('lists users and filters by name', async () => {
    const { fetchImpl } = mockJobberFetch([
      (query) =>
        query.includes('McpUsers')
          ? jsonResponse({
              data: {
                users: {
                  nodes: [
                    {
                      id: 'user-brighton',
                      status: 'ACTIVATED',
                      name: { full: 'Brighton Scala', first: 'Brighton', last: 'Scala' },
                      email: { raw: 'brighton@example.com' },
                    },
                    {
                      id: 'user-other',
                      status: 'ACTIVATED',
                      name: { full: 'Ada Other', first: 'Ada', last: 'Other' },
                      email: { raw: 'ada@example.com' },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool('list_users', { query: 'Brighton Scala' }, { fetchImpl, token: 'test' });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as { count: number; users: Array<{ id: string }> };
    assert.equal(payload.count, 1);
    assert.equal(payload.users[0].id, 'user-brighton');
  });

  it('creates a request and schedules the assessment without notifying', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('McpClientById')
          ? jsonResponse({ data: { client: CLIENT } })
          : null,
      (query) =>
        query.includes('requestCreate(input')
          ? jsonResponse({
              data: {
                requestCreate: {
                  request: {
                    id: 'req-1',
                    title: 'Job walk',
                    requestStatus: 'upcoming',
                    isScheduled: true,
                    client: { id: 'client-1', name: 'Pat Example' },
                    property: { id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } },
                    assessment: {
                      id: 'assess-1',
                      startAt: '2026-09-30T16:00:00Z',
                      endAt: '2026-09-30T17:00:00Z',
                      instructions: 'Meet at the well',
                      assignedUsers: { nodes: [{ id: 'user-brighton', name: { full: 'Brighton Scala' } }] },
                    },
                  },
                  userErrors: [],
                },
              },
            })
          : null,
      (query) =>
        query.includes('requestCreateNote')
          ? jsonResponse({
              data: { requestCreateNote: { requestNote: { id: 'note-1', message: 'Meet at the well' }, userErrors: [] } },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'create_request',
      {
        clientId: 'client-1',
        title: 'Job walk',
        details: 'Meet at the well',
        startAt: '2026-09-30T09:00:00',
        endAt: '2026-09-30T10:00:00',
        assigneeIds: ['user-brighton'],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      scheduledAssessment: boolean;
      noteId: string;
      request: { assessment: { assignees: Array<{ name: string }> } };
    };
    assert.equal(payload.scheduledAssessment, true);
    assert.equal(payload.noteId, 'note-1');
    assert.equal(payload.request.assessment.assignees[0].name, 'Brighton Scala');
    const create = parsedBodies(bodies).find((body) => body.query?.includes('requestCreate(input'));
    const input = create?.variables?.input as {
      assessment: { schedule: { notifyTeam: boolean; startAt: { date: string; time: string; timezone: string }; teamMemberIdsToAssign: string[] } };
    };
    assert.equal(input.assessment.schedule.notifyTeam, false);
    assert.deepEqual(input.assessment.schedule.startAt, {
      date: '2026-09-30',
      time: '09:00:00',
      timezone: 'America/Los_Angeles',
    });
    assert.deepEqual(input.assessment.schedule.teamMemberIdsToAssign, ['user-brighton']);
    assert.equal(bodies.some((body) => /emailCreate|quoteSend|sms/.test(body)), false);
  });

  it('searches requests', async () => {
    const { fetchImpl } = mockJobberFetch([
      (query) =>
        query.includes('McpRequestsSearch')
          ? jsonResponse({
              data: {
                requests: {
                  nodes: [
                    {
                      id: 'req-1',
                      title: 'Job walk',
                      requestStatus: 'upcoming',
                      isScheduled: true,
                      client: { id: 'client-1', name: 'Pat Example' },
                      property: { id: 'prop-1', address: { city: 'Ramona', street1: '100 Oak Rd' } },
                      assessment: { id: 'assess-1', startAt: '2026-09-30T16:00:00Z', endAt: null, instructions: null },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool('search_requests', { query: 'Job walk' }, { fetchImpl, token: 'test' });
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as { count: number; requests: Array<{ id: string }> };
    assert.equal(payload.count, 1);
    assert.equal(payload.requests[0].id, 'req-1');
  });

  it('creates a one-off job, copies a catalog line, and schedules the visit with visitCreate', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) => (query.includes('McpClientById') ? jsonResponse({ data: { client: CLIENT } }) : null),
      (query) =>
        query.includes('McpProductById')
          ? jsonResponse({
              data: {
                product: {
                  id: 'prod-1',
                  name: 'Job walk',
                  description: 'On site',
                  defaultUnitCost: 0,
                  taxable: false,
                  category: 'SERVICE',
                },
              },
            })
          : null,
      (query) =>
        query.includes('McpJobCreate')
          ? jsonResponse({
              data: {
                jobCreate: {
                  job: {
                    id: 'job-encoded-1',
                    jobNumber: 9001,
                    title: 'Job walk',
                    jobStatus: 'upcoming',
                    jobType: 'ONE_OFF',
                    client: { id: 'client-1', name: 'Pat Example' },
                    property: { id: 'prop-1', address: { street1: '100 Oak Rd', city: 'Ramona' } },
                  },
                  userErrors: [],
                },
              },
            })
          : null,
      (query) =>
        query.includes('McpVisitCreate')
          ? jsonResponse({
              data: {
                visitCreate: {
                  createdVisits: [
                    {
                      id: 'visit-1',
                      title: 'Job walk',
                      startAt: '2026-09-30T16:00:00Z',
                      endAt: '2026-09-30T17:00:00Z',
                      assignedUsers: { nodes: [{ id: 'user-brighton', name: { full: 'Brighton Scala' } }] },
                    },
                  ],
                  userErrors: [],
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'create_job',
      {
        clientId: 'client-1',
        title: 'Job walk',
        instructions: 'Look at the well',
        lineItems: [{ quantity: 1, productOrServiceId: 'prod-1' }],
        startAt: '2026-09-30T09:00:00',
        endAt: '2026-09-30T10:00:00',
        assigneeIds: ['user-brighton'],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as {
      job: { id: string };
      visits: Array<{ id: string }>;
      visitError: string | null;
    };
    assert.equal(payload.job.id, 'job-encoded-1');
    assert.equal(payload.visits[0].id, 'visit-1');
    assert.equal(payload.visitError, null);
    const jobCreate = parsedBodies(bodies).find((body) => body.query?.includes('jobCreate'));
    const jobInput = jobCreate?.variables?.input as {
      scheduling: { createVisits: boolean; notifyTeam: boolean; startTime?: string };
      lineItems: Array<Record<string, unknown>>;
      allowReviewRequest: boolean;
    };
    assert.equal(jobInput.scheduling.createVisits, false);
    assert.equal(jobInput.scheduling.notifyTeam, false);
    assert.equal(jobInput.allowReviewRequest, false);
    assert.equal('startTime' in jobInput.scheduling, false);
    assert.equal(jobInput.lineItems[0].name, 'Job walk');
    assert.equal(jobInput.lineItems[0].unitPrice, 0);
    assert.equal(jobInput.lineItems[0].saveToProductsAndServices, false);
    assert.equal('productOrServiceId' in jobInput.lineItems[0], false);
    const visit = parsedBodies(bodies).find((body) => body.query?.includes('visitCreate'));
    const visitInput = visit?.variables?.input as {
      visits: Array<{ schedule: { notifyTeam: boolean; teamMemberIdsToAssign: string[] } }>;
    };
    assert.equal(visitInput.visits[0].schedule.notifyTeam, false);
    assert.deepEqual(visitInput.visits[0].schedule.teamMemberIdsToAssign, ['user-brighton']);
  });

  it('schedules a visit on an existing job', async () => {
    const jobId = 'Z2lkOi8vSm9iYmVyL0pvYi84ODAx';
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('visitCreate')
          ? jsonResponse({
              data: {
                visitCreate: {
                  createdVisits: [{ id: 'visit-9', title: 'Walk', startAt: '2026-09-30T16:00:00Z', endAt: '2026-09-30T17:00:00Z' }],
                  userErrors: [],
                },
              },
            })
          : null,
      (query) =>
        query.includes('job(id:')
          ? jsonResponse({
              data: {
                job: {
                  id: jobId,
                  jobNumber: 8801,
                  title: 'Walk',
                  jobStatus: 'upcoming',
                  client: { id: 'client-1', firstName: 'Pat' },
                  property: { id: 'prop-1', address: { city: 'Ramona' } },
                  noteAttachments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
                },
              },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'create_visit',
      {
        jobId,
        title: 'Walk',
        startAt: '2026-09-30T09:00:00',
        endAt: '2026-09-30T10:00:00',
        assigneeIds: ['user-brighton'],
      },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as { visits: Array<{ id: string }> };
    assert.equal(payload.visits[0].id, 'visit-9');
    const visit = parsedBodies(bodies).find((body) => body.query?.includes('visitCreate'));
    const schedule = (
      visit?.variables?.input as { visits: Array<{ schedule: { notifyTeam: boolean } }> }
    ).visits[0].schedule;
    assert.equal(schedule.notifyTeam, false);
  });

  it('adds a note with quoteCreateNote and does not send the quote', async () => {
    const { fetchImpl, bodies } = mockJobberFetch([
      (query) =>
        query.includes('McpQuoteCreateNote')
          ? jsonResponse({
              data: { quoteCreateNote: { quoteNote: { id: 'qn-1', message: 'Private' }, userErrors: [] } },
            })
          : null,
    ]);
    const result = await callJobberMcpTool(
      'create_note',
      { quoteId: 'quote-1', message: 'Private' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text) as { noteId: string; target: string };
    assert.equal(payload.noteId, 'qn-1');
    assert.equal(payload.target, 'quote');
    assert.equal(bodies.some((body) => /quoteSend|transitionQuoteTo|sentAt/.test(body)), false);
  });
});
