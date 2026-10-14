import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  initialNoteQueryShape,
  listNotes,
  notesConnectionSelection,
  parseListNotesArgs,
  relaxNoteQueryShape,
} from './mcp-notes.ts';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const JOB_ID = 'Z2lkOi8vSm9iYmVyL0pvYi8zNTk5';

describe('parseListNotesArgs', () => {
  it('accepts one target and a job number', () => {
    assert.deepEqual(parseListNotesArgs({ jobNumber: '3599', first: 10 }), {
      target: 'job',
      id: undefined,
      jobNumber: '3599',
      visitId: undefined,
      first: 10,
    });
    assert.throws(() => parseListNotesArgs({ jobId: JOB_ID, clientId: 'c' }), /exactly one/);
    assert.throws(() => parseListNotesArgs({ visitId: 'v' }), /exactly one/);
    assert.throws(() => parseListNotesArgs({ clientId: 'c', visitId: 'v' }), /only valid with a job/);
  });
});

describe('note query shape', () => {
  it('selects message, author, time, and file name or url, including visit notes', () => {
    const selection = notesConnectionSelection(initialNoteQueryShape(), ['JobNote', 'ClientNote', 'QuoteNote', 'RequestNote']);
    assert.match(selection, /message/);
    assert.match(selection, /createdAt/);
    assert.match(selection, /createdBy/);
    assert.match(selection, /fileName/);
    assert.match(selection, /\burl\b/);
    assert.match(selection, /NoteInterface/);
    assert.match(selection, /CREATED_AT/);
    const shape = initialNoteQueryShape();
    assert.equal(
      relaxNoteQueryShape('Cannot query field "fileAttachments" on type "JobNote".', shape),
      true
    );
    assert.equal(shape.files, false);
  });
});

