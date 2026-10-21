import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleLookupCustomer, toAddressOnFile } from './lookup-customer.ts';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function mockClients(nodes: unknown[]) {
  const seen: string[] = [];
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || '{}'));
    seen.push(body.query);
    return jsonResponse({ data: { clients: { nodes } } });
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

const brighton = {
  id: 'c1',
  name: 'brighton scala',
  phones: [{ number: '(408) 318-1171' }],
  billingAddress: { street1: 'PO Box 1', city: 'Ramona', province: 'CA', postalCode: '92065' },
  properties: [
    { address: { street1: '57174 Highway 371', street2: '', city: 'Anza', province: 'CA', postalCode: '92539' } },
  ],
};

describe('handleLookupCustomer', () => {
  it('returns the property street and town on file (usual-address caller)', async () => {
    const { fetchFn, seen } = mockClients([brighton]);
    const { result } = await handleLookupCustomer('+14083181171', { accessToken: 't', fetchFn });
    assert.equal(result.found, true);
    assert.equal(result.customerName, 'brighton scala');
    assert.equal(result.address, '57174 Highway 371');
    assert.equal(result.city, 'Anza');
    assert.equal(result.zip, '92539');
    assert.equal(result.addressOnFile?.full, '57174 Highway 371, Anza');
    assert.notEqual(result.city?.toLowerCase(), 'scala');
    assert.match(result.addressRule || '', /never use the caller's name as the town/i);
    assert.match(seen[0], /properties/);
    assert.match(seen[0], /billingAddress/);
  });

  it('lists extra properties and falls back to billing only when no property exists', async () => {
    const multi = { ...brighton, properties: [...brighton.properties, { address: { street1: '1077 Main Street', street2: 'Unit B', city: 'Ramona' } }] };
    let { result } = await handleLookupCustomer('4083181171', { accessToken: 't', fetchFn: mockClients([multi]).fetchFn });
    assert.equal(result.city, 'Anza');
    assert.equal(result.otherAddresses?.[0].full, '1077 Main Street Unit B, Ramona');

    const billingOnly = { ...brighton, properties: [] };
    ({ result } = await handleLookupCustomer('4083181171', { accessToken: 't', fetchFn: mockClients([billingOnly]).fetchFn }));
    assert.equal(result.addressOnFile?.full, 'PO Box 1, Ramona');
  });

  it('found without an address leaves address fields empty instead of guessing', async () => {
    const bare = { id: 'c2', name: 'Jane Doe', phones: [{ number: '7605551234' }], billingAddress: null, properties: [] };
    const { result } = await handleLookupCustomer('7605551234', { accessToken: 't', fetchFn: mockClients([bare]).fetchFn });
    assert.equal(result.found, true);
    assert.equal(result.city, undefined);
    assert.equal(result.addressOnFile, undefined);
  });

  it('requires an exact 10-digit phone match', async () => {
    const { result } = await handleLookupCustomer('7605559999', { accessToken: 't', fetchFn: mockClients([brighton]).fetchFn });
    assert.equal(result.found, false);
  });

  it('returns the property town when the billing city is different (David Garcia, 10/14)', async () => {
    const david = {
      id: 'dg',
      name: 'David Garcia',
      phones: [{ number: '7605550140' }],
      billingAddress: { street1: '1 Billing Rd', city: 'Ramona', province: 'CA', postalCode: '92065' },
      properties: [
        { address: { street1: '400 Well Rd', city: 'Temecula', province: 'CA', postalCode: '92592' } },
      ],
    };
    const { result } = await handleLookupCustomer('7605550140', { accessToken: 't', fetchFn: mockClients([david]).fetchFn });
    assert.equal(result.city, 'Temecula');
    assert.equal(result.addressOnFile?.city, 'Temecula');
    assert.equal(result.addressOnFile?.street, '400 Well Rd');
  });

  it('falls back to the billing address when the client has no properties', async () => {
    const billingOnly = {
      id: 'bill',
      name: 'Billing Only',
      phones: [{ number: '7605550141' }],
      billingAddress: { street1: '9 Oak', city: 'Ramona', province: 'CA', postalCode: '92065' },
      properties: [],
    };
    const { result } = await handleLookupCustomer('7605550141', { accessToken: 't', fetchFn: mockClients([billingOnly]).fetchFn });
    assert.equal(result.found, true);
    assert.equal(result.city, 'Ramona');
    assert.equal(result.addressOnFile?.city, 'Ramona');
    assert.equal(result.address, '9 Oak');
  });

  it('toAddressOnFile ignores empty addresses', () => {
    assert.equal(toAddressOnFile({ street1: '', city: 'Anza' }), null);
    assert.equal(toAddressOnFile(null), null);
  });
});

describe('recentJobsForClient', () => {
  it('returns real jobs newest first, skips practice/meeting jobs, no numbers or money', async () => {
    const { recentJobsForClient } = await import('./lookup-customer.ts');
    const client = {
      jobs: {
        nodes: [
          { title: 'Pressure tank replacement', jobStatus: 'archived', createdAt: '2026-08-10T17:00:00Z', completedAt: '2026-08-12T20:00:00Z' },
          { title: 'TRAINING - Close & Invoice ($5) - Colton', jobStatus: 'upcoming', createdAt: '2026-10-17T17:00:00Z', completedAt: null },
          { title: 'Shop Meeting - Anza', jobStatus: 'upcoming', createdAt: '2026-10-16T17:00:00Z', completedAt: null },
          { title: 'Service Call', jobStatus: 'upcoming', createdAt: '2026-10-15T17:00:00Z', completedAt: null },
          { title: '', jobStatus: 'archived', createdAt: '2026-01-01T00:00:00Z' },
          { title: 'Pump replacement', jobStatus: 'archived', createdAt: '2025-03-01T17:00:00Z', completedAt: '2025-03-02T17:00:00Z' },
          { title: 'Old', jobStatus: 'archived', createdAt: '2024-03-01T17:00:00Z' },
        ],
      },
    };
    const jobs = recentJobsForClient(client, new Date('2026-10-18T20:00:00Z'));
    assert.deepEqual(jobs.map((j) => j.title), ['Service Call', 'Pressure tank replacement', 'Pump replacement']);
    assert.equal(jobs[0].status, 'open');
    assert.equal(jobs[1].when, 'August 2026');
    assert.equal(jobs[1].status, 'done');
    assert.equal(jobs[0].daysAgo, 3);
    for (const j of jobs) assert.equal(Object.keys(j).sort().join(','), 'daysAgo,status,title,when');
  });

  it('lookup result carries recentJobs only when there are any', async () => {
    const withJobs = { ...brighton, jobs: { nodes: [{ title: 'Booster pump install', jobStatus: 'archived', createdAt: '2026-09-01T17:00:00Z' }] } };
    const { fetchFn, seen } = mockClients([withJobs]);
    let { result } = await handleLookupCustomer('4083181171', { accessToken: 't', fetchFn });
    assert.equal(result.recentJobs?.[0].title, 'Booster pump install');
    assert.match(result.pastWorkRule || '', /never read job numbers, prices, invoices or balances/i);
    assert.match(seen[0], /jobs\(first: 10\)/);
    ({ result } = await handleLookupCustomer('4083181171', { accessToken: 't', fetchFn: mockClients([brighton]).fetchFn }));
    assert.equal(result.recentJobs, undefined);
  });
});
