/**
 * Live Jobber quote pages for the internal GP tracker.
 * Read-only. Does not create, send, or edit quotes.
 *
 * Costing is the same FLAG path: line unitCost, linked product
 * internalUnitCost, then vendor nets / catalog book in this repo.
 * Never invent mud $95/ft or tank $10,738.
 */

import { assignShop } from './shops.ts';
import {
  assertNoJobberErrors,
  jobberGraphql,
  type JobberGraphqlResult,
} from './client.ts';
import {
  fetchProductCosts,
  type JobberAddress,
  type JobberDeps,
} from './quotes.ts';
import type { JobberProductCost } from './gross-profit.ts';
import type { QuoteLineDraft } from './shop-book.ts';
import { scoreQuoteGrossProfit, summarizeQuoteGpScores } from './quote-gp-score.ts';
import type { QuotesPageInfo, TrackedQuote } from './quote-gp-types.ts';

export type { QuotesPageInfo, TrackedQuote } from './quote-gp-types.ts';
export { quoteMatchesSearch } from './quote-gp-types.ts';

export const QUOTES_GP_PAGE_SIZE = 25;
export const QUOTES_GP_MAX_PAGE_SIZE = 50;

const LINE_FIELDS_WITH_COST = `
  name
  description
  quantity
  unitPrice
  unitCost
`;

const LINE_FIELDS_BASIC = `
  name
  description
  quantity
  unitPrice
`;

function quotesQuery(lineFields: string): string {
  return `
    query QuotesGpPage(
      $first: Int!
      $after: String
      $filter: QuoteFilterAttributes
    ) {
      quotes(first: $first, after: $after, filter: $filter) {
        nodes {
          id
          quoteNumber
          title
          quoteStatus
          createdAt
          sentAt
          jobberWebUri
          amounts { subtotal total }
          client { id name companyName firstName lastName }
          property { address { street1 city province postalCode } }
          lineItems(first: 80) {
            nodes { ${lineFields} }
          }
        }
        pageInfo { hasNextPage endCursor }
        totalCount
      }
    }
  `;
}

const QUOTES_PAGE = quotesQuery(LINE_FIELDS_WITH_COST);
const QUOTES_PAGE_NO_UNIT_COST = quotesQuery(LINE_FIELDS_BASIC);

export type JobberQuoteLineNode = {
  name?: string | null;
  description?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  unitCost?: number | null;
};

export type JobberQuoteNode = {
  id: string;
  quoteNumber?: string | number | null;
  title?: string | null;
  quoteStatus?: string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  jobberWebUri?: string | null;
  amounts?: { subtotal?: number | null; total?: number | null } | null;
  client?: {
    id?: string | null;
    name?: string | null;
    companyName?: string | null;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  property?: { address?: JobberAddress | null } | null;
  lineItems?: { nodes?: Array<JobberQuoteLineNode | null> | null } | null;
};

export type QuotesGpPage = {
  quotes: TrackedQuote[];
  pageInfo: QuotesPageInfo;
  summary: QuoteGpSummary;
};

export type FetchQuotesGpPageInput = {
  after?: string | null;
  first?: number;
  status?: string | null;
  createdAfter?: string | null;
  createdBefore?: string | null;
};

function graphql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  return jobberGraphql(query, variables, {
    token: deps?.token,
    fetchImpl: deps?.fetchImpl,
    env: deps?.env,
  });
}

export function normalizeQuoteStatus(status: string | null | undefined): string {
  return (status || 'draft').trim().toLowerCase().replace(/-/g, '_');
}

export function clientDisplayName(
  client: JobberQuoteNode['client'] | null | undefined
): string {
  if (!client) return 'Unknown client';
  const company = client.companyName?.trim();
  if (company) return company;
  const name = client.name?.trim();
  if (name) return name;
  const parts = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  return parts || 'Unknown client';
}

export function toQuoteLineDraft(node: JobberQuoteLineNode): QuoteLineDraft {
  const unitCost = node.unitCost != null && node.unitCost > 0 ? node.unitCost : undefined;
  return {
    name: node.name || 'Line',
    description: node.description || undefined,
    quantity: Number(node.quantity) || 0,
    unitPrice: Number(node.unitPrice) || 0,
    taxable: true,
    unitCost,
  };
}

export function jobberFilterFromInput(
  input: FetchQuotesGpPageInput
): Record<string, unknown> | null {
  const filter: Record<string, unknown> = {};
  const status = input.status?.trim();
  if (status && status !== 'all') {
    filter.status = status;
  }
  const createdAt: Record<string, string> = {};
  if (input.createdAfter) createdAt.after = input.createdAfter;
  if (input.createdBefore) createdAt.before = input.createdBefore;
  if (Object.keys(createdAt).length) {
    filter.createdAt = createdAt;
  }
  return Object.keys(filter).length ? filter : null;
}

