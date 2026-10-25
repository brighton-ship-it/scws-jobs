import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callJobberMcpTool } from '../mcp/jobber-tools.ts';
import { editProperty, parseEditPropertyArgs, propertyAddressFromNode } from './mcp-property-edit.ts';

const TOM_PROPERTY = 'Z2lkOi8vSm9iYmVyL1Byb3BlcnR5LzE2MzI1NTUyMQ==';
const TOM_CLIENT = 'Z2lkOi8vSm9iYmVyL0NsaWVudC8xNTczNjgwOTg=';

const BEFORE = {
  street1: 'Lyon Avenue',
  street2: null,
  city: 'San Jacinto',
  province: 'CA',
  postalCode: '92582',
  country: 'US',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockProperty(options?: { clientId?: string | null; address?: typeof BEFORE }) {
  const bodies: Array<{ query: string; variables: Record<string, unknown> }> = [];
  let address = { ...(options?.address || BEFORE) };
  const clientId = options && 'clientId' in options ? options.clientId : TOM_CLIENT;
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    const query = body.query || '';
    const variables = body.variables || {};
    bodies.push({ query, variables });
    if (query.includes('propertyEdit')) {
      const patch = (variables.input as { address?: Record<string, string> } | undefined)?.address || {};
      address = { ...address, ...patch };
      return jsonResponse({
        data: { propertyEdit: { property: { id: TOM_PROPERTY }, userErrors: [] } },
      });
    }
    if (query.includes('McpPropertyForEdit')) {
      return jsonResponse({
        data: {
          property: {
            id: TOM_PROPERTY,
            isBillingAddress: false,
            client: clientId ? { id: clientId } : null,
            address,
          },
        },
      });
    }
    return jsonResponse({ errors: [{ message: 'unexpected query' }] });
  };
  return { fetchImpl, bodies };
}

describe('parseEditPropertyArgs', () => {
  it('requires propertyId', () => {
    assert.throws(() => parseEditPropertyArgs({ street1: '1 Main' }), /propertyId is required/);
  });

  it('requires an address field', () => {
    assert.throws(() => parseEditPropertyArgs({ propertyId: TOM_PROPERTY }), /At least one address field/);
    assert.throws(() => parseEditPropertyArgs({ propertyId: TOM_PROPERTY, street1: '   ' }), /street1 cannot be empty/);
  });

  it('defaults dryRun to true and rejects primary', () => {
    const parsed = parseEditPropertyArgs({ propertyId: TOM_PROPERTY, street1: '1521 North Lyon Avenue' });
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.clientId, null);
    assert.throws(
      () => parseEditPropertyArgs({ propertyId: TOM_PROPERTY, street1: '1 Main', primary: true }),
      /no primary flag/
    );
  });

  it('rejects unsupported fields and a non-boolean dryRun', () => {
    assert.throws(
      () => parseEditPropertyArgs({ propertyId: TOM_PROPERTY, street1: '1 Main', name: 'Home' }),
      /Unsupported fields: name/
    );
    assert.throws(
      () => parseEditPropertyArgs({ propertyId: TOM_PROPERTY, street1: '1 Main', dryRun: 'false' }),
      /dryRun must be a boolean/
    );
  });
});

