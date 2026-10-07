import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { callJobberMcpTool } from '../mcp/jobber-tools.ts';
import { JOBBER_MAX_QUERY_COST } from '../receptionist/jobber-throttle.ts';
import {
  GET_PRODUCTS_DEFAULT_FIRST,
  GET_PRODUCTS_MAX_FIRST,
  PRODUCT_NODE_FIELD_COST,
  PRODUCT_SELECTION_FIELDS,
  ProductEditUserError,
  buildProductEditInput,
  editProduct,
  getProducts,
  mapJobberProductDetail,
  parseEditProductArgs,
  parseGetProductsArgs,
  productByIdQueryCost,
  productSearchQueryCost,
} from './mcp-products.ts';

const JOBBER_MAX = 10_000;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const GOULDS = {
  id: 'prod-25gbc',
  name: 'Goulds 25GBC',
  description: '1 HP end suction',
  category: 'PRODUCT',
  defaultUnitCost: 899,
  internalUnitCost: 410,
  markup: 119.268,
  taxable: true,
  visible: true,
  durationMinutes: 0,
  bookableType: null,
  onlineBookingsEnabled: false,
  onlineBookingSortOrder: 4,
  quantityRange: { minQuantity: 1, maxQuantity: 3, quantityEnabled: true },
};

function productData(overrides: Record<string, unknown> = {}) {
  return { ...GOULDS, ...overrides };
}

function mockFetch(handler: (query: string, variables: Record<string, unknown>) => Response) {
  const bodies: string[] = [];
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = String(init?.body || '');
    bodies.push(body);
    const parsed = JSON.parse(body || '{}') as { query?: string; variables?: Record<string, unknown> };
    return handler(parsed.query || '', parsed.variables || {});
  };
  return { fetchImpl, bodies };
}

const depsEnv = { env: {} as NodeJS.ProcessEnv, token: 'test' };

describe('product query cost', () => {
  it('keeps an explicit page well under the 10000-point cap', () => {
    assert.equal(PRODUCT_NODE_FIELD_COST, PRODUCT_SELECTION_FIELDS.length);
    assert.equal(PRODUCT_NODE_FIELD_COST, 17);
    const page = productSearchQueryCost(GET_PRODUCTS_MAX_FIRST);
    assert.equal(page, GET_PRODUCTS_MAX_FIRST * 17 + 4);
    assert.ok(page < 1_000);
    assert.ok(page < JOBBER_MAX_QUERY_COST);
    assert.equal(JOBBER_MAX_QUERY_COST, JOBBER_MAX);
    assert.ok(productByIdQueryCost(25) < 1_000);
  });
});

