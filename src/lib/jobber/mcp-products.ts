/**
 * Catalog read and one-product edit for the MCP gateway.
 *
 * Schema (public introspection, API version 2025-01-20, hightreequency/jobberschema;
 * gateway pin stays 2025-04-16):
 * - Query.product(id: EncodedId!): ProductOrService!
 * - Query.products(searchTerm, filter, first, after, ...): ProductOrServiceConnection!
 *   The catalog field is `products`, not `productsAndServices`.
 * - ProductOrService cheap scalars: id, name, description, category
 *   (ProductsAndServicesCategory), defaultUnitCost (street/default price — there
 *   is no unitPrice field), internalUnitCost, markup, taxable, visible,
 *   durationMinutes, bookableType, onlineBookingsEnabled, onlineBookingSortOrder,
 *   and quantityRange { minQuantity maxQuantity quantityEnabled }.
 *   customFields and lastJobLineItem are omitted (nested / not cheap).
 * - Mutation.productsAndServicesEdit(productOrServiceId: EncodedId!, input:
 *   ProductsAndServicesEditInput!): EditPayload { productOrService, userErrors }.
 *   The input has defaultUnitCost, not unitPrice. This module maps the tool
 *   argument unitPrice onto defaultUnitCost and rejects every other input field.
 * - There is no product delete mutation on that schema. This module does not
 *   add one. visible: false hides a row from line-item autocomplete.
 * - Jobber has no archived flag. `archived` in the tool payload is true when
 *   visible is false.
 *
 * products(first:) is priced at about one point per selected field per row.
 * first is always sent and capped so one page stays near 900 points, under
 * the 10,000-point maximum. A Throttled GraphQL error backs off and retries.
 * Calls go through jobberGraphql, so an explicit test token never refreshes
 * the durable OAuth row.
 */

import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import type { JobberDeps } from './quotes.ts';
import {
  JOBBER_MAX_QUERY_COST,
  THROTTLE_MAX_ATTEMPTS,
  connectionQueryCost,
  isJobberThrottled,
  throttleBackoffMs,
  type JobberCost,
  type JobberGraphqlPayload,
} from '../receptionist/jobber-throttle.ts';

export const GET_PRODUCTS_DEFAULT_FIRST = 25;
export const GET_PRODUCTS_MAX_FIRST = 50;
export const GET_PRODUCTS_MAX_IDS = 25;

/** Selected ProductOrService fields. Each name is one query-cost point. */
export const PRODUCT_SELECTION_FIELDS = [
  'id',
  'name',
  'description',
  'category',
  'defaultUnitCost',
  'internalUnitCost',
  'markup',
  'taxable',
  'visible',
  'durationMinutes',
  'bookableType',
  'onlineBookingsEnabled',
  'onlineBookingSortOrder',
  'quantityRange',
  'minQuantity',
  'maxQuantity',
  'quantityEnabled',
] as const;

export const PRODUCT_NODE_FIELD_COST = PRODUCT_SELECTION_FIELDS.length;

const PRODUCT_FIELDS = `
          id
          name
          description
          category
          defaultUnitCost
          internalUnitCost
          markup
          taxable
          visible
          durationMinutes
          bookableType
          onlineBookingsEnabled
          onlineBookingSortOrder
          quantityRange { minQuantity maxQuantity quantityEnabled }
`;

const PRODUCT_BY_ID = `
  query McpProductById($id: EncodedId!) {
    product(id: $id) {${PRODUCT_FIELDS}    }
  }
`;

const PRODUCTS_PAGE = `
  query McpProductsPage($searchTerm: String, $first: Int!, $after: String) {
    products(searchTerm: $searchTerm, first: $first, after: $after) {
      nodes {${PRODUCT_FIELDS}      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

const PRODUCT_EDIT = `
  mutation McpProductsAndServicesEdit($productOrServiceId: EncodedId!, $input: ProductsAndServicesEditInput!) {
    productsAndServicesEdit(productOrServiceId: $productOrServiceId, input: $input) {
      productOrService { id }
      userErrors { message path }
    }
  }
