import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReadOnlyJobQuery,
  buildJobServerFilter,
  getJob,
  isJobPhoto,
  searchJobs,
  type JobberJobDetail,
  type JobberJobFileNode,
} from './mcp-jobs.ts';

const DONE: JobberJobDetail = {
  id: 'job-1',
  jobNumber: 4401,
  title: 'Pull pump — Ramona',
  jobStatus: 'requires_invoicing',
  completedAt: '2026-09-22T18:00:00.000Z',
  createdAt: '2026-09-20T15:00:00.000Z',
  jobberWebUri: 'https://secure.getjobber.com/jobs/4401',
  client: { id: 'client-1', name: 'Pat Example', firstName: 'Pat', lastName: 'Example' },
  property: { id: 'prop-1', address: { city: 'Ramona' } },
  noteAttachments: {
    nodes: [
      {
        id: 'file-1',
        fileName: 'well.jpg',
        contentType: 'image/jpeg',
        url: 'https://files.getjobber.com/well.jpg',
        thumbnailUrl: 'https://files.getjobber.com/well-thumb.jpg',
      },
      {
        id: 'file-pdf',
        fileName: 'permit.pdf',
        contentType: 'application/pdf',
        url: 'https://files.getjobber.com/permit.pdf',
      },
      {
        id: 'file-http',
        fileName: 'old.jpg',
        contentType: 'image/jpeg',
        url: 'http://files.getjobber.com/old.jpg',
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};

const OLDER: JobberJobDetail = {
  ...DONE,
  id: 'job-old',
  jobNumber: 100,
  title: 'Older job',
  completedAt: '2026-09-01T12:00:00.000Z',
  property: { id: 'prop-2', address: { city: 'Anza' } },
  client: { id: 'client-2', name: 'Sam Older', firstName: 'Sam' },
  noteAttachments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
};

const OPEN_JOB: JobberJobDetail = {
  ...DONE,
  id: 'job-open',
  jobNumber: 4500,
  title: 'Still on site',
  jobStatus: 'active',
  completedAt: null,
  property: { id: 'prop-3', address: { city: 'Ramona' } },
  noteAttachments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function connection(
  nodes: JobberJobDetail[],
  pageInfo: { hasNextPage?: boolean; endCursor?: string | null } = {}
) {
  return {
    edges: nodes.map((node) => ({ cursor: `c-${node.id}`, node })),
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage ?? false,
      endCursor: pageInfo.endCursor === undefined ? (nodes.length ? `c-${nodes[nodes.length - 1].id}` : null) : pageInfo.endCursor,
    },
  };
}

function mockFetch(
  handlers: Array<(query: string, variables: Record<string, unknown>) => Response | null>
) {
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
    return jsonResponse({ data: {} });
  };
  return { fetchImpl, bodies };
}

describe('job filter helpers', () => {
  it('builds a completedAt window and skips the local completed status', () => {
    const filter = buildJobServerFilter({
      status: 'completed',
      completedAfter: '2026-09-22T00:00:00.000Z',
      completedBefore: '2026-09-23',
    });
    assert.equal(filter?.status, undefined);
    assert.equal(filter?.completedAt?.after, '2026-09-22T00:00:00.000Z');
    assert.equal(filter?.completedAt?.before, '2026-09-23T23:59:59.999Z');
    assert.equal(buildJobServerFilter({ status: 'requires invoicing' })?.status, 'requires_invoicing');
  });

  it('keeps https images and drops pdfs and non-https urls', () => {
    const photo: JobberJobFileNode = {
      contentType: 'image/png',
      url: 'https://files.getjobber.com/a.png',
    };
    assert.equal(isJobPhoto(photo), true);
    assert.equal(isJobPhoto({ contentType: 'application/pdf', url: 'https://files.getjobber.com/a.pdf' }), false);
    assert.equal(isJobPhoto({ contentType: 'image/jpeg', url: 'http://files.getjobber.com/a.jpg' }), false);
  });

  it('refuses mutation documents', () => {
    assert.throws(() => assertReadOnlyJobQuery('mutation JobComplete { jobComplete(id: "x") { job { id } } }'), /read-only/);
  });
});

describe('searchJobs', () => {
  it('returns completed jobs in the window with city, first name, and https photo urls', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) =>
        query.includes('McpJobs')
          ? jsonResponse({ data: { jobs: connection([DONE, OLDER, OPEN_JOB]) } })
          : null,
    ]);

    const result = await searchJobs(
      { completedAfter: '2026-09-22T00:00:00.000Z', status: 'completed', first: 10 },
      { fetchImpl, token: 'test' }
    );
    assert.deepEqual(
      result.jobs.map((job) => job.id),
      ['job-1']
    );
    assert.equal(result.jobs[0].jobNumber, 4401);
    assert.equal(result.jobs[0].title, DONE.title);
    assert.equal(result.jobs[0].completedAt, DONE.completedAt);
    assert.equal(result.jobs[0].createdAt, DONE.createdAt);
    assert.equal(result.jobs[0].city, 'Ramona');
    assert.equal(result.jobs[0].client?.firstName, 'Pat');
    assert.equal(result.jobs[0].client?.name, 'Pat');
    assert.deepEqual(result.jobs[0].photoUrls, ['https://files.getjobber.com/well.jpg']);
    assert.equal(result.jobs[0].photos[0].thumbnailUrl, 'https://files.getjobber.com/well-thumb.jpg');
    assert.equal(JSON.stringify(result).includes('pat@') || JSON.stringify(result).includes('email'), false);
    const sent = JSON.parse(bodies.find((body) => body.includes('McpJobs')) || '{}') as {
      query?: string;
      variables?: { filter?: { completedAt?: { after?: string } } };
    };
    assert.equal(sent.variables?.filter?.completedAt?.after, '2026-09-22T00:00:00.000Z');
    assert.match(sent.query || '', /noteAttachments/);
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
    assert.equal(bodies.some((body) => /jobCreate|jobComplete|jobEdit/.test(body)), false);
    assert.equal(bodies.some((body) => /emails\s*\{/.test(body)), false);
  });

  it('returns an empty list when nothing completed in the window', async () => {
    const { fetchImpl } = mockFetch([
      () => jsonResponse({ data: { jobs: connection([OLDER, OPEN_JOB]) } }),
    ]);
    const result = await searchJobs(
      { completedAfter: '2026-09-22T00:00:00.000Z' },
      { fetchImpl, token: 'test' }
    );
    assert.deepEqual(result.jobs, []);
    assert.deepEqual(result.pageInfo, { hasNextPage: false, endCursor: 'c-job-open' });
  });

  it('filters by title, client, and city', async () => {
    const { fetchImpl } = mockFetch([
      () => jsonResponse({ data: { jobs: connection([DONE, OLDER]) } }),
    ]);
    const byCity = await searchJobs({ query: 'Ramona' }, { fetchImpl, token: 'test' });
    assert.deepEqual(
      byCity.jobs.map((job) => job.id),
      ['job-1']
    );
    const byClient = await searchJobs({ query: 'Sam' }, { fetchImpl, token: 'test' });
    assert.equal(byClient.jobs[0].id, 'job-old');
    const byTitle = await searchJobs({ query: 'Pull pump' }, { fetchImpl, token: 'test' });
    assert.equal(byTitle.jobs[0].jobNumber, 4401);
  });

  it('continues with the after cursor', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (_query, variables) => {
        if (variables.after === 'c-job-1') {
          return jsonResponse({
            data: { jobs: connection([OLDER], { hasNextPage: false, endCursor: 'c-job-old' }) },
          });
        }
        return jsonResponse({
          data: { jobs: connection([DONE, OLDER], { hasNextPage: false, endCursor: 'c-job-old' }) },
        });
      },
    ]);
    const first = await searchJobs(
      { completedAfter: '2026-09-01T00:00:00.000Z', first: 1 },
      { fetchImpl, token: 'test' }
    );
    assert.equal(first.jobs[0].id, 'job-1');
    assert.equal(first.pageInfo.hasNextPage, true);
    assert.equal(first.pageInfo.endCursor, 'c-job-1');
    const second = await searchJobs(
      { completedAfter: '2026-09-01T00:00:00.000Z', first: 1, after: first.pageInfo.endCursor },
      { fetchImpl, token: 'test' }
    );
    assert.equal(second.jobs[0].id, 'job-old');
    const continued = JSON.parse(bodies.at(-1) || '{}') as { variables?: { after?: string } };
    assert.equal(continued.variables?.after, 'c-job-1');
  });

  it('filters completedAfter on the client when Jobber rejects the filter field', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (_query, variables) => {
        const filter = variables.filter as { completedAt?: unknown } | undefined;
        if (filter?.completedAt) {
          return jsonResponse({
            errors: [
              {
                message: "InputObject 'JobFilterAttributes' doesn't accept argument 'completedAt'",
              },
            ],
          });
        }
        return jsonResponse({ data: { jobs: connection([DONE, OLDER, OPEN_JOB]) } });
      },
    ]);
    const result = await searchJobs(
      { completedAfter: '2026-09-22T00:00:00.000Z' },
      { fetchImpl, token: 'test' }
    );
    assert.deepEqual(
      result.jobs.map((job) => job.id),
      ['job-1']
    );
    const retried = bodies.filter((body) => body.includes('McpJobs'));
    assert.ok(retried.length >= 2);
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
  });

  it('falls back to client jobs when job searchTerm is rejected', async () => {
    const { fetchImpl, bodies } = mockFetch([
      (query) => {
        if (query.includes('searchTerm') && query.includes('McpJobs')) {
          return jsonResponse({
            errors: [{ message: "Field 'jobs' doesn't accept argument 'searchTerm'" }],
          });
        }
        if (query.includes('ClientSearch')) {
          return jsonResponse({
            data: { clients: { nodes: [{ id: 'client-1', name: 'Pat Example', firstName: 'Pat' }] } },
          });
        }
        if (query.includes('McpClientJobs')) {
          return jsonResponse({ data: { client: { jobs: connection([DONE, OLDER]) } } });
        }
        if (query.includes('McpJobs')) {
          return jsonResponse({ data: { jobs: connection([]) } });
        }
        return null;
      },
    ]);
    const result = await searchJobs({ query: 'Pat Example' }, { fetchImpl, token: 'test' });
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].id, 'job-1');
    assert.equal(result.jobs[0].client?.firstName, 'Pat');
    assert.ok(bodies.some((body) => body.includes('McpClientJobs')));
    assert.equal(bodies.some((body) => /\bmutation\b/.test(body)), false);
  });

  it('uses fileUrl when Jobber rejects the url field on note files', async () => {
    const { fetchImpl } = mockFetch([
      (query) => {
        if (query.includes('noteAttachments') && /\burl\b/.test(query) && !query.includes('fileUrl')) {
          return jsonResponse({
            errors: [{ message: "Cannot query field \"url\" on type \"JobNoteFile\"." }],
          });
        }
        const node = {
          ...DONE,
          noteAttachments: {
            nodes: [
              {
                id: 'file-1',
                fileName: 'well.jpg',
                contentType: 'image/jpeg',
                fileUrl: 'https://files.getjobber.com/well-file.jpg',
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        };
        return jsonResponse({ data: { jobs: connection([node]) } });
      },
    ]);
    const result = await searchJobs({ query: '4401' }, { fetchImpl, token: 'test' });
    assert.deepEqual(result.jobs[0].photoUrls, ['https://files.getjobber.com/well-file.jpg']);
  });
});

describe('getJob', () => {
  it('loads one job by encoded id with the full photo list', async () => {
    const extra = Array.from({ length: 3 }, (_, index) => ({
      id: `file-extra-${index}`,
      fileName: `extra-${index}.jpg`,
      contentType: 'image/jpeg',
      url: `https://files.getjobber.com/extra-${index}.jpg`,
    }));
    const { fetchImpl, bodies } = mockFetch([
      (query, variables) => {
        if (query.includes('McpJobPhotos')) {
          return jsonResponse({
            data: {
              job: {
                id: 'job-1',
                noteAttachments: {
                  nodes: extra,
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          });
        }
        if (query.includes('McpJobById')) {
          return jsonResponse({
            data: {
              job: {
                ...DONE,
                noteAttachments: {
                  nodes: DONE.noteAttachments?.nodes,
                  pageInfo: { hasNextPage: true, endCursor: 'photo-1' },
                },
              },
            },
          });
        }
        assert.equal(variables.id, 'Z2lkOi8vSm9iYmVyL0pvYi8x');
        return null;
      },
    ]);
    const job = await getJob(
      { jobId: 'Z2lkOi8vSm9iYmVyL0pvYi8x' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(job.id, 'job-1');
    assert.equal(job.jobNumber, 4401);
    assert.equal(job.city, 'Ramona');
    assert.equal(job.client?.firstName, 'Pat');
    assert.deepEqual(job.photoUrls, [
      'https://files.getjobber.com/well.jpg',
      'https://files.getjobber.com/extra-0.jpg',
      'https://files.getjobber.com/extra-1.jpg',
      'https://files.getjobber.com/extra-2.jpg',
    ]);
    const query =
      (JSON.parse(bodies.find((body) => body.includes('McpJobById')) || '{}') as { query?: string }).query || '';
    assert.match(query, /query McpJobById/);
    assert.equal(/\bmutation\b/.test(query), false);
    assert.ok(bodies.some((body) => body.includes('McpJobPhotos')));
  });

  it('loads one job by job number', async () => {
    const { fetchImpl } = mockFetch([
      (query) => {
        if (query.includes('McpJobById')) {
          return jsonResponse({ data: { job: DONE } });
        }
        if (query.includes('McpJobs')) {
          return jsonResponse({ data: { jobs: connection([OLDER, DONE]) } });
        }
        return null;
      },
    ]);
    const job = await getJob({ jobNumber: '4401' }, { fetchImpl, token: 'test' });
    assert.equal(job.id, 'job-1');
    assert.equal(job.photoUrls[0], 'https://files.getjobber.com/well.jpg');
  });

  it('errors when neither id nor number is provided', async () => {
    await assert.rejects(() => getJob({}), /jobId or jobNumber is required/);
  });
});
