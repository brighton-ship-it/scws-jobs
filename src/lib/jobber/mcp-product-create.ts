/**
 * Catalog create + full-catalog page read for the MCP gateway.
 *
 * - Mutation.productsAndServicesCreate(input: ProductsAndServicesInput!) returns
 *   { productOrService { id } userErrors { message path } } (same payload shape as Edit).
 *   ProductsAndServicesInput requires name and defaultUnitCost. This module sends
 *   only name, description, defaultUnitCost, internalUnitCost, taxable, category.
 * - create_products is batch (max 25), defaults to dryRun, and skips any item whose
 *   normalized name already exists in the catalog, or whose sku appears in an existing
 *   product name or description. Each created row is re-read by id to verify.
 * - list_products pages products(first, after) with no searchTerm for backups.
 * There is no delete.
 */
import { JOBBER_MAX_QUERY_COST } from '../receptionist/jobber-throttle.ts';
import {
  PRODUCT_FIELDS,
  mapJobberProductDetail,
  productGraphql,
  productSearchQueryCost,
  readProduct,
  type JobberProductDetail,
  type ProductToolDeps,
} from './mcp-products.ts';

export const CREATE_PRODUCTS_MAX = 25;
export const LIST_PRODUCTS_MAX_FIRST = 50;

const PRODUCTS_ALL_PAGE = `
  query McpProductsAllPage($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      nodes {${PRODUCT_FIELDS}      }
      pageInfo { hasNextPage endCursor }
      totalCount
    }
  }
`;

const PRODUCTS_SEARCH_LITE = `
  query McpProductsDedupe($searchTerm: String, $first: Int!) {
    products(searchTerm: $searchTerm, first: $first) {
      nodes { id name description visible }
    }
  }
`;

const PRODUCT_CREATE = `
  mutation McpProductsAndServicesCreate($input: ProductsAndServicesInput!) {
    productsAndServicesCreate(input: $input) {
      productOrService { id }
      userErrors { message path }
    }
  }
`;

export type CreateProductItem = {
  name: string;
  description: string | null;
  unitPrice: number;
  internalUnitCost: number | null;
  taxable: boolean;
  category: 'PRODUCT' | 'SERVICE';
  sku: string | null;
};

export type CreateProductsInput = { items: CreateProductItem[]; dryRun: boolean };

export type CreateProductOutcome = {
  name: string;
  status: 'created' | 'would_create' | 'skipped_exists' | 'skipped_duplicate_in_batch' | 'failed';
  productId: string | null;
  matched?: { id: string; name: string | null; visible: boolean | null }[];
  product?: JobberProductDetail | null;
  input?: Record<string, unknown>;
  error?: string;
};

const ITEM_KEYS = new Set(['name', 'description', 'unitPrice', 'internalUnitCost', 'taxable', 'category', 'sku']);

export function normalizeProductKey(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function parseCreateProductsArgs(args: Record<string, unknown>): CreateProductsInput {
  const extra = Object.keys(args).filter((key) => key !== 'items' && key !== 'dryRun');
  if (extra.length) throw new Error(`create_products does not accept ${extra.join(', ')}.`);
  if (!Array.isArray(args.items) || !args.items.length) throw new Error('items must be a non-empty array');
  if (args.items.length > CREATE_PRODUCTS_MAX) {
    throw new Error(`create_products accepts at most ${CREATE_PRODUCTS_MAX} items per call.`);
  }
  if ('dryRun' in args && args.dryRun != null && typeof args.dryRun !== 'boolean') {
    throw new Error('dryRun must be a boolean');
  }
  const items = args.items.map((raw, index): CreateProductItem => {
    if (!raw || typeof raw !== 'object') throw new Error(`items[${index}] must be an object`);
    const row = raw as Record<string, unknown>;
    const bad = Object.keys(row).filter((key) => !ITEM_KEYS.has(key));
    if (bad.length) throw new Error(`items[${index}] does not accept ${bad.join(', ')}`);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) throw new Error(`items[${index}].name is required`);
    if (typeof row.unitPrice !== 'number' || !Number.isFinite(row.unitPrice) || row.unitPrice < 0) {
      throw new Error(`items[${index}].unitPrice must be a number >= 0`);
    }
    let cost: number | null = null;
    if (row.internalUnitCost != null) {
      if (typeof row.internalUnitCost !== 'number' || !Number.isFinite(row.internalUnitCost) || row.internalUnitCost < 0) {
        throw new Error(`items[${index}].internalUnitCost must be a number >= 0`);
      }
      cost = row.internalUnitCost;
    }
    const category = row.category == null ? 'PRODUCT' : row.category;
    if (category !== 'PRODUCT' && category !== 'SERVICE') {
      throw new Error(`items[${index}].category must be PRODUCT or SERVICE`);
    }
    if (row.taxable != null && typeof row.taxable !== 'boolean') throw new Error(`items[${index}].taxable must be a boolean`);
    return {
      name,
      description: typeof row.description === 'string' && row.description.trim() ? row.description.trim() : null,
      unitPrice: row.unitPrice,
      internalUnitCost: cost,
      taxable: row.taxable == null ? category === 'PRODUCT' : (row.taxable as boolean),
      category,
      sku: typeof row.sku === 'string' && row.sku.trim() ? row.sku.trim() : null,
    };
  });
  return { items, dryRun: args.dryRun !== false };
}

