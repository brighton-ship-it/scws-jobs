import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchProductCosts } from './quotes.ts';
import { searchJobberProducts } from './products.ts';
import { searchProducts } from './mcp-quotes.ts';

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function productPage(
  nodes: Array<Record<string, unknown>>,
  pageInfo: { hasNextPage?: boolean; endCursor?: string | null } = { hasNextPage: false, endCursor: null }
) {
  return jsonResponse({ data: { products: { nodes, pageInfo } } });
}

const GOULDS = {
  id: 'prod-25gbc',
  name: 'Goulds 25GBC',
  description: '1 HP end suction',
  defaultUnitCost: 899,
  taxable: true,
  category: 'PRODUCT',
  internalUnitCost: 410,
};

describe('Jobber product search (2025-04-16)', () => {
  it('queries products(searchTerm, first, after) and does not swallow GraphQL errors', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return jsonResponse({
        errors: [{ message: "Cannot query field 'productsAndServices' on type 'Query'. Did you mean 'products'?" }],
      });
    };

    await assert.rejects(
      () => searchProducts('25GBC', { fetchImpl, token: 'test' }),
      /productsAndServices/
    );
    assert.equal(bodies.length, 1);
    const query = (JSON.parse(bodies[0]) as { query?: string }).query || '';
    assert.match(query, /products\s*\(\s*searchTerm:/);
    assert.match(query, /\$after:\s*String/);
    assert.equal(/productsAndServices/.test(query), false);
    assert.equal(/internalUnitCost/.test(query), false);
  });

  it('returns a server-side match without paging the catalog', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      bodies.push(String(init?.body || ''));
      return productPage([GOULDS]);
    };

    const result = await searchProducts('25GBC', { fetchImpl, token: 'test' });
    assert.equal(result.matchedBy, 'search');
    assert.equal(result.truncated, false);
    assert.equal(result.products.length, 1);
    assert.deepEqual(result.products[0], {
      id: 'prod-25gbc',
      name: 'Goulds 25GBC',
      description: '1 HP end suction',
      defaultUnitCost: 899,
      taxable: true,
      category: 'PRODUCT',
    });
    assert.equal(JSON.stringify(result).includes('internalUnitCost'), false);
    assert.equal(bodies.length, 1);
    assert.match((JSON.parse(bodies[0]) as { query?: string }).query || '', /JobberProductsSearch/);
  });

  it('pages the catalog and filters name or description when server search is empty', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body) as { query?: string; variables?: { searchTerm?: string; after?: string } };
      if (parsed.variables?.searchTerm) return productPage([]);
      if (!parsed.variables?.after) {
        return productPage(
          [{ id: 'other', name: 'BT2', description: 'labor', defaultUnitCost: 600, taxable: false, category: 'SERVICE' }],
          { hasNextPage: true, endCursor: 'cursor-2' }
        );
      }
      assert.equal(parsed.variables.after, 'cursor-2');
      return productPage([
        {
          id: 'prod-25gbc',
          name: 'Goulds pump',
          description: 'Model 25GBC installed',
          defaultUnitCost: 899,
          taxable: true,
          category: 'PRODUCT',
        },
      ]);
    };

    const result = await searchJobberProducts('25gbc', { fetchImpl, token: 'test' });
    assert.equal(result.matchedBy, 'catalog');
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0]?.id, 'prod-25gbc');
    assert.equal(result.products[0]?.description, 'Model 25GBC installed');
    const queries = bodies.map((body) => (JSON.parse(body) as { query?: string }).query || '');
    assert.match(queries[0] || '', /JobberProductsSearch/);
    assert.match(queries[1] || '', /JobberProductsPage/);
    assert.equal(/searchTerm/.test(queries[1] || ''), false);
    assert.match(queries[2] || '', /JobberProductsPage/);
  });

  it('keeps internal unit cost on the GP lookup and shares one catalog scan', async () => {
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = String(init?.body || '');
      bodies.push(body);
      const parsed = JSON.parse(body) as { query?: string; variables?: { searchTerm?: string } };
      const query = parsed.query || '';
      assert.match(query, /internalUnitCost/);
      assert.equal(/productsAndServices/.test(query), false);
      if (parsed.variables?.searchTerm) return productPage([]);
      return productPage([GOULDS, { id: 'other', name: 'BT2', description: 'labor', defaultUnitCost: 600, taxable: false, category: 'SERVICE', internalUnitCost: 0 }]);
    };

    const costs = await fetchProductCosts(['25GBC', 'missing-sku'], { fetchImpl, token: 'test' });
    assert.equal(costs.length, 1);
    assert.equal(costs[0]?.name, 'Goulds 25GBC');
    assert.equal(costs[0]?.internalUnitCost, 410);
    assert.equal(costs[0]?.defaultUnitCost, 899);
    const pageQueries = bodies.filter((body) => (JSON.parse(body) as { query?: string }).query?.includes('JobberProductsPage'));
    assert.equal(pageQueries.length, 1);
  });

  it('surfaces cost-lookup GraphQL errors instead of an empty cost list', async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ errors: [{ message: "Field 'products' doesn't accept argument 'searchTerm'" }] });

    await assert.rejects(
      () => fetchProductCosts(['25GBC'], { fetchImpl, token: 'test' }),
      /searchTerm/
    );
  });

  it('uses injected product costs without calling Jobber', async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return jsonResponse({ data: {} });
    };
    const costs = await fetchProductCosts(['25GBC'], {
      fetchImpl,
      token: 'test',
      productCosts: [{ name: 'Goulds 25GBC', internalUnitCost: 12, defaultUnitCost: 20 }],
    });
    assert.equal(called, false);
    assert.equal(costs[0]?.internalUnitCost, 12);
  });
});