`;

/** Tool arguments. unitPrice is sent as GraphQL defaultUnitCost. */
export const PRODUCT_EDIT_FIELDS = ['internalUnitCost', 'unitPrice', 'markup', 'visible'] as const;
export type ProductEditField = (typeof PRODUCT_EDIT_FIELDS)[number];

const PRODUCT_EDIT_ARGUMENT_KEYS = new Set<string>(['productId', 'dryRun', ...PRODUCT_EDIT_FIELDS]);
const GRAPHQL_EDIT_KEYS = new Set(['internalUnitCost', 'defaultUnitCost', 'markup', 'visible']);
const GET_PRODUCT_ARGUMENT_KEYS = new Set(['ids', 'id', 'productId', 'query', 'first', 'after']);

export type ProductToolDeps = JobberDeps & {
  sleep?: (ms: number) => Promise<void>;
};

export type ProductQuantityRange = {
  minQuantity: number | null;
  maxQuantity: number | null;
  quantityEnabled: boolean | null;
};

export type JobberProductDetail = {
  id: string;
  name: string | null;
  description: string | null;
  category: string | null;
  /** Street/default price. Same number as defaultUnitCost. */
  unitPrice: number | null;
  defaultUnitCost: number | null;
  internalUnitCost: number | null;
  markup: number | null;
  taxable: boolean | null;
  visible: boolean | null;
  /** True when visible is false. Not a Jobber field. */
  archived: boolean | null;
  durationMinutes: number | null;
  bookableType: string | null;
  onlineBookingsEnabled: boolean | null;
  onlineBookingSortOrder: number | null;
  quantityRange: ProductQuantityRange | null;
};

export type GetProductsInput = {
  ids: string[];
  query: string | null;
  first: number | null;
  after: string | null;
};

export type GetProductsResult = {
  matchedBy: 'id' | 'search';
  products: JobberProductDetail[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null } | null;
  queryCost: { first: number | null; estimated: number; maximum: number };
};

export type ProductEditInput = {
  productId: string;
  internalUnitCost?: number;
  unitPrice?: number;
  markup?: number;
  visible?: boolean;
  dryRun: boolean;
};

export type ProductFieldChange = {
  field: ProductEditField;
  before: number | boolean | null;
  after: number | boolean | null;
};

export type ProductUserError = {
  message: string;
  path: string[];
};

export type ProductEditResult = {
  productId: string;
  dryRun: boolean;
  mutated: boolean;
  before: JobberProductDetail;
  after: JobberProductDetail;
  changes: ProductFieldChange[];
  userErrors: ProductUserError[];
};

export class ProductEditUserError extends Error {
  readonly userErrors: ProductUserError[];
  readonly before: JobberProductDetail;
  readonly productId: string;

  constructor(userErrors: ProductUserError[], before: JobberProductDetail, productId: string) {
    const detail = userErrors
      .map((error) => (error.path.length ? `${error.message} (${error.path.join('.')})` : error.message))
      .join('; ');
    super(`productsAndServicesEdit userErrors: ${detail}`);
    this.name = 'ProductEditUserError';
    this.userErrors = userErrors;
    this.before = before;
    this.productId = productId;
  }
}

type GraphqlPayload = JobberGraphqlResult & JobberGraphqlPayload & {
  extensions?: { cost?: JobberCost };
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

/** products(first) plus pageInfo. Stays far under JOBBER_MAX_QUERY_COST at the page cap. */
export function productSearchQueryCost(first: number): number {
  return connectionQueryCost(first, PRODUCT_NODE_FIELD_COST) + 4;
}

export function productByIdQueryCost(count = 1): number {
  return PRODUCT_NODE_FIELD_COST * count;
}

function assertPageCost(first: number): number {
  const estimated = productSearchQueryCost(first);
  if (estimated >= 2_000 || estimated >= JOBBER_MAX_QUERY_COST) {
    throw new Error(
      `get_products page of ${first} is about ${estimated} points, over the gateway cap (Jobber maximum is ${JOBBER_MAX_QUERY_COST}).`
    );
  }
  return estimated;
}

function rejectedKeys(args: Record<string, unknown>, allowed: Set<string>): string[] {
  return Object.keys(args).filter((key) => !allowed.has(key));
}

export function parseGetProductsArgs(args: Record<string, unknown>): GetProductsInput {
  const rejected = rejectedKeys(args, GET_PRODUCT_ARGUMENT_KEYS);
  if (rejected.length) {
    throw new Error(`get_products does not accept ${rejected.join(', ')}.`);
  }

  const ids: string[] = [];
  if ('ids' in args && args.ids != null) {
    if (!Array.isArray(args.ids) || !args.ids.length) {
      throw new Error('ids must be a non-empty array of product ids');
    }
    args.ids.forEach((value, index) => {
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`ids[${index}] must be a product id`);
      }
      ids.push(value.trim());
    });
  }
  for (const key of ['id', 'productId'] as const) {
    if (!(key in args) || args[key] == null || args[key] === '') continue;
    if (typeof args[key] !== 'string' || !args[key].trim()) {
      throw new Error(`${key} must be a product id`);
    }
    ids.push(args[key].trim());
  }
  const uniqueIds = [...new Set(ids)];

  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if ('query' in args && args.query != null && typeof args.query !== 'string') {
    throw new Error('query must be a search string');
  }
  if (uniqueIds.length && query) {
    throw new Error('Pass product ids or a search query, not both.');
  }
  if (!uniqueIds.length && !query) {
    throw new Error('get_products needs ids, id, productId, or query.');
  }
  if (uniqueIds.length > GET_PRODUCTS_MAX_IDS) {
    throw new Error(
      `get_products accepts at most ${GET_PRODUCTS_MAX_IDS} ids per call so each product(id) stays under Jobber's cost cap. Got ${uniqueIds.length}.`
    );
  }

  const paging = 'first' in args || ('after' in args && args.after != null && args.after !== '');
  if (uniqueIds.length && paging) {
    throw new Error('first and after are only used with query.');
  }

  let first: number | null = null;
  let after: string | null = null;
  if (query) {
    if (!('first' in args) || args.first == null || args.first === '') {
      first = GET_PRODUCTS_DEFAULT_FIRST;
    } else if (typeof args.first !== 'number' || !Number.isInteger(args.first)) {
      throw new Error(`first must be an integer from 1 to ${GET_PRODUCTS_MAX_FIRST}`);
    } else if (args.first < 1 || args.first > GET_PRODUCTS_MAX_FIRST) {
      throw new Error(
        `first must be from 1 to ${GET_PRODUCTS_MAX_FIRST} so products(first) stays under Jobber's ${JOBBER_MAX_QUERY_COST}-point cap.`
      );
    } else {
      first = args.first;
    }
    if ('after' in args && args.after != null && args.after !== '') {
      if (typeof args.after !== 'string' || !args.after.trim()) {
        throw new Error('after must be a page cursor');
      }
      after = args.after.trim();
    }
    assertPageCost(first);
  }

  return { ids: uniqueIds, query: query || null, first, after };
}

