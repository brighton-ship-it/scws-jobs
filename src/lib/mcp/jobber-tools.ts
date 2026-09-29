/**
 * MCP tools for shop bots.
 *
 * Clients, unsent quote drafts, product lookup, invoice reads plus unsent
 * invoice drafts and invoice line/tax edits, job reads plus close, and tax
 * rates. Nothing sends, emails, or texts a client. jobComplete does not exist.
 * Per-invoice card / ACH / partial payment toggles are not in Jobber's API.
 */

import { mentionsGpFlag } from '../jobber/gross-profit.ts';
import {
  createUnsentQuote,
  findBrightonSalespersonId,
  jobberClientProperties,
  listTaxRates,
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
import { getInvoice, searchInvoices } from '../jobber/mcp-invoices.ts';
import { getJob, searchJobs } from '../jobber/mcp-jobs.ts';
import {
  assertNoInvoicePaymentOptions,
  createInvoiceDraftFromJob,
  editInvoice,
  normalizeInvoiceTaxMethod,
  parseInvoiceLineDrafts,
  parseInvoiceLineUpdates,
  parseRemoveLineItemIds,
} from '../jobber/mcp-invoice-writes.ts';
import { closeJob, normalizeIncompleteVisits } from '../jobber/mcp-job-writes.ts';
import type { QuoteLineDraft } from '../jobber/shop-book.ts';
import type { McpDispatcher, McpToolDefinition, McpToolResult } from './protocol.ts';
import { diagnoseJobberDurableStore } from '../jobber/token-store.ts';

export const JOBBER_MCP_SERVER_NAME = 'scws-jobber';
export const JOBBER_MCP_SERVER_VERSION = '1.4.0';

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
  'mark_invoice_sent',
  'invoice_mark_as_sent',
  'email_invoice',
  'text_invoice',
  'record_payment',
  'collect_payment',
  'create_job',
  'update_job',
  'edit_job',
  'complete_job',
  'delete_job',
  'send_job',
  'email_job',
  'job_create',
  'job_update',
  'job_edit',
  'job_complete',
  'job_delete',
  'job_send',
  'job_email',
] as const;

