/**
 * Quote-focused MCP tools for shop bots.
 *
 * v1 surface is clients + draft quotes + product lookup.
 * There are no send / approve / convert / delete / payroll tools.
 */

import { mentionsGpFlag } from '../jobber/gross-profit.ts';
import {
  createUnsentQuote,
  findBrightonSalespersonId,
  jobberClientProperties,
  resolveQuoteCreatePropertyId,
  searchClients,
  type JobberClient,
  type JobberDeps,
} from '../jobber/quotes.ts';
import {
  getClientById,
  getQuoteById,
  searchProducts,
  searchQuotes,
  updateUnsentQuoteDraft,
  type JobberQuoteDetail,
} from '../jobber/mcp-quotes.ts';
import type { QuoteLineDraft } from '../jobber/shop-book.ts';
import type { McpDispatcher, McpToolDefinition, McpToolResult } from './protocol.ts';

export const JOBBER_MCP_SERVER_NAME = 'scws-jobber';
export const JOBBER_MCP_SERVER_VERSION = '1.0.0';

export const FORBIDDEN_JOBBER_MCP_TOOLS = [
  'send_quote',
  'approve_quote',
  'convert_quote',
  'delete_quote',
  'quote_send',
  'quote_approve',
  'quote_convert',
  'quote_delete',
  'payroll',
  'send_invoice',
] as const;

export const JOBBER_MCP_INSTRUCTIONS = [
  'Shared SCWS Jobber gateway. Draft quotes only.',
  'Never send, approve, convert, or delete quotes. Never touch payroll.',
  'Customer-facing title/message must not include GP FLAG math.',
  'Look up an existing client before creating a draft. Do not invent duplicates.',
].join(' ');

const LINE_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'quantity', 'unitPrice'],
  properties: {
    name: { type: 'string', description: 'Line name as it should appear on the quote' },
    description: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: { type: 'number', description: 'Street sell price. Do not invent a 60% GP raise.' },
    taxable: { type: 'boolean' },
  },
};

export const JOBBER_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'search_clients',
    description: 'Search Jobber clients by name, phone, email, or street address.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Name, phone, email, or address fragment' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_client',
    description: 'Load one Jobber client by encoded id, including properties and recent quotes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        clientId: { type: 'string' },
      },
      required: ['clientId'],
    },
  },
  {
    name: 'search_quotes',
    description: 'Search Jobber quotes by number, title, client, or address. Optional status filter (draft, sent, …).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        status: { type: 'string', description: 'draft | sent | approved | all (optional)' },
      },
    },
  },
  {
    name: 'get_quote',
    description: 'Load one Jobber quote by encoded id, including line items. Read-only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        quoteId: { type: 'string' },
      },
      required: ['quoteId'],
    },
  },
  {
    name: 'create_quote_draft',
    description:
      'Create an UNSENT Jobber quote draft. Never sends to the customer. Requires an existing clientId and a propertyId (or a client with exactly one property).',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['clientId', 'title', 'message', 'lineItems'],
      properties: {
        clientId: { type: 'string' },
        propertyId: {
          type: 'string',
          description:
            'Required unless the client has exactly one property, which is then used as the default.',
        },
        title: { type: 'string' },
        message: { type: 'string', description: 'Customer-facing body. No GP FLAG math.' },
        internalNote: { type: 'string', description: 'Private Jobber note. FLAG math is allowed here only.' },
        taxRateId: { type: 'string' },
        salespersonId: { type: 'string' },
        lineItems: { type: 'array', items: LINE_ITEM_SCHEMA, minItems: 1 },
      },
    },
  },
  {
    name: 'update_quote_draft',
    description:
      'Update an UNSENT draft quote (title, message, and/or add line items). Refuses sent/approved/converted quotes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['quoteId'],
      properties: {
        quoteId: { type: 'string' },
        title: { type: 'string' },
        message: { type: 'string' },
        taxRateId: { type: 'string' },
        salespersonId: { type: 'string' },
        addLineItems: { type: 'array', items: LINE_ITEM_SCHEMA },
      },
    },
  },
  {
    name: 'search_products',
    description:
      'Search Jobber products & services for line-item names and default street prices. Does not return internal cost.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
      },
    },
  },
];

