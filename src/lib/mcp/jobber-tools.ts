/**
 * MCP tools for shop bots.
 *
 * Clients (search, create, property), users, unsent quote drafts, product
 * lookup, invoice reads plus unsent invoice drafts and tax/Client Hub edits,
 * requests (search, create, assessment schedule), job reads plus one-off
 * create, visit schedule, and close, notes, tax rates, and catalog cost
 * reads plus a one-product price/cost/visibility edit. Nothing sends,
 * emails, or texts a client. jobComplete does not exist. Products are not
 * deleted. Per-invoice card / ACH / partial payment toggles are not in
 * Jobber's API.
 */

import { mentionsGpFlag } from '../jobber/gross-profit.ts';
import {
  createUnsentQuote,
  findBrightonSalespersonId,
  summarizeJobberSalesperson,
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
  setQuoteSalesperson,
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
import { createClient, createProperty, listUsers, parseCreateClientArgs, parsePropertyAddressArgs } from '../jobber/mcp-client-writes.ts';
import {
  closeJob,
  createJob,
  createVisit,
  normalizeIncompleteVisits,
  parseAssigneeIds,
  parseCreateJobArgs,
  parseCreateVisitArgs,
} from '../jobber/mcp-job-writes.ts';
import { createNote, parseCreateNoteArgs } from '../jobber/mcp-notes.ts';
import { assertNoNotifyArgs } from '../jobber/mcp-notify.ts';
import { createRequest } from '../jobber/mcp-request-writes.ts';
import { getRequest, searchRequests } from '../jobber/mcp-requests.ts';
import {
  ProductEditUserError,
  editProduct,
  getProducts,
  parseEditProductArgs,
  parseGetProductsArgs,
} from '../jobber/mcp-products.ts';
import type { QuoteLineDraft } from '../jobber/shop-book.ts';
import type { McpDispatcher, McpToolDefinition, McpToolResult } from './protocol.ts';
import { diagnoseJobberDurableStore } from '../jobber/token-store.ts';

export const JOBBER_MCP_SERVER_NAME = 'scws-jobber';
export const JOBBER_MCP_SERVER_VERSION = '1.8.0';

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
  'update_job',
  'edit_job',
  'complete_job',
  'delete_job',
  'send_job',
  'email_job',
  'job_update',
  'job_edit',
  'job_complete',
  'job_delete',
  'job_send',
  'job_email',
  'complete_visit',
  'visit_complete',
  'send_request',
  'email_request',
  'text_request',
  'send_client',
  'email_client',
  'text_client',
  'send_visit',
  'visit_reminder',
  'booking_confirmation',
] as const;

