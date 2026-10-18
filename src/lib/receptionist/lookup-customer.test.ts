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

  it('toAddressOnFile ignores empty addresses', () => {
    assert.equal(toAddressOnFile({ street1: '', city: 'Anza' }), null);
    assert.equal(toAddressOnFile(null), null);
  });
});