export const JOBBER_MCP_INSTRUCTIONS = [
  'Shared SCWS Jobber gateway. Quote and invoice creates stay unsent. close_job marks a job closed. Nothing emails or texts a client.',
  'Never send, approve, convert, or delete quotes. Never send or mark an invoice sent. Never call jobComplete (removed). Never collect a payment. Never touch payroll.',
  'edit_invoice sets taxRateId and Client Hub payment settings (allowCardPayments, allowAchPayments, allowPartialPayments). Those are settings, not a charge. Invoice line items cannot be edited. Never send, mark sent, record, or collect a payment.',
  'Customer-facing title/message must not include GP FLAG math.',
  'Look up an existing client before creating a draft. Do not invent duplicates.',
  'Use list_tax_rates to pick taxRateId (id, name, label, rate, default). search_products returns catalog street price, not internal cost.',
  'Quote lines may set optional, recommended, and productOrServiceId. Recommended lines should also be optional.',
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
    optional: {
      type: 'boolean',
      description: 'Optional quote line the client can include or skip. Omit for a required line.',
    },
    recommended: {
      type: 'boolean',
      description: 'Pre-select an optional line in Client Hub. Pass with optional: true.',
    },
    productOrServiceId: {
      type: 'string',
      description: 'Jobber product or service id from search_products.',
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
    description:
      'Load one Jobber quote by encoded id, including line items. Each line includes optional and recommended. Read-only.',
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
        taxRateId: {
          type: 'string',
          description: 'Jobber tax rate id from list_tax_rates (for example San Diego 7.75%).',
        },
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
        taxRateId: {
          type: 'string',
          description: 'Jobber tax rate id from list_tax_rates. Refuses if the quote was already sent.',
        },
        salespersonId: { type: 'string' },
        addLineItems: { type: 'array', items: LINE_ITEM_SCHEMA },
      },
    },
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
    name: 'edit_invoice',
    description:
      'Edit an existing Jobber invoice via invoiceEdit. Sets taxRateId and optional Client Hub settings allowCardPayments, allowAchPayments, and allowPartialPayments (card, ACH, partial). Those are settings, not a charge. addLineItems, updateLineItems, and removeLineItemIds are rejected. Does not send, email, text, mark sent, record, or collect a payment.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        invoiceId: { type: 'string', description: 'Encoded Jobber invoice id' },
        invoiceNumber: { type: 'string', description: 'Invoice number, if the id is unknown. Example: 5806' },
        addLineItems: {
          type: 'array',
          items: LINE_ITEM_SCHEMA,
          description: "Rejected. Jobber's API cannot edit invoice line items; use the Jobber web UI.",
        },
        updateLineItems: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['lineItemId'],
            properties: {
              lineItemId: { type: 'string', description: 'Existing line id from get_invoice' },
              name: { type: 'string' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number' },
              taxable: { type: 'boolean' },
            },
          },
          description: "Rejected. Jobber's API cannot edit invoice line items; use the Jobber web UI.",
        },
        removeLineItemIds: {
          type: 'array',
          items: { type: 'string' },
          description: "Rejected. Jobber's API cannot edit invoice line items; use the Jobber web UI.",
        },
        taxRateId: {
          type: 'string',
          description: 'Jobber tax rate id from list_tax_rates (for example San Diego 7.75%).',
        },
        allowCardPayments: {
          type: 'boolean',
          description: 'Maps to InvoiceEditInput.allowClientHubCreditCardPayments. A setting, not a charge.',
        },
        allowAchPayments: {
          type: 'boolean',
          description: 'Maps to InvoiceEditInput.allowClientHubAchPayments. A setting, not a charge.',
        },
        allowPartialPayments: {
          type: 'boolean',
          description: 'Maps to InvoiceEditInput.allowPartialPayments. A setting, not a charge.',
        },
      },
    },
  },
  {
    name: 'create_invoice_draft',
    description:
      'Create an UNSENT Jobber invoice from a job. Does not email, text, or call invoiceMarkAsSent. issuedDate is omitted. Pass lineItems or the job lines are copied. Optional taxRateId from list_tax_rates.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jobId: { type: 'string', description: 'Encoded Jobber job id' },
        jobNumber: { type: 'string', description: 'Job number, if the id is unknown' },
        subject: { type: 'string', description: 'Invoice subject. Defaults to the job title.' },
        lineItems: {
          type: 'array',
          items: LINE_ITEM_SCHEMA,
          description: 'Invoice lines. When omitted, lines are copied from the job.',
        },
        taxRateId: {
          type: 'string',
          description: 'Jobber tax rate id from list_tax_rates (for example San Diego 7.75%).',
        },
        taxCalculationMethod: {
          type: 'string',
          description: 'EXCLUSIVE (default; prices do not include tax) or INCLUSIVE.',
        },
        dueDate: { type: 'string', description: 'Optional YYYY-MM-DD due date.' },
        invoiceNet: { type: 'number', description: 'Optional payment terms in days (net).' },
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
    name: 'close_job',
    description:
      'Close a Jobber job (jobClose). jobComplete was removed. incompleteVisits is required: COMPLETE_PAST_DESTROY_FUTURE or DESTROY_ALL (deletes every incomplete visit). Does not email or text the client.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['incompleteVisits'],
      properties: {
        jobId: { type: 'string', description: 'Encoded Jobber job id' },
        jobNumber: { type: 'string', description: 'Job number, if the id is unknown' },
        incompleteVisits: {
          type: 'string',
          description:
            'COMPLETE_PAST_DESTROY_FUTURE or DESTROY_ALL. Required. DESTROY_ALL deletes incomplete visits, past and future.',
        },
      },
    },
  },
  {
    name: 'list_tax_rates',
    description:
      'List Jobber tax rates (id, name, label, rate, default). Read-only. Optional query matches name, label, or description, for example "San Diego" or "7.75". Pass the id as taxRateId on create_quote_draft, update_quote_draft, edit_invoice, or create_invoice_draft.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Optional filter, e.g. San Diego or 7.75' },
      },
    },
  },
  {
    name: 'search_products',
    description:
      'Search Jobber products and services by name or description. Returns id, name, description, defaultUnitCost (street list, not internal cost), taxable, and category. If Jobber search is empty, pages the catalog and filters locally. GraphQL errors are returned instead of an empty list.',
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
    const optional = lineBoolean(row, 'optional', index, field);
    const recommended = lineBoolean(row, 'recommended', index, field);
    const productOrServiceId =
      typeof row.productOrServiceId === 'string' ? row.productOrServiceId.trim() : '';
    return {
      name,
      description: typeof row.description === 'string' ? row.description : undefined,
      quantity,
      unitPrice,
      taxable: row.taxable === false ? false : true,
      ...(optional === undefined ? {} : { optional }),
      ...(recommended === undefined ? {} : { recommended }),
      ...(productOrServiceId ? { productOrServiceId } : {}),
    };
  });
}