export function isForbiddenJobberMcpTool(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (FORBIDDEN_JOBBER_MCP_TOOLS as readonly string[]).includes(normalized);
}

function textResult(payload: unknown, isError = false): McpToolResult {
  const result: McpToolResult = {
    content: [
      {
        type: 'text',
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
  if (isError) result.isError = true;
  return result;
}

function errorResult(message: string): McpToolResult {
  return textResult({ error: message, draftOnly: true }, true);
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseLineItems(value: unknown, field: string): QuoteLineDraft[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error(`${field} must be a non-empty array`);
  }
  return value.map((item, index) => {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    const quantity = Number(row.quantity);
    const unitPrice = Number(row.unitPrice);
    if (!name) throw new Error(`${field}[${index}].name is required`);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`${field}[${index}].quantity must be a positive number`);
    }
    if (!Number.isFinite(unitPrice)) {
      throw new Error(`${field}[${index}].unitPrice must be a number`);
    }
    return {
      name,
      description: typeof row.description === 'string' ? row.description : undefined,
      quantity,
      unitPrice,
      taxable: row.taxable === false ? false : true,
    };
  });
}

function summarizeClient(client: JobberClient) {
  return {
    id: client.id,
    name: client.name || [client.firstName, client.lastName].filter(Boolean).join(' ') || null,
    companyName: client.companyName || null,
    emails: (client.emails || []).map((entry) => entry?.address).filter(Boolean),
    phones: (client.phones || []).map((entry) => entry?.number).filter(Boolean),
    properties: jobberClientProperties(client.properties).map((property) => ({
      id: property.id,
      address: property.address || null,
    })),
    quotes: (client.quotes?.nodes || [])
      .filter((quote): quote is NonNullable<typeof quote> => Boolean(quote?.id))
      .map((quote) => ({
        id: quote.id,
        quoteNumber: quote.quoteNumber ?? null,
        title: quote.title ?? null,
        quoteStatus: quote.quoteStatus ?? null,
        sentAt: quote.sentAt ?? null,
        jobberWebUri: quote.jobberWebUri ?? null,
      })),
  };
}

function summarizeQuote(quote: JobberQuoteDetail) {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber ?? null,
    title: quote.title ?? null,
    quoteStatus: quote.quoteStatus ?? null,
    sentAt: quote.sentAt ?? null,
    createdAt: quote.createdAt ?? null,
    message: quote.message ?? null,
    jobberWebUri: quote.jobberWebUri ?? null,
    amounts: quote.amounts ?? null,
    client: quote.client
      ? {
          id: quote.client.id ?? null,
          name: quote.client.name ?? null,
          companyName: quote.client.companyName ?? null,
        }
      : null,
    property: quote.property
      ? { id: quote.property.id ?? null, address: quote.property.address ?? null }
      : null,
    lineItems: (quote.lineItems?.nodes || [])
      .filter((line): line is NonNullable<typeof line> => Boolean(line))
      .map((line) => ({
        id: line.id ?? null,
        name: line.name ?? null,
        description: line.description ?? null,
        quantity: line.quantity ?? null,
        unitPrice: line.unitPrice ?? null,
      })),
    draft: !quote.sentAt && (quote.quoteStatus || 'draft').toLowerCase() === 'draft',
  };
}

