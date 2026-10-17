import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callJobberMcpTool } from '../mcp/jobber-tools.ts';
import { buildCreateInput, createProducts, parseCreateProductsArgs, parseListProductsArgs } from './mcp-product-create.ts';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch(handler: (query: string, variables: Record<string, unknown>) => unknown) {
  const queries: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const parsed = JSON.parse(String(init?.body || '{}')) as { query?: string; variables?: Record<string, unknown> };
    queries.push(parsed.query || '');
    return jsonResponse(handler(parsed.query || '', parsed.variables || {}));
  };
  return { fetchImpl, queries };
}

const ROW = {
  id: 'new-1', name: '1-1/4" x 2" Galvanized Pipe Nipple', description: 'E-Water GN1220', category: 'PRODUCT',
  defaultUnitCost: 3.8, internalUnitCost: 1.71, markup: 0, taxable: true, visible: true, durationMinutes: 0,
  bookableType: null, onlineBookingsEnabled: false, onlineBookingSortOrder: null,
  quantityRange: { minQuantity: null, maxQuantity: null, quantityEnabled: false },
};

describe('create_products', () => {
  it('defaults to dryRun and validates items', () => {
    const parsed = parseCreateProductsArgs({ items: [{ name: 'X nipple', unitPrice: 3 }] });
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.items[0].taxable, true);
    assert.throws(() => parseCreateProductsArgs({ items: [{ name: '', unitPrice: 3 }] }));
    assert.throws(() => parseCreateProductsArgs({ items: [{ name: 'a', unitPrice: -1 }] }));
    assert.throws(() => parseCreateProductsArgs({ items: [{ name: 'a', unitPrice: 1, visible: false }] }));
    assert.throws(() => parseCreateProductsArgs({ items: Array.from({ length: 26 }, (_, i) => ({ name: `p${i}`, unitPrice: 1 })) }));
    assert.throws(() => parseCreateProductsArgs({ items: [{ name: 'a', unitPrice: 1 }], delete: true }));
  });

  it('builds only allowed create fields', () => {
    const input = buildCreateInput(parseCreateProductsArgs({ items: [{ name: 'Hoist', unitPrice: 1200, category: 'SERVICE', taxable: false, sku: 'H' }] }).items[0]);
    assert.deepEqual(Object.keys(input).sort(), ['category', 'defaultUnitCost', 'name', 'taxable']);
  });

  it('skips existing name or sku, does not mutate on dryRun', async () => {
    const { fetchImpl, queries } = mockFetch((query, vars) => {
      if (query.includes('McpProductsDedupe')) {
        return { data: { products: { nodes: vars.searchTerm === 'GN1220' ? [{ id: 'old', name: 'GN1220 nip', description: '', visible: true }] : [] } } };
      }
      throw new Error('unexpected ' + query);
    });
    const res = await createProducts(
      parseCreateProductsArgs({ items: [
        { name: '1-1/4" x 2" Galvanized Pipe Nipple', unitPrice: 3.8, sku: 'GN1220' },
        { name: '1" x 2" Galvanized Pipe Nipple', unitPrice: 3, sku: 'GN1020' },
        { name: '1" x 2" galvanized pipe nipple', unitPrice: 3 },
      ] }),
      { token: 't', fetchImpl }
    );
    assert.deepEqual(res.map((r) => r.status), ['skipped_exists', 'would_create', 'skipped_duplicate_in_batch']);
    assert.ok(!queries.some((q) => q.includes('productsAndServicesCreate')));
  });

  it('creates and re-reads on dryRun false', async () => {
    const { fetchImpl } = mockFetch((query) => {
      if (query.includes('McpProductsDedupe')) return { data: { products: { nodes: [] } } };
      if (query.includes('productsAndServicesCreate')) return { data: { productsAndServicesCreate: { productOrService: { id: 'new-1' }, userErrors: [] } } };
      if (query.includes('McpProductById')) return { data: { product: ROW } };
      throw new Error('unexpected');
    });
    const res = await createProducts(
      parseCreateProductsArgs({ dryRun: false, items: [{ name: ROW.name, unitPrice: 3.8, internalUnitCost: 1.71 }] }),
      { token: 't', fetchImpl }
    );
    assert.equal(res[0].status, 'created');
    assert.equal(res[0].product?.unitPrice, 3.8);
  });

  it('reports userErrors as failed', async () => {
    const { fetchImpl } = mockFetch((query) => {
      if (query.includes('McpProductsDedupe')) return { data: { products: { nodes: [] } } };
      return { data: { productsAndServicesCreate: { productOrService: null, userErrors: [{ message: 'bad', path: [] }] } } };
    });
    const res = await createProducts(parseCreateProductsArgs({ dryRun: false, items: [{ name: 'Z', unitPrice: 1 }] }), { token: 't', fetchImpl });
    assert.equal(res[0].status, 'failed');
    assert.equal(res[0].error, 'bad');
  });

  it('list_products args and tool dispatch', async () => {
    assert.deepEqual(parseListProductsArgs({}), { first: 50, after: null });
    assert.throws(() => parseListProductsArgs({ first: 51 }));
    const { fetchImpl } = mockFetch(() => ({ data: { products: { nodes: [ROW], pageInfo: { hasNextPage: false, endCursor: 'x' }, totalCount: 1 } } }));
    const result = await callJobberMcpTool('list_products', { first: 10 }, { token: 't', fetchImpl });
    const body = JSON.parse(result.content[0].text);
    assert.equal(body.totalCount, 1);
    assert.equal(body.products[0].unitPrice, 3.8);
  });
});