function finiteNumber(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

export function parseEditProductArgs(args: Record<string, unknown>): ProductEditInput {
  const rejected = rejectedKeys(args, PRODUCT_EDIT_ARGUMENT_KEYS);
  if (rejected.length) {
    throw new Error(
      `edit_product only accepts productId, internalUnitCost, unitPrice, markup, visible, and dryRun. Rejected: ${rejected.join(', ')}.`
    );
  }
  if (typeof args.productId !== 'string' || !args.productId.trim()) {
    throw new Error('productId is required');
  }
  const productId = args.productId.trim();
  if (productId.includes(',')) {
    throw new Error('edit_product updates one product per call');
  }

  const edit: ProductEditInput = { productId, dryRun: false };
  if ('dryRun' in args && args.dryRun != null) {
    if (typeof args.dryRun !== 'boolean') throw new Error('dryRun must be a boolean');
    edit.dryRun = args.dryRun;
  }

  let fields = 0;
  if ('internalUnitCost' in args) {
    edit.internalUnitCost = finiteNumber(args.internalUnitCost, 'internalUnitCost');
    fields += 1;
  }
  if ('unitPrice' in args) {
    edit.unitPrice = finiteNumber(args.unitPrice, 'unitPrice');
    fields += 1;
  }
  if ('markup' in args) {
    edit.markup = finiteNumber(args.markup, 'markup');
    fields += 1;
  }
  if ('visible' in args) {
    if (typeof args.visible !== 'boolean') throw new Error('visible must be a boolean');
    edit.visible = args.visible;
    fields += 1;
  }
  if (!fields) {
    throw new Error('edit_product needs internalUnitCost, unitPrice, markup, or visible.');
  }
  return edit;
}

/** GraphQL ProductsAndServicesEditInput. unitPrice is defaultUnitCost. Only changed keys are sent. */
export function buildProductEditInput(
  edit: ProductEditInput,
  changes: ProductFieldChange[]
): Record<string, unknown> {
  const changed = new Set(changes.map((change) => change.field));
  const input: Record<string, unknown> = {};
  if (changed.has('internalUnitCost')) input.internalUnitCost = edit.internalUnitCost;
  if (changed.has('unitPrice')) input.defaultUnitCost = edit.unitPrice;
  if (changed.has('markup')) input.markup = edit.markup;
  if (changed.has('visible')) input.visible = edit.visible;
  for (const key of Object.keys(input)) {
    if (!GRAPHQL_EDIT_KEYS.has(key)) {
      throw new Error(`Refusing to send ${key} to productsAndServicesEdit`);
    }
  }
  if ('unitPrice' in input || 'name' in input || 'description' in input || 'delete' in input) {
    throw new Error('Refusing to send a field productsAndServicesEdit does not accept');
  }
  return input;
}

export function mapJobberProductDetail(node: unknown): JobberProductDetail | null {
  if (!node || typeof node !== 'object') return null;
  const row = node as Record<string, unknown>;
  const id = asString(row.id);
  if (!id) return null;
  const defaultUnitCost = asNumber(row.defaultUnitCost);
  const visible = asBoolean(row.visible);
  const range = row.quantityRange;
  let quantityRange: ProductQuantityRange | null = null;
  if (range && typeof range === 'object') {
    const quantity = range as Record<string, unknown>;
    quantityRange = {
      minQuantity: asNumber(quantity.minQuantity),
      maxQuantity: asNumber(quantity.maxQuantity),
      quantityEnabled: asBoolean(quantity.quantityEnabled),
    };
  }
  return {
    id,
    name: asString(row.name),
    description: asString(row.description),
    category: asString(row.category),
    unitPrice: defaultUnitCost,
    defaultUnitCost,
    internalUnitCost: asNumber(row.internalUnitCost),
    markup: asNumber(row.markup),
    taxable: asBoolean(row.taxable),
    visible,
    archived: visible == null ? null : visible === false,
    durationMinutes: asNumber(row.durationMinutes),
    bookableType: asString(row.bookableType),
    onlineBookingsEnabled: asBoolean(row.onlineBookingsEnabled),
    onlineBookingSortOrder: asNumber(row.onlineBookingSortOrder),
    quantityRange,
  };
}

function productChanges(before: JobberProductDetail, edit: ProductEditInput): ProductFieldChange[] {
  const changes: ProductFieldChange[] = [];
  if (edit.internalUnitCost !== undefined && edit.internalUnitCost !== before.internalUnitCost) {
    changes.push({
      field: 'internalUnitCost',
      before: before.internalUnitCost,
      after: edit.internalUnitCost,
    });
  }
  if (edit.unitPrice !== undefined && edit.unitPrice !== before.unitPrice) {
    changes.push({ field: 'unitPrice', before: before.unitPrice, after: edit.unitPrice });
  }
  if (edit.markup !== undefined && edit.markup !== before.markup) {
    changes.push({ field: 'markup', before: before.markup, after: edit.markup });
  }
  if (edit.visible !== undefined && edit.visible !== before.visible) {
    changes.push({ field: 'visible', before: before.visible, after: edit.visible });
  }
  return changes;
}

function projectProduct(before: JobberProductDetail, edit: ProductEditInput): JobberProductDetail {
  const after: JobberProductDetail = {
    ...before,
    quantityRange: before.quantityRange ? { ...before.quantityRange } : null,
  };
  if (edit.internalUnitCost !== undefined) after.internalUnitCost = edit.internalUnitCost;
  if (edit.unitPrice !== undefined) {
    after.unitPrice = edit.unitPrice;
    after.defaultUnitCost = edit.unitPrice;
  }
  if (edit.markup !== undefined) after.markup = edit.markup;
  if (edit.visible !== undefined) {
    after.visible = edit.visible;
    after.archived = edit.visible === false;
  }
  return after;
}

async function graphql(
  query: string,
  variables: Record<string, unknown>,
  operation: string,
  deps?: ProductToolDeps
): Promise<GraphqlPayload> {
  const sleep = deps?.sleep ?? defaultSleep;
  let lastMessage = 'Throttled';

  for (let attempt = 1; attempt <= THROTTLE_MAX_ATTEMPTS; attempt++) {
    let result: GraphqlPayload;
    try {
      result = (await jobberGraphql(query, variables, {
        token: deps?.token,
        fetchImpl: deps?.fetchImpl,
        env: deps?.env,
      })) as GraphqlPayload;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Jobber GraphQL error';
      if (!/HTTP 429\b/.test(message)) throw error;
      lastMessage = 'Throttled';
      if (attempt === THROTTLE_MAX_ATTEMPTS) throw new Error(lastMessage);
      const waitMs = throttleBackoffMs(undefined);
      console.warn(
        `[Jobber MCP] Throttled ${operation} (attempt ${attempt}/${THROTTLE_MAX_ATTEMPTS}, HTTP 429, waitMs=${waitMs})`
      );
      await sleep(waitMs);
      continue;
    }

    if (!isJobberThrottled(result)) {
      assertNoJobberErrors(result, operation);
      return result;
    }

    lastMessage = result.errors?.[0]?.message || 'Throttled';
    const waitMs = throttleBackoffMs(result.extensions?.cost);
    const gaveUp = waitMs < 0 || attempt === THROTTLE_MAX_ATTEMPTS;
    console.warn(
      `[Jobber MCP] Throttled ${operation} (attempt ${attempt}/${THROTTLE_MAX_ATTEMPTS}, ` +
        `requested=${result.extensions?.cost?.requestedQueryCost ?? '?'}, ` +
        `available=${result.extensions?.cost?.throttleStatus?.currentlyAvailable ?? '?'}, ` +
        `waitMs=${gaveUp ? 'none' : waitMs})`
    );
    if (gaveUp) {
      throw new Error(lastMessage);
    }
    await sleep(waitMs);
  }

  throw new Error(lastMessage);
}

async function readProduct(productId: string, deps?: ProductToolDeps): Promise<JobberProductDetail> {
  const result = await graphql(PRODUCT_BY_ID, { id: productId }, 'product', deps);
  const product = mapJobberProductDetail(result.data?.product);
  if (!product) throw new Error(`Product ${productId} was not found`);
  return product;
}

function readUserErrors(payload: unknown): ProductUserError[] {
  if (!payload || typeof payload !== 'object') return [];
  const raw = (payload as { userErrors?: unknown }).userErrors;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw.map((entry) => {
    const row = entry && typeof entry === 'object' ? (entry as { message?: unknown; path?: unknown }) : {};
    const message = typeof row.message === 'string' ? row.message.trim() : '';
    const path = Array.isArray(row.path) ? row.path.map((part) => String(part)) : [];
    return { message: message || 'Jobber rejected the edit', path };
  });
}

export async function getProducts(input: GetProductsInput, deps?: ProductToolDeps): Promise<GetProductsResult> {
  if (input.ids.length && input.query) {
    throw new Error('Pass product ids or a search query, not both.');
  }
  if (input.ids.length) {
    if (input.ids.length > GET_PRODUCTS_MAX_IDS) {
      throw new Error(`get_products accepts at most ${GET_PRODUCTS_MAX_IDS} ids per call.`);
    }
    const products: JobberProductDetail[] = [];
    for (const id of input.ids) {
      products.push(await readProduct(id, deps));
    }
    return {
      matchedBy: 'id',
      products,
      pageInfo: null,
      queryCost: {
        first: null,
        estimated: productByIdQueryCost(input.ids.length),
        maximum: JOBBER_MAX_QUERY_COST,
      },
    };
  }

  const term = input.query?.trim() || '';
  if (!term) throw new Error('get_products needs ids, id, productId, or query.');
  const first = input.first ?? GET_PRODUCTS_DEFAULT_FIRST;
  if (!Number.isInteger(first) || first < 1 || first > GET_PRODUCTS_MAX_FIRST) {
    throw new Error(`first must be from 1 to ${GET_PRODUCTS_MAX_FIRST}`);
  }
  const estimated = assertPageCost(first);
  const variables: Record<string, unknown> = { searchTerm: term, first };
  if (input.after) variables.after = input.after;
  const result = await graphql(PRODUCTS_PAGE, variables, 'products', deps);
  const connection = result.data?.products as {
    nodes?: unknown[] | null;
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
  } | null;
  const products = (connection?.nodes || [])
    .map((node) => mapJobberProductDetail(node))
    .filter((node): node is JobberProductDetail => Boolean(node));
  return {
    matchedBy: 'search',
    products,
    pageInfo: {
      hasNextPage: connection?.pageInfo?.hasNextPage === true,
      endCursor: asString(connection?.pageInfo?.endCursor),
    },
    queryCost: { first, estimated, maximum: JOBBER_MAX_QUERY_COST },
  };
}

export async function editProduct(input: ProductEditInput, deps?: ProductToolDeps): Promise<ProductEditResult> {
  const before = await readProduct(input.productId, deps);
  const changes = productChanges(before, input);
  if (input.dryRun || !changes.length) {
    return {
      productId: input.productId,
      dryRun: input.dryRun,
      mutated: false,
      before,
      after: input.dryRun ? projectProduct(before, input) : before,
      changes,
      userErrors: [],
    };
  }

  const attributes = buildProductEditInput(input, changes);
  const edited = await graphql(
    PRODUCT_EDIT,
    { productOrServiceId: input.productId, input: attributes },
    'productsAndServicesEdit',
    deps
  );
  const payload = edited.data?.productsAndServicesEdit as { userErrors?: unknown } | null | undefined;
  const userErrors = readUserErrors(payload);
  if (userErrors.length) {
    throw new ProductEditUserError(userErrors, before, input.productId);
  }

  const after = await readProduct(input.productId, deps);
  return {
    productId: input.productId,
    dryRun: false,
    mutated: true,
    before,
    after,
    changes,
    userErrors: [],
  };
}