describe('getProducts', () => {
  it('loads one or more ids with cost fields and does not page the catalog', async () => {
    const { fetchImpl, bodies } = mockFetch((query, variables) => {
      assert.match(query, /query McpProductById/);
      assert.match(query, /product\(id: \$id\)/);
      assert.equal(/productsAndServices/.test(query), false);
      assert.equal(/customFields|lastJobLineItem/.test(query), false);
      assert.match(query, /internalUnitCost/);
      assert.match(query, /markup/);
      assert.match(query, /visible/);
      assert.match(query, /defaultUnitCost/);
      assert.equal(query.includes('unitPrice'), false);
      const id = String(variables.id);
      if (id === 'prod-25gbc') return jsonResponse({ data: { product: productData() } });
      return jsonResponse({
        data: {
          product: productData({
            id: 'prod-hidden',
            name: 'Old Goulds',
            visible: false,
            internalUnitCost: 50,
            defaultUnitCost: 80,
          }),
        },
      });
    });

    const result = await getProducts(
      parseGetProductsArgs({ ids: ['prod-25gbc', 'prod-hidden'] }),
      { ...depsEnv, fetchImpl }
    );
    assert.equal(result.matchedBy, 'id');
    assert.equal(result.pageInfo, null);
    assert.equal(result.products.length, 2);
    assert.equal(result.products[0]?.unitPrice, 899);
    assert.equal(result.products[0]?.defaultUnitCost, 899);
    assert.equal(result.products[0]?.internalUnitCost, 410);
    assert.equal(result.products[0]?.markup, 119.268);
    assert.equal(result.products[0]?.visible, true);
    assert.equal(result.products[0]?.archived, false);
    assert.equal(result.products[0]?.category, 'PRODUCT');
    assert.equal(result.products[0]?.quantityRange?.maxQuantity, 3);
    assert.equal(result.products[1]?.visible, false);
    assert.equal(result.products[1]?.archived, true);
    assert.equal(result.products[1]?.unitPrice, 80);
    assert.equal(bodies.length, 2);
    assert.equal(result.queryCost.estimated, 34);
  });

  it('searches one page with an explicit first and returns cost', async () => {
    const { fetchImpl, bodies } = mockFetch((query, variables) => {
      assert.match(query, /products\(searchTerm: \$searchTerm, first: \$first, after: \$after\)/);
      assert.equal(variables.searchTerm, '25GBC');
      assert.equal(variables.first, 10);
      assert.equal(variables.after, 'cursor-1');
      assert.equal(/customFields|lastJobLineItem/.test(query), false);
      return jsonResponse({
        data: {
          products: {
            nodes: [productData()],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
          },
        },
      });
    });

    const result = await getProducts(
      parseGetProductsArgs({ query: '25GBC', first: 10, after: 'cursor-1' }),
      { ...depsEnv, fetchImpl }
    );
    assert.equal(result.matchedBy, 'search');
    assert.equal(result.products[0]?.id, 'prod-25gbc');
    assert.equal(result.products[0]?.internalUnitCost, 410);
    assert.deepEqual(result.pageInfo, { hasNextPage: true, endCursor: 'cursor-2' });
    assert.equal(result.queryCost.first, 10);
    assert.equal(bodies.length, 1);
    const sent = JSON.parse(bodies[0] || '{}') as { variables?: { first?: number } };
    assert.equal(sent.variables?.first, 10);
  });

  it('defaults first when a search omits it', () => {
    const parsed = parseGetProductsArgs({ query: 'pump' });
    assert.equal(parsed.first, GET_PRODUCTS_DEFAULT_FIRST);
    assert.equal(parsed.query, 'pump');
  });

  it('rejects a page size that would climb toward the cost cap', () => {
    assert.throws(() => parseGetProductsArgs({ query: 'pump', first: 51 }), /1 to 50/);
    assert.throws(() => parseGetProductsArgs({ query: 'pump', first: 0 }), /1 to 50/);
    assert.throws(() => parseGetProductsArgs({ query: 'pump', first: 1.5 }), /integer/);
  });

  it('rejects mixing ids with a search, and unknown arguments', () => {
    assert.throws(() => parseGetProductsArgs({ ids: ['prod-1'], query: 'pump' }), /not both/);
    assert.throws(() => parseGetProductsArgs({ ids: ['prod-1'], first: 10 }), /only used with query/);
    assert.throws(() => parseGetProductsArgs({}), /needs ids/);
    assert.throws(() => parseGetProductsArgs({ includeCost: true }), /does not accept includeCost/);
  });

  it('surfaces GraphQL errors instead of an empty product list', async () => {
    const { fetchImpl } = mockFetch(() =>
      jsonResponse({ errors: [{ message: "Cannot query field 'unitPrice' on type 'ProductOrService'" }] })
    );
    await assert.rejects(
      () => getProducts(parseGetProductsArgs({ productId: 'prod-1' }), { ...depsEnv, fetchImpl }),
      /unitPrice/
    );
  });

  it('backs off on Throttled and does not retry a query over the maximum', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const { fetchImpl } = mockFetch(() => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse({
          errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
          extensions: {
            cost: {
              requestedQueryCost: 20,
              throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 0, restoreRate: 500 },
            },
          },
        });
      }
      return jsonResponse({ data: { product: productData() } });
    });
    const result = await getProducts(parseGetProductsArgs({ id: 'prod-25gbc' }), {
      ...depsEnv,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(result.products[0]?.id, 'prod-25gbc');
    assert.equal(calls, 2);
    assert.equal(sleeps[0], 1000);

    let overCapCalls = 0;
    const over = mockFetch(() => {
      overCapCalls += 1;
      return jsonResponse({
        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
        extensions: {
          cost: {
            requestedQueryCost: 10001,
            throttleStatus: { maximumAvailable: 10000, currentlyAvailable: 10000, restoreRate: 500 },
          },
        },
      });
    });
    await assert.rejects(
      () =>
        getProducts(parseGetProductsArgs({ id: 'prod-25gbc' }), {
          ...depsEnv,
          fetchImpl: over.fetchImpl,
          sleep: async () => {
            throw new Error('should not sleep');
          },
        }),
      /Throttled/
    );
    assert.equal(overCapCalls, 1);
  });

  it('retries HTTP 429 with the same backoff and then returns the product', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({}, 429);
      return jsonResponse({ data: { product: productData() } });
    };
    const result = await getProducts(parseGetProductsArgs({ id: 'prod-25gbc' }), {
      ...depsEnv,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    assert.equal(calls, 2);
    assert.equal(sleeps[0], 1000);
    assert.equal(result.products[0]?.internalUnitCost, 410);
  });
});

