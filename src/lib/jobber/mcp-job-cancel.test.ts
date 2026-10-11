import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  cancelJob,
  cancelVisit,
  guardBlockers,
  parseExplicitId,
  parseReason,
  rescheduleVisit,
  type AuditEntry,
} from './mcp-job-cancel.ts';
import { callJobberMcpTool } from '../mcp/jobber-tools.ts';

const JOB = 'Z2lkOi8vSm9iYmVyL0pvYi8xNTk3MjMyODQ=';
const VISIT = 'Z2lkOi8vSm9iYmVyL1Zpc2l0LzIzNjA5OTE2MDk=';

function res(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function world(opts: { invoices?: unknown[]; status?: string; visitComplete?: boolean } = {}) {
  const calls: string[] = [];
  let deleted = false;
  const fetchImpl: typeof fetch = async (_u, init) => {
    const q = (JSON.parse(String(init?.body)) as { query: string }).query;
    calls.push(q.match(/(mutation|query) (\w+)/)?.[2] || q);
    if (q.includes('McpCancelJobState')) {
      return res({
        data: {
          job: {
            id: JOB, jobNumber: 3582, title: 'Service Call', jobStatus: opts.status || 'upcoming', completedAt: null,
            jobberWebUri: 'u', client: { id: 'c', name: 'Gerald' },
            property: { address: { street1: '1 Rd', city: 'Jamul' } },
            invoices: { nodes: opts.invoices || [] },
            visits: { nodes: deleted ? [] : [{ id: VISIT, title: 'Service Call', startAt: '2026-10-12T15:00:00Z', endAt: '2026-10-12T17:00:00Z', completedAt: null, isComplete: Boolean(opts.visitComplete), assignedUsers: { nodes: [{ id: 'u1', name: { full: 'Colton Hagler' } }] } }] },
          },
        },
      });
    }
    if (q.includes('visitDelete') || q.includes('jobClose')) {
      deleted = true;
      return res({ data: { visitDelete: { visits: [{ id: VISIT }], userErrors: [] }, jobClose: { job: { id: JOB }, userErrors: [] } } });
    }
    if (q.includes('visitEditSchedule')) return res({ data: { visitEditSchedule: { visit: { id: VISIT }, userErrors: [] } } });
    if (q.includes('visitEditAssignedUsers')) return res({ data: { visitEditAssignedUsers: { visit: { id: VISIT }, userErrors: [] } } });
    return res({ errors: [{ message: 'unexpected' }] });
  };
  const log: AuditEntry[] = [];
  const audit = async (e: AuditEntry) => {
    log.push(e);
    return { console: true, supabase: false };
  };
  return { fetchImpl, calls, log, audit, deps: { fetchImpl, token: 't' } };
}

describe('guards', () => {
  it('requires reason and explicit encoded ids', () => {
    assert.throws(() => parseReason(''), /reason is required/);
    assert.throws(() => parseReason('no'), /reason is required/);
    assert.throws(() => parseExplicitId('3582', 'jobId'), /not a job number/);
    assert.throws(() => parseExplicitId('', 'jobId'), /required/);
    assert.equal(parseExplicitId(JOB, 'jobId'), JOB);
  });

  it('flags invoices, payments, completed', () => {
    const base = { id: 'j', jobNumber: 1, title: null, jobStatus: 'upcoming', completedAt: null, jobberWebUri: null, client: null, address: null, invoices: [], visits: [] };
    assert.deepEqual(guardBlockers(base, 'cancel_job'), []);
    assert.match(guardBlockers({ ...base, jobStatus: 'archived' }, 'cancel_job').join(), /archived/);
    const inv = { ...base, invoices: [{ id: 'i', invoiceNumber: 1, status: 'paid', total: 10, paymentsTotal: 10 }] };
    assert.match(guardBlockers(inv, 'cancel_visit').join(), /invoice/);
    assert.match(guardBlockers(inv, 'cancel_visit').join(), /payments/);
  });
});

describe('cancel/reschedule', () => {
  it('dryRun reads only: no mutation, before state, undo note, audit line', async () => {
    const w = world();
    const r = await cancelVisit({ jobId: JOB, visitId: VISIT, reason: 'test dry run', dryRun: true }, w.deps, w.audit);
    assert.equal(r.changed, false);
    assert.equal(r.after, null);
    assert.match(r.undo, /create_visit/);
    assert.equal(r.before.visits[0].assignees[0].name, 'Colton Hagler');
    assert.deepEqual(w.calls, ['McpCancelJobState']);
    assert.equal(w.log.length, 1);
    assert.equal(w.log[0].dryRun, true);
  });

  it('cancel_visit deletes with visitDelete and returns before/after', async () => {
    const w = world();
    const r = await cancelVisit({ jobId: JOB, visitId: VISIT, reason: 'office asked' }, w.deps, w.audit);
    assert.equal(r.changed, true);
    assert.equal(r.before.visits.length, 1);
    assert.equal(r.after?.visits.length, 0);
    assert.ok(r.warnings.some((x) => /last open visit/.test(x)));
    assert.ok(w.calls.includes('McpCancelVisitDelete'));
    assert.equal(w.log[0].ok, true);
  });

  it('cancel_job uses jobClose DESTROY_ALL', async () => {
    const w = world();
    let sent = '';
    const inner = w.fetchImpl;
    const deps = { token: 't', fetchImpl: (async (u: any, i: any) => { if (String(i.body).includes('jobClose')) sent = String(i.body); return inner(u, i); }) as typeof fetch };
    const r = await cancelJob({ jobId: JOB, reason: 'customer cancelled' }, deps, w.audit);
    assert.match(sent, /DESTROY_ALL/);
    assert.match(r.undo, /Reopen job/);
  });

  it('refuses invoiced jobs without force and audits the refusal', async () => {
    const w = world({ invoices: [{ id: 'i', invoiceNumber: 5, invoiceStatus: 'sent', amounts: { total: 200, paymentsTotal: 0 } }] });
    await assert.rejects(cancelJob({ jobId: JOB, reason: 'try it' }, w.deps, w.audit), /Refused: job has 1 invoice/);
    assert.equal(w.calls.some((c) => c === 'McpCancelJobClose'), false);
    assert.equal(w.log[0].refused, true);
    const forced = await cancelJob({ jobId: JOB, reason: 'office confirmed', force: true }, w.deps, w.audit);
    assert.equal(forced.changed, true);
    assert.ok(forced.warnings.some((x) => /force=true/.test(x)));
  });

  it('refuses a visit that is not on the job', async () => {
    const w = world();
    await assert.rejects(cancelVisit({ jobId: JOB, visitId: 'Z2lkOi8vSm9iYmVyL1Zpc2l0LzE=', reason: 'wrong visit' }, w.deps, w.audit), /does not belong/);
  });

  it('reschedule_visit sends local times, no notify, optional assignment', async () => {
    const w = world();
    const bodies: string[] = [];
    const inner = w.fetchImpl;
    const deps = { token: 't', fetchImpl: (async (u: any, i: any) => { bodies.push(String(i.body)); return inner(u, i); }) as typeof fetch };
    const r = await rescheduleVisit({ jobId: JOB, visitId: VISIT, startAt: '2026-10-13T08:00', endAt: '2026-10-13T10:00', assigneeIds: ['u2'], reason: 'moved by office' }, deps, w.audit);
    assert.equal(r.changed, true);
    const edit = bodies.find((b) => b.includes('visitEditSchedule'))!;
    assert.match(edit, /"time":"08:00:00"/);
    assert.match(edit, /America\/Los_Angeles/);
    assert.doesNotMatch(edit, /notifyTeam":true/);
    assert.ok(bodies.some((b) => b.includes('visitEditAssignedUsers')));
    assert.match(r.undo, /startAt 2026-10-12T15:00:00Z/);
  });

  it('MCP tool call: missing reason is an error and nothing is fetched', async () => {
    const w = world();
    const out = await callJobberMcpTool('cancel_job', { jobId: JOB }, w.deps);
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /reason is required/);
    assert.equal(w.calls.length, 0);
  });
});

describe('not exposed to the receptionist', () => {
  it('no receptionist or webhook file imports the cancel module', () => {
    const roots = ['src/lib/receptionist', 'src/app/api/receptionist'];
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    for (const root of roots) {
      for (const file of walk(root)) {
        const text = readFileSync(file, 'utf8');
        assert.doesNotMatch(text, /mcp-job-cancel|cancel_job|cancel_visit|reschedule_visit/, file);
      }
    }
  });
});
