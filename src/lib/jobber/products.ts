/**
 * Jobber product & service catalog reads for API version 2025-04-16.
 *
 * The Query field is `products(searchTerm, first, after)`, not
 * `productsAndServices`. ProductOrService.category is the
 * ProductsAndServicesCategory enum (a scalar), not an object.
 * GraphQL errors propagate; an empty server search falls back to paging
 * the catalog and matching name/description locally.
 */

import { assertNoJobberErrors, jobberGraphql } from './client.ts';

export const PRODUCT_PAGE_SIZE = 100;
export const PRODUCT_MAX_PAGES = 20;

export type ProductQueryDeps = {
  fetchImpl?: typeof fetch;
  token?: string | null;
  env?: NodeJS.ProcessEnv;
};

/** Public catalog row. internalUnitCost is only set for GP cost lookup. */
export type JobberCatalogProduct = {
  id: string;
  name: string | null;
  description: string | null;
  defaultUnitCost: number | null;
  taxable: boolean | null;
  category: string | null;
  internalUnitCost?: number | null;
};

export type ProductSearchMatch = 'search' | 'catalog';

export type ProductSearchResult = {
  products: JobberCatalogProduct[];
  matchedBy: ProductSearchMatch;
  truncated: boolean;
};

export type ProductCatalogCache = {
  nodes?: JobberCatalogProduct[];
  truncated?: boolean;
};

type ProductPage = {
  nodes?: Array<Record<string, unknown> | null> | null;
  pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: ProductQueryDeps) {
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

function productsQuery(mode: 'search' | 'page', includeInternalCost: boolean): string {
  const args =
    mode === 'search'
      ? '$searchTerm: String!, $first: Int!, $after: String'
      : '$first: Int!, $after: String';
  const call =
    mode === 'search'
      ? 'searchTerm: $searchTerm, first: $first, after: $after'
      : 'first: $first, after: $after';
  const cost = includeInternalCost ? '\n          internalUnitCost' : '';
  const name = mode === 'search' ? 'JobberProductsSearch' : 'JobberProductsPage';
  return `
    query ${name}(${args}) {
      products(${call}) {
        nodes {
          id
          name
          description
          defaultUnitCost
          taxable
          category${cost}
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function mapJobberCatalogProduct(
  node: unknown,
  includeInternalCost: boolean
): JobberCatalogProduct | null {
  if (!node || typeof node !== 'object') return null;
  const row = node as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;
  const product: JobberCatalogProduct = {
    id,
    name: asString(row.name),
    description: asString(row.description),
    defaultUnitCost: asNumber(row.defaultUnitCost),
    taxable: typeof row.taxable === 'boolean' ? row.taxable : null,
    category: asString(row.category),
  };
  if (includeInternalCost) {
    product.internalUnitCost = asNumber(row.internalUnitCost);
  }
  return product;
}

export function productMatchesQuery(
  product: { name?: string | null; description?: string | null },
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return `${product.name || ''}\n${product.description || ''}`.toLowerCase().includes(needle);
}

async function pageProducts(
  mode: 'search' | 'page',
  searchTerm: string | null,
  includeInternalCost: boolean,
  deps?: ProductQueryDeps
): Promise<{ nodes: JobberCatalogProduct[]; truncated: boolean }> {
  const nodes: JobberCatalogProduct[] = [];
  let after: string | null = null;

  for (let page = 0; page < PRODUCT_MAX_PAGES; page++) {
    const variables: Record<string, unknown> = { first: PRODUCT_PAGE_SIZE };
    if (mode === 'search') variables.searchTerm = searchTerm;
    if (after) variables.after = after;

    const result = await graphql(productsQuery(mode, includeInternalCost), variables, deps);
    assertNoJobberErrors(result, 'products');

    const connection = result.data?.products as ProductPage | null | undefined;
    for (const node of connection?.nodes || []) {
      const mapped = mapJobberCatalogProduct(node, includeInternalCost);
      if (mapped) nodes.push(mapped);
    }

    const endCursor =
      typeof connection?.pageInfo?.endCursor === 'string' ? connection.pageInfo.endCursor : null;
    if (!connection?.pageInfo?.hasNextPage || !endCursor || endCursor === after) {
      return { nodes, truncated: false };
    }
    after = endCursor;
  }

  return { nodes, truncated: true };
}

export async function searchJobberProducts(
  searchTerm: string,
  deps?: ProductQueryDeps,
  options?: {
    includeInternalCost?: boolean;
    catalogCache?: ProductCatalogCache;
  }
): Promise<ProductSearchResult> {
  const term = searchTerm.trim();
  if (!term) return { products: [], matchedBy: 'search', truncated: false };

  const includeInternalCost = options?.includeInternalCost === true;
  const searched = await pageProducts('search', term, includeInternalCost, deps);
  if (searched.nodes.length) {
    return { products: searched.nodes, matchedBy: 'search', truncated: searched.truncated };
  }

  let catalog = options?.catalogCache?.nodes;
  let truncated = options?.catalogCache?.truncated ?? false;
  if (!catalog) {
    const paged = await pageProducts('page', null, includeInternalCost, deps);
    catalog = paged.nodes;
    truncated = paged.truncated;
    if (options?.catalogCache) {
      options.catalogCache.nodes = catalog;
      options.catalogCache.truncated = truncated;
    }
  }

  return {
    products: catalog.filter((node) => productMatchesQuery(node, term)),
    matchedBy: 'catalog',
    truncated,
  };
}