export async function callJobberMcpTool(
  name: string,
  args: Record<string, unknown>,
  deps?: JobberDeps
): Promise<McpToolResult> {
  if (isForbiddenJobberMcpTool(name)) {
    return errorResult('This gateway cannot send, approve, convert, or delete quotes, and has no payroll tools.');
  }

  try {
    switch (name) {
      case 'search_clients': {
        const query = requiredString(args, 'query');
        const clients = await searchClients(query, deps);
        return textResult({
          query,
          count: clients.length,
          clients: clients.map(summarizeClient),
        });
      }
      case 'get_client': {
        const client = await getClientById(requiredString(args, 'clientId'), deps);
        return textResult({ client: summarizeClient(client) });
      }
      case 'search_quotes': {
        const query = optionalString(args, 'query');
        const status = optionalString(args, 'status');
        const quotes = await searchQuotes({ searchTerm: query, status }, deps);
        return textResult({
          query: query || null,
          status: status || null,
          count: quotes.length,
          quotes: quotes.map(summarizeQuote),
        });
      }
      case 'get_quote': {
        const quote = await getQuoteById(requiredString(args, 'quoteId'), deps);
        return textResult({ quote: summarizeQuote(quote) });
      }
      case 'create_quote_draft': {
        const title = requiredString(args, 'title');
        const message = requiredString(args, 'message');
        if (mentionsGpFlag(title)) {
          throw new Error('Quote title must not contain GP FLAG math');
        }
        const clientId = requiredString(args, 'clientId');
        let propertyId = optionalString(args, 'propertyId');
        if (!propertyId) {
          const client = await getClientById(clientId, deps);
          propertyId = resolveQuoteCreatePropertyId(undefined, client.properties);
        }
        const salespersonId =
          optionalString(args, 'salespersonId') || (await findBrightonSalespersonId(deps));
        const quote = await createUnsentQuote(
          {
            clientId,
            propertyId,
            title,
            message,
            salespersonId,
            taxRateId: optionalString(args, 'taxRateId'),
            lineItems: parseLineItems(args.lineItems, 'lineItems'),
            internalNote: optionalString(args, 'internalNote'),
          },
          deps
        );
        return textResult({
          draft: true,
          sentAt: null,
          note: 'Draft stays unsent. No send/approve/convert tools exist on this gateway.',
          quote,
        });
      }
      case 'update_quote_draft': {
        const addLineItems = Array.isArray(args.addLineItems)
          ? parseLineItems(args.addLineItems, 'addLineItems')
          : undefined;
        const quote = await updateUnsentQuoteDraft(
          {
            quoteId: requiredString(args, 'quoteId'),
            title: optionalString(args, 'title'),
            message: optionalString(args, 'message'),
            taxRateId: optionalString(args, 'taxRateId'),
            salespersonId: optionalString(args, 'salespersonId'),
            addLineItems,
          },
          deps
        );
        return textResult({
          draft: true,
          sentAt: quote.sentAt ?? null,
          note: 'Draft stays unsent. This tool cannot send the quote to the customer.',
          quote: summarizeQuote(quote),
        });
      }
      case 'search_products': {
        const query = requiredString(args, 'query');
        const products = await searchProducts(query, deps);
        return textResult({
          query,
          count: products.length,
          products,
          note: 'defaultUnitCost is catalog/street list, not internal cost. Do not use this to invent 60% GP raises.',
        });
      }
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Jobber tool failed';
    return errorResult(message);
  }
}

export function createJobberMcpDispatcher(deps?: JobberDeps): McpDispatcher {
  return {
    serverInfo: {
      name: JOBBER_MCP_SERVER_NAME,
      version: JOBBER_MCP_SERVER_VERSION,
    },
    instructions: JOBBER_MCP_INSTRUCTIONS,
    tools: JOBBER_MCP_TOOLS,
    callTool: (name, args) => callJobberMcpTool(name, args, deps),
  };
}

export function jobberMcpHealthBody(authenticatedAs: string) {
  return {
    ok: true,
    server: JOBBER_MCP_SERVER_NAME,
    version: JOBBER_MCP_SERVER_VERSION,
    transport: 'streamable-http',
    authenticatedAs,
    tools: JOBBER_MCP_TOOLS.map((tool) => tool.name),
    safety: {
      draftOnly: true,
      sendsQuotes: false,
      payroll: false,
      forbidden: [...FORBIDDEN_JOBBER_MCP_TOOLS],
    },
  };
}