describe('listNotes', () => {
  it('reads job and visit note text and dedupes a note that is on both', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      assert.equal(/\bmutation\b/.test(query), false);
      if (query.includes('McpJobNotes')) {
        return jsonResponse({
          data: {
            job: {
              id: JOB_ID,
              jobNumber: 3599,
              title: 'Well service',
              client: { id: 'client-1', name: 'Anothony Parlatore' },
              notes: {
                nodes: [
                  {
                    __typename: 'JobNote',
                    id: 'note-job',
                    message: 'Job finding from Haze.',
                    createdAt: '2026-10-13T15:00:00Z',
                    createdBy: { __typename: 'User', id: 'user-haze', name: { full: 'Haze' } },
                    fileAttachments: {
                      nodes: [{ id: 'file-1', fileName: 'panel.jpg', url: 'https://files.example/panel.jpg', contentType: 'image/jpeg' }],
                      pageInfo: { hasNextPage: false },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      }
      if (query.includes('McpJobVisitNotes')) {
        assert.match(query, /visits\(first:/);
        return jsonResponse({
          data: {
            job: {
              id: JOB_ID,
              visits: {
                nodes: [
                  {
                    id: 'visit-1',
                    title: 'Site visit',
                    startAt: '2026-10-13T14:00:00Z',
                    notes: {
                      nodes: [
                        {
                          __typename: 'JobNote',
                          id: 'note-job',
                          message: 'Job finding from Haze.',
                          createdAt: '2026-10-13T15:00:00Z',
                          createdBy: { __typename: 'User', id: 'user-haze', name: { full: 'Haze' } },
                          fileAttachments: { nodes: [], pageInfo: { hasNextPage: false } },
                        },
                        {
                          __typename: 'JobNote',
                          id: 'note-visit',
                          message: 'Visit-only note.',
                          createdAt: '2026-10-13T16:00:00Z',
                          createdBy: { __typename: 'User', id: 'user-haze', name: { full: 'Haze' } },
                          fileAttachments: { nodes: [], pageInfo: { hasNextPage: false } },
                        },
                      ],
                      pageInfo: { hasNextPage: false },
                    },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        });
      }
      return jsonResponse({ data: {} });
    };

    const result = await listNotes({ target: 'job', id: JOB_ID }, { fetchImpl, token: 'test' });
    assert.equal(result.jobNumber, 3599);
    assert.equal(result.clientName, 'Anothony Parlatore');
    assert.equal(result.count, 2);
    const shared = result.notes.find((note) => note.id === 'note-job');
    assert.equal(shared?.message, 'Job finding from Haze.');
    assert.equal(shared?.author?.name, 'Haze');
    assert.equal(shared?.createdAt, '2026-10-13T15:00:00Z');
    assert.deepEqual(shared?.sources.sort(), ['job', 'visit']);
    assert.equal(shared?.visits[0]?.id, 'visit-1');
    assert.equal(shared?.attachments[0]?.fileName, 'panel.jpg');
    assert.equal(shared?.attachments[0]?.url, 'https://files.example/panel.jpg');
    const visitOnly = result.notes.find((note) => note.id === 'note-visit');
    assert.equal(visitOnly?.message, 'Visit-only note.');
    assert.deepEqual(visitOnly?.sources, ['visit']);
    assert.equal(result.notes[0]?.id, 'note-visit');
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
  });

  it('resolves a job number and does not query visits for a client', async () => {
    const queries: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const query = (JSON.parse(String(init?.body || '{}')) as { query?: string }).query || '';
      queries.push(query);
      if (query.includes('McpNotesJobLookup')) {
        return jsonResponse({ data: { jobs: { nodes: [{ id: JOB_ID, jobNumber: 3599 }] } } });
      }
      if (query.includes('McpJobVisitNotes')) {
        return jsonResponse({
          data: { job: { id: JOB_ID, visits: { nodes: [], pageInfo: { hasNextPage: false } } } },
        });
      }
      if (query.includes('McpJobNotes')) {
        return jsonResponse({
          data: {
            job: {
              id: JOB_ID,
              jobNumber: 3599,
              title: null,
              client: { name: 'Anothony Parlatore' },
              notes: { nodes: [], pageInfo: { hasNextPage: false } },
            },
          },
        });
      }
      if (query.includes('McpClientNotes')) {
        assert.equal(/visits\(/.test(query), false);
        return jsonResponse({
          data: {
            client: {
              id: 'client-1',
              name: 'Pat Example',
              notes: {
                nodes: [
                  {
                    id: 'cn-1',
                    message: 'Client note',
                    createdAt: '2026-10-01T00:00:00Z',
                    createdBy: { __typename: 'User', id: 'u', name: { full: 'Brighton Scala' } },
                    fileAttachments: { nodes: [], pageInfo: { hasNextPage: false } },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        });
      }
      return jsonResponse({ data: {} });
    };

    const job = await listNotes({ target: 'job', jobNumber: '3599' }, { fetchImpl, token: 'test' });
    assert.equal(job.id, JOB_ID);
    assert.equal(queries.some((query) => query.includes('McpNotesJobLookup')), true);

    const client = await listNotes({ target: 'client', id: 'client-1' }, { fetchImpl, token: 'test' });
    assert.equal(client.notes[0]?.message, 'Client note');
    assert.equal(client.notes[0]?.author?.name, 'Brighton Scala');
    assert.equal(queries.some((query) => query.includes('McpClientNotes') && /visits\(/.test(query)), false);
  });

  it('drops fileAttachments when Jobber rejects that field and still returns the message', async () => {
    let jobAttempts = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      const query = (JSON.parse(String(init?.body || '{}')) as { query?: string }).query || '';
      if (query.includes('McpJobNotes')) {
        jobAttempts += 1;
        if (query.includes('fileAttachments')) {
          return jsonResponse({ errors: [{ message: 'Cannot query field "fileAttachments" on type "JobNote".' }] });
        }
        return jsonResponse({
          data: {
            job: {
              id: JOB_ID,
              jobNumber: 3599,
              title: null,
              client: { name: 'Pat' },
              notes: {
                nodes: [{ id: 'n1', message: 'Still here', createdAt: '2026-10-13T00:00:00Z' }],
                pageInfo: { hasNextPage: false },
              },
            },
          },
        });
      }
      if (query.includes('McpJobVisitNotes')) {
        return jsonResponse({ data: { job: { id: JOB_ID, visits: { nodes: [], pageInfo: { hasNextPage: false } } } } });
      }
      return jsonResponse({ data: {} });
    };

    const result = await listNotes({ target: 'job', id: JOB_ID }, { fetchImpl, token: 'test' });
    assert.equal(jobAttempts, 2);
    assert.equal(result.notes[0]?.message, 'Still here');
    assert.deepEqual(result.notes[0]?.attachments, []);
  });
});