export function mapJobberQuote(
  node: JobberQuoteNode,
  products: JobberProductCost[] = []
): TrackedQuote {
  const lines = (node.lineItems?.nodes || [])
    .filter((line): line is JobberQuoteLineNode => Boolean(line))
    .map(toQuoteLineDraft);
  const subtotal = node.amounts?.subtotal ?? lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const score = scoreQuoteGrossProfit(lines, products, subtotal);
  const city = node.property?.address?.city?.trim() || null;
  const shop = city ? assignShop(city) : null;

  return {
    id: node.id,
    quoteNumber: String(node.quoteNumber ?? ''),
    client: clientDisplayName(node.client),
    title: node.title?.trim() || '(untitled)',
    status: normalizeQuoteStatus(node.quoteStatus),
    city,
    shop,
    subtotal: score.sell,
    createdAt: node.createdAt ?? null,
    sentAt: node.sentAt ?? null,
    jobberWebUri: node.jobberWebUri ?? null,
    costStatus: score.costStatus,
    estimatedCost: score.estimatedCost,
    gpDollars: score.gpDollars,
    gpPercent: score.gpPercent,
    underTarget: score.underTarget,
    flaggedUnder60: score.flaggedUnder60,
    missingMarginDollars: score.missingMarginDollars,
    unknownLineCount: score.unknownLineCount,
    costedLineCount: score.costedLineCount,
    flagTexts: score.flags.map((flag) => flag.text),
  };
}

function pageSize(first?: number): number {
  const n = first ?? QUOTES_GP_PAGE_SIZE;
  if (!Number.isFinite(n) || n < 1) return QUOTES_GP_PAGE_SIZE;
  return Math.min(Math.floor(n), QUOTES_GP_MAX_PAGE_SIZE);
}

function isUnknownFieldError(result: JobberGraphqlResult): boolean {
  const message = result.errors?.map((error) => error.message || '').join(' ') || '';
  return /unitCost|QuoteFilter|createdAt|status/i.test(message);
}

async function queryQuotesPage(
  variables: Record<string, unknown>,
  deps?: JobberDeps
): Promise<JobberGraphqlResult> {
  let result = await graphql(QUOTES_PAGE, variables, deps);
  if (result.errors?.length && /unitCost/i.test(result.errors.map((e) => e.message || '').join(' '))) {
    result = await graphql(QUOTES_PAGE_NO_UNIT_COST, variables, deps);
  }
  if (result.errors?.length && isUnknownFieldError(result) && variables.filter) {
    const { filter: _filter, ...rest } = variables;
    result = await graphql(QUOTES_PAGE_NO_UNIT_COST, rest, deps);
    if (result.errors?.length && /unitCost/i.test(result.errors.map((e) => e.message || '').join(' '))) {
      result = await graphql(QUOTES_PAGE_NO_UNIT_COST, rest, deps);
    }
  }
  return result;
}

export async function fetchQuotesGpPage(
  input: FetchQuotesGpPageInput = {},
  deps?: JobberDeps
): Promise<QuotesGpPage> {
  const first = pageSize(input.first);
  const filter = jobberFilterFromInput(input);
  const variables: Record<string, unknown> = {
    first,
    after: input.after || null,
  };
  if (filter) variables.filter = filter;

  const result = await queryQuotesPage(variables, deps);
  assertNoJobberErrors(result, 'quotes');

  const connection = result.data?.quotes;
  const nodes = (connection?.nodes || []) as JobberQuoteNode[];
  const productTerms = uniqueProductSearchTerms(nodes).slice(0, 20);
  const products = deps?.productCosts
    ? deps.productCosts
    : await fetchProductCosts(productTerms, deps);

  const quotes = nodes.map((node) => mapJobberQuote(node, products));
  const pageInfo: QuotesPageInfo = {
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
    endCursor: connection?.pageInfo?.endCursor ?? null,
    totalCount: connection?.totalCount ?? null,
  };

  return {
    quotes,
    pageInfo,
    summary: summarizeQuoteGpScores(quotes),
  };
}

export function uniqueProductSearchTerms(nodes: JobberQuoteNode[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const node of nodes) {
    for (const line of node.lineItems?.nodes || []) {
      const name = line?.name?.trim();
      if (!name) continue;
      const skuMatch = name.match(/\b([A-Z0-9]{2,}[A-Z0-9-]{1,})\b/);
      const term = skuMatch?.[1] || name.slice(0, 40);
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      terms.push(term);
    }
  }
  return terms;
}