export const JOBBER_MCP_INSTRUCTIONS = [
  'Shared SCWS Jobber gateway. Quote and invoice creates stay unsent. close_job marks a job closed. create_client, create_property, create_request, create_job, create_visit, and create_note write records. Nothing emails, texts, or notifies a client.',
  'Never send, approve, convert, or delete quotes. Never send or mark an invoice sent. Never call jobComplete (removed). Never collect a payment. Never touch payroll. Never turn on a notify, reminder, or booking-confirmation flag.',
  'edit_invoice sets taxRateId and Client Hub payment settings (allowCardPayments, allowAchPayments, allowPartialPayments). Those are settings, not a charge. Invoice line items cannot be edited. Never send, mark sent, record, or collect a payment.',
  'Customer-facing title/message must not include GP FLAG math.',
  'create_client refuses when the same email or full name already exists unless force=true. Look up an existing client before creating a draft.',
  'list_users returns team member ids. Pass those ids as assigneeIds. Assessment and visit times are America/Los_Angeles.',
  'create_job cannot put a datetime on jobCreate. It creates a one-off job with createVisits false, then visitCreate when startAt and endAt are set. Job lines have no productOrServiceId; the catalog id is copied as name and street price.',
  'Use list_tax_rates to pick taxRateId (id, name, label, rate, default). search_products returns catalog street price, not internal cost. get_products returns internalUnitCost, unitPrice (Jobber defaultUnitCost), markup, and visible. edit_product changes only those cost, price, markup, and visible fields on one product and returns before and after. dryRun does not write. Products are not deleted.',
  'Quote lines may set optional, recommended, and productOrServiceId. Recommended lines should also be optional.',
  'create_quote_draft assigns Brighton Scala as salesperson when salespersonId is omitted. update_quote_draft changes salesperson only when salespersonId is passed, and errors if Jobber leaves the previous salesperson in place. set_quote_salesperson changes only the salesperson on a quote in any status and never contacts the customer. Quote reads include salesperson id and name.',
  'search_jobs and get_job accept includeVisits (default false) for visit times and assigned technician names. That path skips photos and caps the Jobber page at 10. search_invoices and get_invoice accept includeJobs (default false) for linked job ids and job numbers.',
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

const JOB_LINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['quantity'],
  properties: {
    name: { type: 'string', description: 'Required unless productOrServiceId is set.' },
    description: { type: 'string' },
    quantity: { type: 'number' },
    unitPrice: {
      type: 'number',
      description: 'Street sell price. Required unless productOrServiceId is set.',
    },
    taxable: { type: 'boolean' },
    productOrServiceId: {
      type: 'string',
      description:
        'Catalog id from search_products. Jobber job lines cannot store this id. The gateway copies name and street defaultUnitCost.',
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
    name: 'create_client',
    description:
      'Create a Jobber client. Optional company, emails, phones, billing address, and an initial property (street1, city, province, postalCode, country). If the same email or full name already exists, returns those matches and does not create unless force=true. Reminder, follow-up, and SMS flags are forced off. Does not email or text the client.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['firstName', 'lastName'],
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        companyName: { type: 'string' },
        force: {
          type: 'boolean',
          description: 'Create even when an email or full-name match already exists. Default false.',
        },
        emails: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['address'],
            properties: {
              address: { type: 'string' },
              description: { type: 'string', description: 'MAIN, WORK, PERSONAL, or OTHER. Default MAIN.' },
              primary: { type: 'boolean' },
            },
          },
        },
        phones: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['number'],
            properties: {
              number: { type: 'string' },
              description: { type: 'string', description: 'MAIN, WORK, MOBILE, HOME, FAX, or OTHER. Default MAIN.' },
              primary: { type: 'boolean' },
            },
          },
        },
        billingAddress: {
          type: 'object',
          additionalProperties: false,
          required: ['street1', 'city', 'province', 'postalCode'],
          description: 'Billing address. country defaults to US.',
          properties: {
            street1: { type: 'string' },
            street2: { type: 'string' },
            city: { type: 'string' },
            province: { type: 'string', description: 'State or province. California is CA.' },
            postalCode: { type: 'string' },
            country: { type: 'string', description: 'Default US when omitted.' },
          },
        },
        property: {
          type: 'object',
          additionalProperties: false,
          required: ['street1', 'city', 'province', 'postalCode'],
          description: 'Optional property created with the client. country defaults to US.',
          properties: {
            street1: { type: 'string' },
            street2: { type: 'string' },
            city: { type: 'string' },
            province: { type: 'string', description: 'State or province. California is CA.' },
            postalCode: { type: 'string' },
            country: { type: 'string', description: 'Default US when omitted.' },
          },
        },
      },
    },
  },
  {
    name: 'create_property',
    description:
      'Add a property to an existing Jobber client via propertyCreate. Does not email or text the client.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['clientId', 'street1', 'city', 'province', 'postalCode'],
      properties: {
        clientId: { type: 'string' },
        street1: { type: 'string' },
        street2: { type: 'string' },
        city: { type: 'string' },
        province: { type: 'string' },
        postalCode: { type: 'string' },
        country: { type: 'string', description: 'Default US when omitted.' },
      },
    },
  },
  {
    name: 'list_users',
    description:
      'List Jobber users (team members) with encoded ids, name, email, and status. Optional query matches name or email, for example Brighton Scala. Read-only. Does not invite or email anyone. Pass ids as assigneeIds on create_request, create_job, or create_visit.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Optional name or email fragment' },
      },
    },
  },
  {
    name: 'search_quotes',
    description:
      'Search Jobber quotes by number, title, client, or address. Optional status filter (draft, sent, …). Each quote includes salesperson id and name.',
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
      'Load one Jobber quote by encoded id, including line items and salesperson (id and name). Each line includes optional and recommended. Read-only.',
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
        salespersonId: {
          type: 'string',
          description:
            'Jobber user id. Omit to assign Brighton Scala (info@scwellservice.com).',
        },
        lineItems: { type: 'array', items: LINE_ITEM_SCHEMA, minItems: 1 },
      },
    },
  },
  {
    name: 'update_quote_draft',
    description:
      'Update an UNSENT draft quote (title, message, salesperson, and/or add line items). Refuses sent/approved/converted quotes. salespersonId is sent on quoteEdit; the tool re-reads the quote and errors if Jobber did not change the salesperson.',
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
        salespersonId: {
          type: 'string',
          description:
            'Jobber user id. Omit to leave the salesperson unchanged. The response salesperson must match this id or the tool errors.',
        },
        addLineItems: { type: 'array', items: LINE_ITEM_SCHEMA },
      },
    },
  },
  {
    name: 'set_quote_salesperson',
    description:
      'Set ONLY the salesperson on a Jobber quote in any status (draft, awaiting_response, approved, converted, or changes_requested). Uses quoteEdit with salespersonId and no other fields. Never contacts the customer: it does not send, resend, or notify. Does not change line items, amounts, message, or status. salespersonId must be an active Jobber user from list_users (status ACTIVATED). Re-reads the quote and returns the salesperson Jobber actually shows.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['quoteId', 'salespersonId'],
      properties: {
        quoteId: { type: 'string', description: 'Encoded Jobber quote id.' },
        salespersonId: {
          type: 'string',
          description:
            'Jobber user id from list_users. Must be status ACTIVATED. This is the only field the tool writes.',
        },
      },
    },
  },
  {
    name: 'search_invoices',
    description:
      'Search Jobber invoices by invoice number, client name, or status. Read-only. Filter unpaid (balance > 0), overdue, or issued before a date. Paginate with first/after (pageInfo.endCursor). Pass includeJobs for linked job ids and job numbers. Does not send or create invoices.',
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
        includeJobs: {
          type: 'boolean',
          description:
            'Include linked job ids and job numbers (jobs first 5) so invoice revenue can be tied to the job. Default false.',
        },
      },
    },
  },
  {
    name: 'get_invoice',
    description:
      'Load one Jobber invoice by encoded id or invoice number. Read-only. Returns client, emails, amounts (total and balance), issued/due dates, status, and the client-hub payment link when Jobber provides one. Pass includeJobs for linked job ids and job numbers.',
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
        includeJobs: {
          type: 'boolean',
          description: 'Include linked job ids and job numbers. Default false.',
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
      'Create an UNSENT Jobber invoice from a job. Does not email, text, or call invoiceMarkAsSent. issuedDate is omitted. Pass lineItems or the job lines are copied. Optional taxRateId from list_tax_rates. saveToProductsAndServices is not sent: InvoiceCreationLineItemInput does not define it. Returns invoice number, Jobber URL, and totals.',
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
      'Search Jobber jobs by job number, title, client, or city. Read-only. completedAfter (ISO timestamp) is the GBP daily window of completed field jobs. Optional completedBefore, status (prefer completed), and first/after pagination. Returns client first name, property city, and a short list of https photo URLs. Pass includeVisits to attribute the work to assigned technicians (skips photos and caps the Jobber page at 10). Does not update, complete, or email jobs. Use create_job to add a one-off job.',
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
        includeVisits: {
          type: 'boolean',
          description:
            'Include visits (id, title, start/end, completedAt, isComplete, assignee full names) so revenue can be attributed to the techs who did the work. Default false. Skips photo URLs and caps the Jobber page at 10 to stay under query cost.',
        },
      },
    },
  },
  {
    name: 'get_job',
    description:
      'Load one Jobber job by encoded id or job number. Read-only. Same fields as search_jobs, plus the full https photo list for GBP media. Pass includeVisits for visit assignees (photos are omitted on that path). Does not update, complete, or email the job. Use create_visit to add a visit.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jobId: { type: 'string', description: 'Encoded Jobber job id' },
        jobNumber: { type: 'string', description: 'Job number, if the id is unknown' },
        includeVisits: {
          type: 'boolean',
          description:
            'Include visit times and assigned technician names. Default false. Skips the photo list so the query stays smaller.',
        },
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
    name: 'create_job',
    description:
      'Create a one-off Jobber job for a client property. jobCreate has no visit datetime: scheduling.createVisits is false and notifyTeam is false, then visitCreate runs when startAt and endAt are set (America/Los_Angeles). Optional line items. productOrServiceId is looked up and copied as name and street price; Jobber job lines cannot store the product id. Does not email, text, or request a review.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['clientId', 'title'],
      properties: {
        clientId: { type: 'string' },
        propertyId: {
          type: 'string',
          description: 'Required unless the client has exactly one property.',
        },
        title: { type: 'string' },
        instructions: { type: 'string' },
        lineItems: {
          type: 'array',
          items: JOB_LINE_SCHEMA,
          description:
            'Optional. productOrServiceId is resolved with product(id). The id is not sent on the job line.',
        },
        startAt: {
          type: 'string',
          description:
            'First visit start. ISO datetime. A value without a zone is America/Los_Angeles wall time. Requires endAt.',
        },
        endAt: { type: 'string', description: 'First visit end. Same timezone rules as startAt.' },
        assigneeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'User ids from list_users. Requires startAt and endAt.',
        },
      },
    },
  },
  {
    name: 'create_visit',
    description:
      'Schedule a visit on an existing job via visitCreate. startAt and endAt are America/Los_Angeles. notifyTeam is forced off. Does not email or text the client.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['startAt', 'endAt'],
      properties: {
        jobId: { type: 'string', description: 'Encoded Jobber job id' },
        jobNumber: { type: 'string', description: 'Job number, if the id is unknown' },
        title: { type: 'string' },
        instructions: { type: 'string' },
        startAt: { type: 'string', description: 'ISO datetime. No zone means America/Los_Angeles wall time.' },
        endAt: { type: 'string' },
        assigneeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'User ids from list_users.',
        },
      },
    },
  },
  {
    name: 'search_requests',
    description:
      'Search Jobber requests by title, client, or address. Read-only. Optional clientId, status, and first/after pagination. Includes the assessment start, end, and assignees when Jobber returns them. Does not email the client.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Title, client, or address fragment' },
        clientId: { type: 'string' },
        status: {
          type: 'string',
          description:
            'new | unscheduled | upcoming | today | overdue | assessment_completed | converted | completed | archived | all',
        },
        first: { type: 'number', description: 'Page size. Default 15, max 25.' },
        after: { type: 'string', description: 'Cursor from the previous pageInfo.endCursor' },
      },
    },
  },
  {
    name: 'get_request',
    description:
      'Load one Jobber request by encoded id, including its assessment when one exists. Read-only. Does not email the client.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['requestId'],
      properties: {
        requestId: { type: 'string' },
      },
    },
  },
  {
    name: 'create_request',
    description:
      'Create a Jobber request for a client property. Optional on-site assessment: pass startAt and endAt (America/Los_Angeles) and assigneeIds from list_users. The assessment title cannot be set. details are stored as assessment instructions and a request note. notifyTeam is forced off. Does not email, text, or send a booking confirmation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['clientId', 'title'],
      properties: {
        clientId: { type: 'string' },
        propertyId: {
          type: 'string',
          description: 'Required unless the client has exactly one property.',
        },
        title: { type: 'string' },
        details: { type: 'string', description: 'Notes for the request and, when scheduled, the assessment instructions.' },
        startAt: {
          type: 'string',
          description: 'Assessment start. ISO datetime. No zone means America/Los_Angeles wall time. Requires endAt.',
        },
        endAt: { type: 'string', description: 'Assessment end. Same timezone rules as startAt.' },
        assigneeIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'User ids from list_users, for example Brighton Scala. Requires startAt and endAt.',
        },
      },
    },
  },
  {
    name: 'create_note',
    description:
      'Add a note to a client, request, job, or quote. Uses clientCreateNote, requestCreateNote, jobCreateNote, or quoteCreateNote. Pass exactly one id. Does not email or text the client.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['message'],
      properties: {
        message: { type: 'string' },
        clientId: { type: 'string' },
        requestId: { type: 'string' },
        jobId: { type: 'string' },
        quoteId: { type: 'string' },
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
      'Search Jobber products and services by name or description. Returns id, name, description, defaultUnitCost (street list, not internal cost), taxable, and category. If Jobber search is empty, pages the catalog and filters locally. GraphQL errors are returned instead of an empty list. For internalUnitCost, markup, and visible, use get_products.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string' },
      },
    },
  },
  {
    name: 'get_products',
    description:
      'Read Jobber products or services by id, or one page of a name/description search. Returns id, name, description, category, unitPrice (Jobber defaultUnitCost, the street/default price), defaultUnitCost, internalUnitCost, markup, taxable, visible, and archived (true when visible is false; Jobber has no archived field), plus duration, booking, and quantity-range fields. customFields and last line items are omitted. Search pages send an explicit first (default 25, max 50) so the query stays under Jobber\'s 10,000-point cap. Does not edit the catalog.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'ProductOrService encoded ids. At most 25. Do not combine with query.',
        },
        id: { type: 'string', description: 'One ProductOrService encoded id.' },
        productId: { type: 'string', description: 'One ProductOrService encoded id.' },
        query: {
          type: 'string',
          description: 'Catalog search term. One page of products(searchTerm, first, after).',
        },
        first: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Search page size. Default 25, max 50. Always sent as products(first:).',
        },
        after: { type: 'string', description: 'pageInfo.endCursor from the previous get_products search page.' },
      },
    },
  },
  {
    name: 'edit_product',
    description:
      'Edit ONE Jobber product or service with productsAndServicesEdit. Allowed fields only: internalUnitCost, unitPrice (sent as defaultUnitCost; Jobber has no unitPrice input), markup, and visible (false hides it from line-item autocomplete). Every other field is rejected. There is no delete. Reads the current row first and re-reads after a write so the result has before and after. dryRun returns the projected after without mutating. userErrors are returned on the error result with before.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['productId'],
      properties: {
        productId: { type: 'string', description: 'ProductOrService encoded id. One product per call.' },
        internalUnitCost: { type: 'number', description: 'Catalog cost. ProductOrService.internalUnitCost.' },
        unitPrice: {
          type: 'number',
          description: 'Street/default price. Sent as ProductsAndServicesEditInput.defaultUnitCost.',
        },
        markup: { type: 'number', description: 'Catalog markup. ProductOrService.markup.' },
        visible: {
          type: 'boolean',
          description: 'false hides the item from quote, job, and invoice line-item autocomplete.',
        },
        dryRun: {
          type: 'boolean',
          description: 'When true, return before and the projected after without calling productsAndServicesEdit.',
        },
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
    salesperson: summarizeJobberSalesperson(quote.salesperson),
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
      case 'create_client': {
        assertNoNotifyArgs(args);
        const created = await createClient(parseCreateClientArgs(args), deps);
        return textResult({
          created: created.created,
          notified: false,
          warning: created.warning ?? null,
          matches: created.matches.map((match) => ({
            matchedBy: match.matchedBy,
            client: summarizeClient(match.client),
          })),
          client: created.client ? summarizeClient(created.client) : null,
          note: created.created
            ? 'Created with clientCreate. Reminder, follow-up, and smsAllowed flags are false. Nothing was emailed or texted.'
            : created.warning,
        });
      }
      case 'create_property': {
        assertNoNotifyArgs(args);
        const property = await createProperty(
          {
            clientId: requiredString(args, 'clientId'),
            address: parsePropertyAddressArgs(args),
          },
          deps
        );
        return textResult({
          notified: false,
          property,
          note: 'Created with propertyCreate. Nothing was emailed or texted.',
        });
      }
      case 'list_users': {
        const query = optionalString(args, 'query');
        const listed = await listUsers(query, deps);
        return textResult({
          query: query || null,
          count: listed.users.length,
          truncated: listed.truncated,
          users: listed.users,
          note: 'Read-only. Pass users[].id as assigneeIds. Prefer status ACTIVATED. This does not invite or email anyone.',
        });
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
          quote: {
            ...quote,
            salesperson: summarizeJobberSalesperson(quote.salesperson),
          },
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
      case 'set_quote_salesperson': {
        assertNoNotifyArgs(args);
        const rejected = [
          'title',
          'message',
          'lineItems',
          'addLineItems',
          'taxRateId',
          'status',
          'quoteStatus',
          'sentAt',
          'transitionQuoteTo',
        ].filter((key) => args[key] != null);
        if (rejected.length) {
          throw new Error(
            `set_quote_salesperson only changes salesperson. Refusing ${rejected.join(', ')}.`
          );
        }
        const result = await setQuoteSalesperson(
          {
            quoteId: requiredString(args, 'quoteId'),
            salespersonId: requiredString(args, 'salespersonId'),
          },
          deps
        );
        const salesperson = summarizeJobberSalesperson(result.quote.salesperson);
        return textResult({
          notified: false,
          sent: false,
          changed: result.changed,
          salesperson,
          quote: summarizeQuote(result.quote),
          note: result.changed
            ? 'Changed only the salesperson via quoteEdit. Never contacts the customer. Did not send, resend, or notify. Did not change line items, amounts, message, or status.'
            : 'Salesperson was already this user. No quoteEdit was sent. Never contacts the customer.',
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
            includeJobs: optionalBoolean(args, 'includeJobs') ?? false,
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
            includeJobs: optionalBoolean(args, 'includeJobs') ?? false,
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
            includeVisits: optionalBoolean(args, 'includeVisits') ?? false,
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
            'Read-only search. Use create_job or create_visit to write, and close_job to close. This gateway cannot email a job.',
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
            includeVisits: optionalBoolean(args, 'includeVisits') ?? false,
          },
          deps
        );
        return textResult({
          job,
          note: 'Read-only. Use create_visit to add a visit and close_job to close. This gateway cannot email a job.',
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
      case 'create_job': {
        assertNoNotifyArgs(args);
        const created = await createJob(parseCreateJobArgs(args), deps);
        return textResult({
          notified: false,
          job: created.job,
          visits: created.visits,
          visitError: created.visitError,
          limitations: created.limitations,
          note: 'Created with jobCreate (createVisits false, notifyTeam false, allowReviewRequest false). A first visit, when startAt and endAt are set, is visitCreate. Nothing was emailed or texted.',
        });
      }
      case 'create_visit': {
        assertNoNotifyArgs(args);
        const visits = await createVisit(parseCreateVisitArgs(args), deps);
        return textResult({
          notified: false,
          visits,
          note: 'Scheduled with visitCreate. notifyTeam is false. Nothing was emailed or texted.',
        });
      }
      case 'search_requests': {
        const query = optionalString(args, 'query');
        const status = optionalString(args, 'status');
        const result = await searchRequests(
          {
            query,
            clientId: optionalString(args, 'clientId'),
            status,
            first: optionalNumber(args, 'first'),
            after: optionalString(args, 'after'),
          },
          deps
        );
        return textResult({
          query: query || null,
          status: status || null,
          count: result.requests.length,
          pageInfo: result.pageInfo,
          requests: result.requests,
          note: 'Read-only. Use create_request to add a request and schedule an assessment. This does not email the client.',
        });
      }
      case 'get_request': {
        const request = await getRequest(requiredString(args, 'requestId'), deps);
        return textResult({
          request,
          note: 'Read-only. This does not email the client.',
        });
      }
      case 'create_request': {
        assertNoNotifyArgs(args);
        const created = await createRequest(
          {
            clientId: requiredString(args, 'clientId'),
            propertyId: optionalString(args, 'propertyId'),
            title: requiredString(args, 'title'),
            details: optionalString(args, 'details'),
            startAt: optionalString(args, 'startAt'),
            endAt: optionalString(args, 'endAt'),
            assigneeIds: parseAssigneeIds(args.assigneeIds),
          },
          deps
        );
        return textResult({
          notified: false,
          scheduledAssessment: created.scheduledAssessment,
          request: created.request,
          noteId: created.noteId,
          noteError: created.noteError,
          limitations: created.limitations,
          note: created.scheduledAssessment
            ? 'Created with requestCreate and an assessment schedule. notifyTeam is false. Nothing was emailed or texted.'
            : 'Created with requestCreate. No assessment was scheduled. Nothing was emailed or texted.',
        });
      }
      case 'create_note': {
        assertNoNotifyArgs(args);
        const note = await createNote(parseCreateNoteArgs(args), deps);
        return textResult({
          notified: false,
          target: note.target,
          id: note.id,
          noteId: note.noteId,
          message: note.message,
          note: 'Saved with the matching CreateNote mutation. Nothing was emailed or texted.',
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
          note: 'defaultUnitCost is catalog/street list, not internal cost. Use get_products for internalUnitCost, markup, and visible. Do not use this to invent 60% GP raises.',
        });
      }
      case 'get_products': {
        const result = await getProducts(parseGetProductsArgs(args), deps);
        return textResult({
          ...result,
          count: result.products.length,
          note: 'unitPrice is Jobber defaultUnitCost (street/default price). internalUnitCost is catalog cost. archived is true when visible is false; Jobber has no separate archived field. This does not edit the catalog.',
        });
      }
      case 'edit_product': {
        const result = await editProduct(parseEditProductArgs(args), deps);
        return textResult({
          ...result,
          note: result.dryRun
            ? 'dryRun: productsAndServicesEdit was not called. after is the projected row. Pass before.internalUnitCost, before.unitPrice, before.markup, and before.visible to edit_product to revert a later write. Nothing was deleted.'
            : result.mutated
              ? 'Updated one product with productsAndServicesEdit. after is a fresh read. Pass before.internalUnitCost, before.unitPrice, before.markup, and before.visible to edit_product to revert. Nothing was deleted.'
              : 'Catalog already matched. productsAndServicesEdit was not called. Nothing was deleted.',
        });
      }
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof ProductEditUserError) {
      return textResult(
        {
          error: error.message,
          userErrors: error.userErrors,
          before: error.before,
          after: null,
          mutated: false,
          dryRun: false,
          productId: error.productId,
        },
        true
      );
    }
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
      quoteSalespersonAnyStatus: true,
      sendsQuotes: false,
      sendsInvoices: false,
      invoiceMutations: true,
      productMutations: true,
      deletesProducts: false,
      jobMutations: true,
      clientMutations: true,
      requestMutations: true,
      visitMutations: true,
      emailsCustomers: false,
      notifiesClients: false,
      paymentOptionEdits: true,
      payroll: false,
      forbidden: [...FORBIDDEN_JOBBER_MCP_TOOLS],
    },
    durableTokenStore,
  };
}