describe('editProperty', () => {
  it('dryRun default reads the property and does not call propertyEdit', async () => {
    const { fetchImpl, bodies } = mockProperty();
    const result = await editProperty(
      parseEditPropertyArgs({
        propertyId: TOM_PROPERTY,
        clientId: TOM_CLIENT,
        street1: '1521 North Lyon Avenue',
        city: 'San Jacinto',
        province: 'CA',
        postalCode: '92582',
      }),
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.dryRun, true);
    assert.equal(result.mutated, false);
    assert.equal(result.status, 'would_update');
    assert.equal(result.notified, false);
    assert.equal(result.before.street1, 'Lyon Avenue');
    assert.equal(result.after.street1, '1521 North Lyon Avenue');
    assert.equal(result.after.city, 'San Jacinto');
    assert.equal(result.after.country, 'US');
    assert.deepEqual(result.would_update, {
      propertyId: TOM_PROPERTY,
      input: {
        address: {
          street1: '1521 North Lyon Avenue',
          city: 'San Jacinto',
          province: 'CA',
          postalCode: '92582',
          country: 'US',
        },
      },
    });
    assert.equal(bodies.some((body) => body.query.includes('propertyEdit')), false);
    assert.equal(bodies.some((body) => body.query.includes('clientEdit')), false);
    assert.equal(bodies.length, 1);
  });

  it('live path sends the merged address and re-reads', async () => {
    const { fetchImpl, bodies } = mockProperty();
    const result = await editProperty(
      parseEditPropertyArgs({
        propertyId: TOM_PROPERTY,
        clientId: TOM_CLIENT,
        street1: '1521 North Lyon Avenue',
        dryRun: false,
      }),
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.mutated, true);
    assert.equal(result.status, 'updated');
    assert.equal(result.would_update, null);
    assert.equal(result.after.street1, '1521 North Lyon Avenue');
    assert.equal(result.after.city, 'San Jacinto');
    const edit = bodies.find((body) => body.query.includes('propertyEdit'));
    assert.ok(edit);
    assert.deepEqual(edit?.variables, {
      propertyId: TOM_PROPERTY,
      input: {
        address: {
          street1: '1521 North Lyon Avenue',
          city: 'San Jacinto',
          province: 'CA',
          postalCode: '92582',
          country: 'US',
        },
      },
    });
    assert.equal(JSON.stringify(edit?.variables).includes('clientId'), false);
    assert.equal(JSON.stringify(edit?.variables).includes('customFields'), false);
    assert.equal(JSON.stringify(edit?.variables).includes('taxRateId'), false);
    assert.equal(bodies.filter((body) => body.query.includes('McpPropertyForEdit')).length, 2);
  });

  it('refuses a clientId that does not own the property and does not write', async () => {
    const { fetchImpl, bodies } = mockProperty();
    await assert.rejects(
      editProperty(
        parseEditPropertyArgs({
          propertyId: TOM_PROPERTY,
          clientId: 'Z2lkOi8vSm9iYmVyL0NsaWVudC9vdGhlcg==',
          street1: '1521 North Lyon Avenue',
          dryRun: false,
        }),
        { fetchImpl, token: 'test' }
      ),
      /propertyEdit was not called/
    );
    assert.equal(bodies.some((body) => body.query.includes('propertyEdit')), false);
  });

  it('uses top-level property fields when the address object is blank', () => {
    const address = propertyAddressFromNode({
      street1: 'Lyon Avenue',
      city: 'San Jacinto',
      province: 'CA',
      postalCode: '92582',
      country: 'US',
      address: { street1: '', city: null },
    });
    assert.equal(address.street1, 'Lyon Avenue');
    assert.equal(address.city, 'San Jacinto');
    assert.equal(address.country, 'US');
  });

  it('does not call propertyEdit when the address already matches', async () => {
    const { fetchImpl, bodies } = mockProperty();
    const result = await editProperty(
      parseEditPropertyArgs({ propertyId: TOM_PROPERTY, street1: 'Lyon Avenue', dryRun: false }),
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.status, 'unchanged');
    assert.equal(result.mutated, false);
    assert.equal(result.input, null);
    assert.equal(bodies.some((body) => body.query.includes('propertyEdit')), false);
  });

  it('surfaces propertyEdit userErrors and does not report a write', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as { query?: string };
      bodies.push(body.query || '');
      if ((body.query || '').includes('propertyEdit')) {
        return jsonResponse({
          data: { propertyEdit: { property: null, userErrors: [{ message: 'Address is invalid', path: ['input', 'address'] }] } },
        });
      }
      return jsonResponse({
        data: {
          property: {
            id: TOM_PROPERTY,
            isBillingAddress: false,
            client: { id: TOM_CLIENT },
            address: BEFORE,
          },
        },
      });
    };
    await assert.rejects(
      editProperty(
        parseEditPropertyArgs({ propertyId: TOM_PROPERTY, street1: '1521 North Lyon Avenue', dryRun: false }),
        { fetchImpl, token: 'test' }
      ),
      /Address is invalid/
    );
    assert.equal(bodies.filter((query) => query.includes('McpPropertyForEdit')).length, 1);
  });
});

describe('edit_property tool', () => {
  it('dryRun through the dispatcher does not mutate', async () => {
    const { fetchImpl, bodies } = mockProperty();
    const result = await callJobberMcpTool(
      'edit_property',
      { propertyId: TOM_PROPERTY, street1: '1521 North Lyon Avenue' },
      { fetchImpl, token: 'test' }
    );
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /would_update/);
    assert.match(result.content[0].text, /propertyEdit was not called/);
    assert.equal(bodies.some((body) => body.query.includes('propertyEdit')), false);
  });

  it('returns validation errors for a missing propertyId and for no address fields', async () => {
    const missing = await callJobberMcpTool('edit_property', { street1: '1 Main' }, { token: 'test' });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /propertyId is required/);
    const empty = await callJobberMcpTool('edit_property', { propertyId: TOM_PROPERTY }, { token: 'test' });
    assert.equal(empty.isError, true);
    assert.match(empty.content[0].text, /At least one address field/);
  });

  it('rejects a notify argument before any Jobber call', async () => {
    const result = await callJobberMcpTool(
      'edit_property',
      { propertyId: TOM_PROPERTY, street1: '1 Main', notify: true },
      { token: 'test' }
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /cannot send, email, text, or notify/i);
  });
});