export function buildCreateInput(item: CreateProductItem): Record<string, unknown> {
  const input: Record<string, unknown> = {
    name: item.name,
    defaultUnitCost: item.unitPrice,
    taxable: item.taxable,
    category: item.category,
  };
  if (item.description) input.description = item.description;
  if (item.internalUnitCost != null) input.internalUnitCost = item.internalUnitCost;
  return input;
}

async function findExisting(item: CreateProductItem, deps?: ProductToolDeps) {
  const terms = [item.name];
  if (item.sku) terms.push(item.sku);
  const nameKey = normalizeProductKey(item.name);
  const skuKey = normalizeProductKey(item.sku);
  const hits = new Map<string, { id: string; name: string | null; visible: boolean | null }>();
  for (const term of terms) {
    const result = await productGraphql(PRODUCTS_SEARCH_LITE, { searchTerm: term, first: 50 }, 'products', deps);
    const nodes = ((result.data?.products as { nodes?: unknown[] } | null)?.nodes || []) as Record<string, unknown>[];
    for (const node of nodes) {
      const id = typeof node.id === 'string' ? node.id : '';
      const name = typeof node.name === 'string' ? node.name : null;
      const description = typeof node.description === 'string' ? node.description : null;
      const sameName = normalizeProductKey(name) === nameKey;
      const skuHit =
        skuKey.length >= 4 &&
        (normalizeProductKey(name).includes(skuKey) || normalizeProductKey(description).includes(skuKey));
      if (id && (sameName || skuHit)) hits.set(id, { id, name, visible: typeof node.visible === 'boolean' ? node.visible : null });
    }
  }
  return Array.from(hits.values());
}

export async function createProducts(input: CreateProductsInput, deps?: ProductToolDeps): Promise<CreateProductOutcome[]> {
  const out: CreateProductOutcome[] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    const key = normalizeProductKey(item.name);
    if (seen.has(key)) {
      out.push({ name: item.name, status: 'skipped_duplicate_in_batch', productId: null });
      continue;
    }
    seen.add(key);
    try {
      const matched = await findExisting(item, deps);
      if (matched.length) {
        out.push({ name: item.name, status: 'skipped_exists', productId: matched[0].id, matched });
        continue;
      }
      const attributes = buildCreateInput(item);
      if (input.dryRun) {
        out.push({ name: item.name, status: 'would_create', productId: null, input: attributes });
        continue;
      }
      const created = await productGraphql(PRODUCT_CREATE, { input: attributes }, 'productsAndServicesCreate', deps);
      const payload = created.data?.productsAndServicesCreate as
        | { productOrService?: { id?: string } | null; userErrors?: { message?: string }[] }
        | null
        | undefined;
      const errors = (payload?.userErrors || []).map((e) => e?.message || 'error').filter(Boolean);
      const id = payload?.productOrService?.id;
      if (errors.length || !id) {
        out.push({ name: item.name, status: 'failed', productId: id || null, error: errors.join('; ') || 'no id returned', input: attributes });
        continue;
      }
      const product = await readProduct(id, deps);
      out.push({ name: item.name, status: 'created', productId: id, product });
    } catch (error) {
      out.push({ name: item.name, status: 'failed', productId: null, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return out;
}

export function parseListProductsArgs(args: Record<string, unknown>): { first: number; after: string | null } {
  const extra = Object.keys(args).filter((key) => key !== 'first' && key !== 'after');
  if (extra.length) throw new Error(`list_products does not accept ${extra.join(', ')}.`);
  const first = args.first == null ? LIST_PRODUCTS_MAX_FIRST : args.first;
  if (typeof first !== 'number' || !Number.isInteger(first) || first < 1 || first > LIST_PRODUCTS_MAX_FIRST) {
    throw new Error(`first must be an integer from 1 to ${LIST_PRODUCTS_MAX_FIRST}`);
  }
  const after = typeof args.after === 'string' && args.after.trim() ? args.after.trim() : null;
  return { first, after };
}

export async function listProductsPage(input: { first: number; after: string | null }, deps?: ProductToolDeps) {
  const variables: Record<string, unknown> = { first: input.first };
  if (input.after) variables.after = input.after;
  const result = await productGraphql(PRODUCTS_ALL_PAGE, variables, 'products', deps);
  const connection = result.data?.products as {
    nodes?: unknown[] | null;
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
    totalCount?: number | null;
  } | null;
  const products = (connection?.nodes || [])
    .map((node) => mapJobberProductDetail(node))
    .filter((node): node is JobberProductDetail => Boolean(node));
  return {
    products,
    totalCount: typeof connection?.totalCount === 'number' ? connection.totalCount : null,
    pageInfo: {
      hasNextPage: connection?.pageInfo?.hasNextPage === true,
      endCursor: connection?.pageInfo?.endCursor || null,
    },
    queryCost: { estimated: productSearchQueryCost(input.first) + 1, maximum: JOBBER_MAX_QUERY_COST },
  };
}
