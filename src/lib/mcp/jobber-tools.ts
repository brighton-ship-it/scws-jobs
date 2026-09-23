/**
 * MCP tools for shop bots.
 *
 * v1 surface is clients, draft quotes, private quote notes, product lookup,
 * read-only invoices, and read-only jobs (completed work + photo URLs for GBP).
 * There are no send / approve / convert / delete / payroll tools,
 * no invoice send, create, or payment tools, and no job mutations.
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
  createMcpQuoteNote,
  getClientById,
  getQuoteById,
  searchProducts,
  searchQuotes,
  updateUnsentQuoteDraft,
  type JobberQuoteDetail,
} from '../jobber/mcp-quotes.ts';
import { getInvoice, searchInvoices } from '../jobber/mcp-invoices.ts';
import { getJob, searchJobs } from '../jobber/mcp-jobs.ts';
import type { QuoteLineDraft } from '../jobber/shop-book.ts';
import type { McpDispatcher, McpToolDefinition, McpToolResult } from './protocol.ts';
import { diagnoseJobberDurableStore } from '../jobber/token-store.ts';

export const JOBBER_MCP_SERVER_NAME = 'scws-jobber';
export const JOBBER_MCP_SERVER_VERSION = '1.3.0';

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
  'create_invoice',
  'update_invoice',
  'delete_invoice',
  'invoice_send',
  'invoice_create',
  'invoice_update',
  'invoice_delete',
  'record_payment',
  'collect_payment',
  'create_job',
  'update_job',
  'edit_job',
  'complete_job',
  'delete_job',
  'send_job',
  'close_job',
  'email_job',
  'job_create',
  'job_update',
  'job_edit',
  'job_complete',
  'job_delete',
  'job_send',
  'job_close',
  'job_email',
] as const;

export const JOBBER_MCP_INSTRUCTIONS = [
  'Shared SCWS Jobber gateway. Draft quotes only, plus private notes on existing quotes. Invoice and job tools are read-only.',
  'Never send, approve, convert, or delete quotes. Never send, create, or collect invoices. Never create, update, complete, or email a job. Never touch payroll.',
  'Customer-facing title/message must not include GP FLAG math. Private quote notes may.',
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

const CREATE_QUOTE_NOTE_SCHEMA: McpToolDefinition['inputSchema'] = {
  type: 'object',
  additionalProperties: false,
  required: ['message'],
  properties: {
    quoteId: { type: 'string', description: 'Encoded Jobber quote id' },
    quoteNumber: {
      description: 'Quote number (string or number) when quoteId is unknown. Resolved with quote search.',
      anyOf: [{ type: 'string' }, { type: 'number' }],
    },
    message: {
      type: 'string',
      description: 'Private note body. Never copied onto the customer-facing title or message.',
    },
    clientId: {
      type: 'string',
      description:
        'Optional. Used only for clientCreateNote if quoteCreateNote and noteCreate both fail. If omitted, the quote client is used for that fallback.',
    },
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
    name: 'create_quote_note',
    description:
      'Attach a private Jobber note to an existing quote (sent or draft). Does not send, approve, convert, or edit the customer-facing quote. Pass quoteId or quoteNumber. GP FLAG math is allowed in message only.',
    inputSchema: CREATE_QUOTE_NOTE_SCHEMA,
  },
  {
    name: 'quote_create_note',
    description:
      'Alias of create_quote_note. Attach a private Jobber note to an existing quote. Does not send, approve, or convert.',
    inputSchema: CREATE_QUOTE_NOTE_SCHEMA,
  },
  {
    name: 'search_invoices',
    description:
      'Search Jobber invoices by invoice number, client name, or status. Read-only. Filter unpaid (balance > 0), overdue, or issued before a date. Paginate with first/after (pageInfo.endCursor). Does not send or create invoices.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Invoice number or client name' },
        status: {
          type: 'string',
          description: 'draft | awaiting_payment | past_due | paid | bad_debt | unpaid | overdue | all',
        },
        unpaid: { type: 'boolean', description: 'Only invoices with balance greater than 0' },
        overdue: {
          type: 'boolean',
          description: 'Only past-due invoices (status past_due, or unpaid with a due date before today)',
        },
        issuedBefore: {
          type: 'string',
          description: 'ISO date (YYYY-MM-DD). Only invoices issued before this date.',
        },
        first: { type: 'number', description: 'Page size. Default 15, max 25.' },
        after: { type: 'string', description: 'Cursor from the previous pageInfo.endCursor' },
        includeLineItems: {
          type: 'boolean',
          description: 'Include a short line-item summary. Default false.',
        },
      },
    },
  },
  {
    name: 'get_invoice',
    description:
      'Load one Jobber invoice by encoded id or invoice number. Read-only. Returns client, emails, amounts (total and balance), issued/due dates, status, and the client-hub payment link when Jobber provides one.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        invoiceId: { type: 'string', description: 'Encoded Jobber invoice id' },
        invoiceNumber: { type: 'string', description: 'Invoice number, if the id is unknown' },
        includeLineItems: {
          type: 'boolean',
          description: 'Include a line-item summary. Default true.',
        },
      },
    },
  },
  {
    name: 'search_jobs',
    description:
      'Search Jobber jobs by job number, title, client, or city. Read-only. completedAfter (ISO timestamp) is required for the GBP daily window of completed field jobs. Optional completedBefore, status (prefer completed), and first/after pagination. Returns client first name, property city, and a short list of https photo URLs. Does not create, update, complete, or email jobs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Job number, title, client name, or city',
        },
        completedAfter: {
          type: 'string',
          description: 'ISO timestamp. Only jobs completed at or after this instant. Required for the GBP daily window.',
        },
        completedBefore: {
          type: 'string',
          description: 'ISO timestamp. Only jobs completed at or before this instant.',
        },
        status: {
          type: 'string',
          description:
            'completed (has completedAt; preferred) | archived | requires_invoicing | active | today | upcoming | all',
        },
        first: { type: 'number', description: 'Page size. Default 15, max 25.' },
        after: { type: 'string', description: 'Cursor from the previous pageInfo.endCursor' },
      },
    },
  },
  {
    name: 'get_job',
    description:
      'Load one Jobber job by encoded id or job number. Read-only. Same fields as search_jobs, plus the full https photo list for GBP media. Does not create, update, complete, or email the job.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jobId: { type: 'string', description: 'Encoded Jobber job id' },
        jobNumber: { type: 'string', description: 'Job number, if the id is unknown' },
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

export function normalizeJobberMcpToolName(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function isForbiddenJobberMcpTool(name: string): boolean {
  return (FORBIDDEN_JOBBER_MCP_TOOLS as readonly string[]).includes(normalizeJobberMcpToolName(name));
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

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
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

function optionalQuoteNumber(args: Record<string, unknown>): string | number | undefined {
  const value = args.quoteNumber;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
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
    return errorResult(
      'This gateway cannot send, approve, convert, or delete quotes, cannot send or create invoices, cannot create, update, complete, or email jobs, and has no payroll tools.'
    );
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
      case 'create_quote_note':
      case 'quote_create_note': {
        const note = await createMcpQuoteNote(
          {
            quoteId: optionalString(args, 'quoteId'),
            quoteNumber: optionalQuoteNumber(args),
            message: requiredString(args, 'message'),
            clientId: optionalString(args, 'clientId'),
          },
          deps
        );
        return textResult(note, !note.ok);
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
      case 'search_invoices': {
        const query = optionalString(args, 'query');
        const status = optionalString(args, 'status');
        const unpaid = optionalBoolean(args, 'unpaid') ?? false;
        const overdue = optionalBoolean(args, 'overdue') ?? false;
        const issuedBefore = optionalString(args, 'issuedBefore');
        const result = await searchInvoices(
          {
            query,
            status,
            unpaid,
            overdue,
            issuedBefore,
            first: optionalNumber(args, 'first'),
            after: optionalString(args, 'after'),
            includeLineItems: optionalBoolean(args, 'includeLineItems') ?? false,
          },
          deps
        );
        return textResult({
          query: query || null,
          status: status || null,
          unpaid,
          overdue,
          issuedBefore: issuedBefore || null,
          count: result.invoices.length,
          pageInfo: result.pageInfo,
          invoices: result.invoices,
          note: [
            result.note,
            'Read-only. This gateway cannot send invoices, create invoices, or record payments.',
          ]
            .filter(Boolean)
            .join(' '),
        });
      }
      case 'get_invoice': {
        const invoice = await getInvoice(
          {
            invoiceId: optionalString(args, 'invoiceId'),
            invoiceNumber: optionalString(args, 'invoiceNumber'),
            includeLineItems: optionalBoolean(args, 'includeLineItems') ?? true,
          },
          deps
        );
        return textResult({
          invoice,
          note: 'Read-only. This gateway cannot send invoices, create invoices, or record payments.',
        });
      }
      case 'search_jobs': {
        const query = optionalString(args, 'query');
        const status = optionalString(args, 'status');
        const completedAfter = optionalString(args, 'completedAfter');
        const completedBefore = optionalString(args, 'completedBefore');
        const result = await searchJobs(
          {
            query,
            status,
            completedAfter,
            completedBefore,
            first: optionalNumber(args, 'first'),
            after: optionalString(args, 'after'),
          },
          deps
        );
        return textResult({
          query: query || null,
          status: status || null,
          completedAfter: completedAfter || null,
          completedBefore: completedBefore || null,
          count: result.jobs.length,
          pageInfo: result.pageInfo,
          jobs: result.jobs,
          note: [
            result.note,
            'Read-only. This gateway cannot create, update, complete, or email jobs.',
          ]
            .filter(Boolean)
            .join(' '),
        });
      }
      case 'get_job': {
        const job = await getJob(
          {
            jobId: optionalString(args, 'jobId'),
            jobNumber: optionalString(args, 'jobNumber'),
          },
          deps
        );
        return textResult({
          job,
          note: 'Read-only. This gateway cannot create, update, complete, or email jobs.',
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

export async function jobberMcpHealthBody(
  authenticatedAs: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const durableTokenStore = await diagnoseJobberDurableStore({ env });
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
      sendsInvoices: false,
      invoiceMutations: false,
      jobMutations: false,
      emailsCustomers: false,
      payroll: false,
      forbidden: [...FORBIDDEN_JOBBER_MCP_TOOLS],
    },
    durableTokenStore,
  };
}