describe('editProduct', () => {
  it('rejects every field outside the allow-list before calling Jobber', () => {
    for (const extra of [
      { name: 'Renamed' },
      { description: 'nope' },
      { taxable: false },
      { category: 'SERVICE' },
      { defaultUnitCost: 10 },
      { delete: true },
      { archived: true },
      { customFields: [] },
      { onlineBookingsEnabled: true },
    ]) {
      assert.throws(
        () => parseEditProductArgs({ productId: 'prod-25gbc', unitPrice: 900, ...extra }),
        /Rejected:/
      );
    }
    assert.throws(() => parseEditProductArgs({ productId: 'prod-25gbc' }), /needs internalUnitCost/);
    assert.throws(() => parseEditProductArgs({ productId: 'a,b', visible: false }), /one product/);
    assert.throws(() => parseEditProductArgs({ productId: 'prod-25gbc', unitPrice: '900' }), /finite number/);
    assert.throws(() => parseEditProductArgs({ productId: 'prod-25gbc', visible: 'false' }), /boolean/);
  });

  it('dryRun returns before and projected after and does not mutate', async () => {
    const { fetchImpl, bodies } = mockFetch((query) => {
      assert.equal(/mutation|productsAndServicesEdit/.test(query), false);
      return jsonResponse({ data: { product: productData() } });
    });
    const result = await editProduct(
      parseEditProductArgs({
        productId: 'prod-25gbc',
        internalUnitCost: 425,
        unitPrice: 950,
        visible: false,
        dryRun: true,
      }),
      { ...depsEnv, fetchImpl }
    );
    assert.equal(result.dryRun, true);
    assert.equal(result.mutated, false);
    assert.equal(result.before.internalUnitCost, 410);
    assert.equal(result.before.unitPrice, 899);
    assert.equal(result.before.visible, true);
    assert.equal(result.after.internalUnitCost, 425);
    assert.equal(result.after.unitPrice, 950);
    assert.equal(result.after.defaultUnitCost, 950);
    assert.equal(result.after.visible, false);
    assert.equal(result.after.archived, true);
    assert.equal(result.after.name, 'Goulds 25GBC');
    assert.deepEqual(
      result.changes.map((change) => change.field),
      ['internalUnitCost', 'unitPrice', 'visible']
    );
    assert.equal(bodies.length, 1);
    assert.equal(result.userErrors.length, 0);
  });

  it('edits one product, maps unitPrice to defaultUnitCost, and re-reads after', async () => {
    const seen: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const { fetchImpl } = mockFetch((query, variables) => {
      seen.push({ query, variables });
      if (query.includes('productsAndServicesEdit')) {
        assert.equal(/productsAndServicesDelete|productDelete|delete/.test(query), false);
        return jsonResponse({
          data: {
            productsAndServicesEdit: {
              productOrService: { id: 'prod-25gbc' },
              userErrors: [],
            },
          },
        });
      }
      const readIndex = seen.filter((call) => call.query.includes('McpProductById')).length;
      if (readIndex === 1) return jsonResponse({ data: { product: productData() } });
      return jsonResponse({
        data: {
          product: productData({
            internalUnitCost: 425,
            defaultUnitCost: 950,
            markup: 123.529,
            visible: false,
          }),
        },
      });
    });

    const result = await editProduct(
      parseEditProductArgs({
        productId: 'prod-25gbc',
        internalUnitCost: 425,
        unitPrice: 950,
        markup: 123.529,
        visible: false,
      }),
      { ...depsEnv, fetchImpl }
    );

    assert.equal(seen.length, 3);
    assert.match(seen[0]?.query || '', /McpProductById/);
    assert.match(seen[1]?.query || '', /productsAndServicesEdit/);
    assert.match(seen[2]?.query || '', /McpProductById/);
    assert.deepEqual(seen[1]?.variables, {
      productOrServiceId: 'prod-25gbc',
      input: {
        internalUnitCost: 425,
        defaultUnitCost: 950,
        markup: 123.529,
        visible: false,
      },
    });
    assert.equal('unitPrice' in ((seen[1]?.variables.input as object) || {}), false);
    assert.equal(result.mutated, true);
    assert.equal(result.dryRun, false);
    assert.equal(result.before.unitPrice, 899);
    assert.equal(result.before.internalUnitCost, 410);
    assert.equal(result.before.visible, true);
    assert.equal(result.after.unitPrice, 950);
    assert.equal(result.after.defaultUnitCost, 950);
    assert.equal(result.after.internalUnitCost, 425);
    assert.equal(result.after.markup, 123.529);
    assert.equal(result.after.visible, false);
    assert.equal(result.after.archived, true);
    assert.equal(result.userErrors.length, 0);
  });

  it('skips the mutation when the catalog already matches', async () => {
    const { fetchImpl, bodies } = mockFetch(() => jsonResponse({ data: { product: productData() } }));
    const result = await editProduct(
      parseEditProductArgs({ productId: 'prod-25gbc', unitPrice: 899, internalUnitCost: 410 }),
      { ...depsEnv, fetchImpl }
    );
    assert.equal(result.mutated, false);
    assert.equal(result.changes.length, 0);
    assert.equal(result.after.unitPrice, result.before.unitPrice);
    assert.equal(bodies.length, 1);
    assert.equal(/productsAndServicesEdit/.test(bodies[0] || ''), false);
  });

  it('surfaces userErrors and does not treat the edit as applied', async () => {
    let reads = 0;
    const { fetchImpl } = mockFetch((query) => {
      if (query.includes('productsAndServicesEdit')) {
        return jsonResponse({
          data: {
            productsAndServicesEdit: {
              productOrService: null,
              userErrors: [{ message: 'Markup must be positive', path: ['input', 'markup'] }],
            },
          },
        });
      }
      reads += 1;
      return jsonResponse({ data: { product: productData() } });
    });

    await assert.rejects(
      () => editProduct(parseEditProductArgs({ productId: 'prod-25gbc', markup: -1 }), { ...depsEnv, fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof ProductEditUserError);
        assert.match(error.message, /productsAndServicesEdit userErrors: Markup must be positive \(input\.markup\)/);
        assert.equal(error.before.internalUnitCost, 410);
        assert.equal(error.userErrors[0]?.path.join('.'), 'input.markup');
        return true;
      }
    );
    assert.equal(reads, 1);
  });

  it('sends only the changed allow-listed GraphQL fields', () => {
    const before = mapJobberProductDetail(productData());
    assert.ok(before);
    const input = {
      productId: 'prod-25gbc',
      markup: 50,
      visible: false,
      dryRun: false,
    };
    assert.deepEqual(buildProductEditInput(input, [
      { field: 'markup', before: before.markup, after: 50 },
      { field: 'visible', before: true, after: false },
    ]), { markup: 50, visible: false });
  });
});