function lineBoolean(
  row: Record<string, unknown>,
  key: string,
  index: number,
  field: string
): boolean | undefined {
  const value = row[key];
  if (!(key in row) || value == null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw new Error(`${field}[${index}].${key} must be a boolean`);
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
        optional: typeof line.optional === 'boolean' ? line.optional : null,
        recommended: typeof line.recommended === 'boolean' ? line.recommended : null,
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
      'This gateway cannot send, approve, convert, or delete quotes, cannot send or mark invoices sent, cannot email or text a client, and has no payroll tools. jobComplete was removed; use close_job.'
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
            'Read-only search. Use create_invoice_draft or edit_invoice to write. This gateway cannot send invoices or record payments.',
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
          note: "Read-only. Use edit_invoice to set taxRateId or Client Hub card, ACH, and partial-payment settings. Jobber's API cannot edit invoice line items; use the Jobber web UI. This gateway cannot send invoices or record payments.",
        });
      }
      case 'edit_invoice': {
        assertNoInvoicePaymentOptions(args);
        const addLineItems = Array.isArray(args.addLineItems)
          ? parseInvoiceLineDrafts(args.addLineItems, 'addLineItems')
          : undefined;
        const updateLineItems = Array.isArray(args.updateLineItems)
          ? parseInvoiceLineUpdates(args.updateLineItems)
          : undefined;
        const removeLineItemIds = Array.isArray(args.removeLineItemIds)
          ? parseRemoveLineItemIds(args.removeLineItemIds)
          : undefined;
        const invoice = await editInvoice(
          {
            invoiceId: optionalString(args, 'invoiceId'),
            invoiceNumber: optionalString(args, 'invoiceNumber'),
            addLineItems,
            updateLineItems,
            removeLineItemIds,
            taxRateId: optionalString(args, 'taxRateId'),
            allowCardPayments: optionalBoolean(args, 'allowCardPayments'),
            allowAchPayments: optionalBoolean(args, 'allowAchPayments'),
            allowPartialPayments: optionalBoolean(args, 'allowPartialPayments'),
          },
          deps
        );
        return textResult({
          sent: false,
          emailed: false,
          collected: false,
          invoice,
          note: 'Updated tax and/or Client Hub payment settings with invoiceEdit. Nothing was emailed, texted, or charged.',
        });
      }
      case 'create_invoice_draft': {
        const lineItems = Array.isArray(args.lineItems)
          ? parseInvoiceLineDrafts(args.lineItems, 'lineItems')
          : undefined;
        const taxMethod = optionalString(args, 'taxCalculationMethod');
        const created = await createInvoiceDraftFromJob(
          {
            jobId: optionalString(args, 'jobId'),
            jobNumber: optionalString(args, 'jobNumber'),
            subject: optionalString(args, 'subject'),
            lineItems,
            taxRateId: optionalString(args, 'taxRateId'),
            taxCalculationMethod: taxMethod ? normalizeInvoiceTaxMethod(taxMethod) : undefined,
            dueDate: optionalString(args, 'dueDate'),
            invoiceNet: optionalNumber(args, 'invoiceNet'),
          },
          deps
        );
        return textResult({
          draft: created.invoice.invoiceStatus === 'draft',
          sent: false,
          emailed: false,
          invoiceStatus: created.invoiceStatus,
          invoice: created.invoice,
          note: 'Created with invoiceCreate only. issuedDate was not set. invoiceMarkAsSent was not called. Nothing was emailed or texted.',
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
            'Read-only search. Use close_job to close a job. This gateway cannot create, update, or email jobs.',
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
          note: 'Read-only. Use close_job to close a job. This gateway cannot email a job.',
        });
      }
      case 'close_job': {
        const job = await closeJob(
          {
            jobId: optionalString(args, 'jobId'),
            jobNumber: optionalString(args, 'jobNumber'),
            incompleteVisits: normalizeIncompleteVisits(optionalString(args, 'incompleteVisits')),
          },
          deps
        );
        return textResult({
          closed: true,
          emailed: false,
          job,
          note: 'Closed with jobClose. jobComplete was not called. Nothing was emailed or texted.',
        });
      }
      case 'list_tax_rates': {
        const query = optionalString(args, 'query');
        const taxRates = await listTaxRates(query, deps);
        return textResult({
          query: query || null,
          count: taxRates.length,
          taxRates,
          note: 'Read-only. Pass taxRates[].id as taxRateId on create_quote_draft, update_quote_draft, edit_invoice, or create_invoice_draft. This does not change a rate or send anything.',
        });
      }
      case 'search_products': {
        const query = requiredString(args, 'query');
        const result = await searchProducts(query, deps);
        return textResult({
          query,
          count: result.products.length,
          matchedBy: result.matchedBy,
          truncated: result.truncated,
          products: result.products,
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
      invoiceMutations: true,
      jobMutations: true,
      emailsCustomers: false,
      paymentOptionEdits: true,
      payroll: false,
      forbidden: [...FORBIDDEN_JOBBER_MCP_TOOLS],
    },
    durableTokenStore,
  };
}
