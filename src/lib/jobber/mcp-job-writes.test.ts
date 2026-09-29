import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJobCloseInput,
  closeJob,
  normalizeIncompleteVisits,
} from './mcp-job-writes.ts';

const JOB_ID = 'Z2lkOi8vSm9iYmVyL0pvYi84ODAx';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('closeJob', () => {
  it('requires an incomplete-visit decision and never calls jobComplete', () => {
    assert.throws(() => normalizeIncompleteVisits(''), /incompleteVisits is required/);
    assert.equal(normalizeIncompleteVisits('complete past destroy future'), 'COMPLETE_PAST_DESTROY_FUTURE');
    assert.deepEqual(buildJobCloseInput('DESTROY_ALL'), { modifyIncompleteVisitsBy: 'DESTROY_ALL' });
  });

  it('closes with jobClose and does not email', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const query = (JSON.parse(body) as { query?: string }).query || '';
      if (query.includes('mutation') && query.includes('jobClose')) {
        return jsonResponse({
          data: {
            jobClose: {
              job: { id: JOB_ID, jobNumber: 8801, jobStatus: 'archived', completedAt: '2026-09-29T00:00:00Z' },
              userErrors: [],
            },
          },
        });
      }
      if (query.includes('job(id:')) {
        return jsonResponse({
          data: {
            job: {
              id: JOB_ID,
              jobNumber: 8801,
              title: 'Pull pump',
              jobStatus: 'requires_invoicing',
              completedAt: null,
              client: { id: 'client-1', name: 'Pat', firstName: 'Pat' },
              property: { id: 'prop-1', address: { city: 'Ramona' } },
              noteAttachments: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
            },
          },
        });
      }
      return jsonResponse({ errors: [{ message: 'unexpected' }] });
    };

    const job = await closeJob(
      { jobId: JOB_ID, incompleteVisits: 'COMPLETE_PAST_DESTROY_FUTURE' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(job.id, JOB_ID);
    const close = JSON.parse(bodies.find((body) => body.includes('jobClose')) || '{}') as {
      variables?: { input?: { modifyIncompleteVisitsBy?: string } };
      query?: string;
    };
    assert.equal(close.variables?.input?.modifyIncompleteVisitsBy, 'COMPLETE_PAST_DESTROY_FUTURE');
    assert.equal(/jobComplete/.test(close.query || ''), false);
    assert.ok(bodies.every((body) => !/sendJob|emailCreate/.test(body)));
  });
});