describe('MCP get_products and edit_product', () => {
  it('returns cost through the tool and rejects a disallowed edit', async () => {
    const { fetchImpl } = mockFetch((query) => {
      if (!query.includes('McpProductById')) return jsonResponse({ data: {} });
      return jsonResponse({ data: { product: productData() } });
    });
    const found = await callJobberMcpTool(
      'get_products',
      { productId: 'prod-25gbc' },
      { ...depsEnv, fetchImpl }
    );
    assert.equal(found.isError, undefined);
    const payload = JSON.parse(found.content[0].text) as {
      products: Array<{ unitPrice: number; internalUnitCost: number; markup: number; visible: boolean }>;
    };
    assert.equal(payload.products[0]?.unitPrice, 899);
    assert.equal(payload.products[0]?.internalUnitCost, 410);
    assert.equal(payload.products[0]?.markup, 119.268);
    assert.equal(payload.products[0]?.visible, true);

    const rejected = await callJobberMcpTool(
      'edit_product',
      { productId: 'prod-25gbc', name: 'Nope', unitPrice: 1 },
      { ...depsEnv, fetchImpl }
    );
    assert.equal(rejected.isError, true);
    assert.match(rejected.content[0].text, /Rejected: name/);
  });

  it('dryRun and a real edit both return before and after', async () => {
    const dry = mockFetch((query) => {
      assert.equal(query.includes('productsAndServicesEdit'), false);
      return jsonResponse({ data: { product: productData() } });
    });
    const dryResult = await callJobberMcpTool(
      'edit_product',
      { productId: 'prod-25gbc', unitPrice: 1000, dryRun: true },
      { ...depsEnv, fetchImpl: dry.fetchImpl }
    );
    assert.equal(dryResult.isError, undefined);
    const dryPayload = JSON.parse(dryResult.content[0].text) as {
      dryRun: boolean;
      mutated: boolean;
      before: { unitPrice: number };
      after: { unitPrice: number };
    };
    assert.equal(dryPayload.dryRun, true);
    assert.equal(dryPayload.mutated, false);
    assert.equal(dryPayload.before.unitPrice, 899);
    assert.equal(dryPayload.after.unitPrice, 1000);
    assert.equal(dry.bodies.length, 1);

    let phase = 0;
    const live = mockFetch((query, variables) => {
      if (query.includes('productsAndServicesEdit')) {
        assert.deepEqual(variables.input, { defaultUnitCost: 1000 });
        return jsonResponse({
          data: { productsAndServicesEdit: { productOrService: { id: 'prod-25gbc' }, userErrors: [] } },
        });
      }
      phase += 1;
      return jsonResponse({
        data: { product: productData(phase === 1 ? {} : { defaultUnitCost: 1000 }) },
      });
    });
    const edited = await callJobberMcpTool(
      'edit_product',
      { productId: 'prod-25gbc', unitPrice: 1000 },
      { ...depsEnv, fetchImpl: live.fetchImpl }
    );
    assert.equal(edited.isError, undefined);
    const editedPayload = JSON.parse(edited.content[0].text) as {
      mutated: boolean;
      before: { unitPrice: number; internalUnitCost: number };
      after: { unitPrice: number };
    };
    assert.equal(editedPayload.mutated, true);
    assert.equal(editedPayload.before.unitPrice, 899);
    assert.equal(editedPayload.before.internalUnitCost, 410);
    assert.equal(editedPayload.after.unitPrice, 1000);

    const failed = mockFetch((query) => {
      if (query.includes('productsAndServicesEdit')) {
        return jsonResponse({
          data: {
            productsAndServicesEdit: {
              productOrService: null,
              userErrors: [{ message: 'Visible cannot be cleared', path: ['input', 'visible'] }],
            },
          },
        });
      }
      return jsonResponse({ data: { product: productData() } });
    });
    const errorResult = await callJobberMcpTool(
      'edit_product',
      { productId: 'prod-25gbc', visible: false },
      { ...depsEnv, fetchImpl: failed.fetchImpl }
    );
    assert.equal(errorResult.isError, true);
    const errorPayload = JSON.parse(errorResult.content[0].text) as {
      error: string;
      mutated: boolean;
      before: { visible: boolean };
      userErrors: Array<{ message: string }>;
    };
    assert.match(errorPayload.error, /Visible cannot be cleared/);
    assert.equal(errorPayload.mutated, false);
    assert.equal(errorPayload.before.visible, true);
    assert.equal(errorPayload.userErrors[0]?.message, 'Visible cannot be cleared');
  });
});
