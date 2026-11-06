/**
 * QuickBooks Online write tool definitions for the Jobber MCP.
 * Preview is the default. confirm:true posts only when the sandbox gate is open.
 */
import type { McpToolDefinition, McpToolResult } from './protocol.ts';
import { runQboWrite, type QboWriteDeps } from '../quickbooks/durable-write.ts';
import { isQboWriteTool } from '../quickbooks/write-payloads.ts';

const confirm = {
  type: 'boolean',
  description: 'Default false (preview). true posts to the sandbox company. dryRun:false does not post. Do not set confirm and dryRun together.',
};
const requestId = {
  type: 'string',
  description: 'Idempotency key sent as Intuit requestid. Reuse it on retry. If omitted, the key is a hash of the tool and payload so an identical retry does not double-post.',
};

const writeProps = { confirm, requestId };

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): McpToolDefinition {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required,
      properties: { ...properties, ...writeProps },
    },
  };
}

export const QBO_WRITE_MCP_TOOLS: McpToolDefinition[] = [
  tool(
    'qbo_journal_entry',
    'Create or update a QuickBooks journal entry. Preview is the default and returns the exact JournalEntry body. confirm:true posts to the sandbox company only. Lines must balance. Pass id to update. Nothing is deleted; reverse a journal with another entry. Does not email.',
    {
      txnDate: { type: 'string', description: 'YYYY-MM-DD' },
      docNumber: { type: 'string' },
      privateNote: { type: 'string' },
      id: { type: 'string', description: 'Set to update an existing journal entry.' },
      syncToken: { type: 'string', description: 'Required for an exact update preview. confirm reads it when omitted.' },
      lines: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['postingType', 'amount', 'accountId'],
          properties: {
            postingType: { type: 'string', enum: ['Debit', 'Credit'] },
            amount: { type: 'number' },
            accountId: { type: 'string' },
            description: { type: 'string' },
            entityType: { type: 'string' },
            entityId: { type: 'string' },
          },
        },
      },
    },
    ['lines']
  ),
  tool(
    'qbo_deposit',
    'Create a QuickBooks deposit into a bank account. A line is either an account amount or an existing payment (paymentId) being deposited. Preview is the default. confirm:true posts to the sandbox company only. Does not delete.',
    {
      depositToAccountId: { type: 'string' },
      txnDate: { type: 'string' },
      privateNote: { type: 'string' },
      lines: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['amount'],
          properties: {
            amount: { type: 'number' },
            accountId: { type: 'string', description: 'Income or expense account when not depositing a payment.' },
            paymentId: { type: 'string', description: 'Existing payment to move out of Undeposited Funds.' },
            description: { type: 'string' },
            entityType: { type: 'string' },
            entityId: { type: 'string' },
          },
        },
      },
    },
    ['depositToAccountId', 'lines']
  ),
  tool(
    'qbo_payment',
    'Create a QuickBooks payment and apply it to one or more invoices. Preview is the default. confirm:true posts to the sandbox company only. totalAmt must equal the applications unless allowUnapplied is true. Does not email, and does not record a Jobber payment.',
    {
      customerId: { type: 'string' },
      totalAmt: { type: 'number' },
      txnDate: { type: 'string' },
      privateNote: { type: 'string' },
      paymentRefNum: { type: 'string' },
      depositToAccountId: { type: 'string', description: 'Omit to leave the payment in Undeposited Funds.' },
      allowUnapplied: { type: 'boolean' },
      applications: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['invoiceId', 'amount'],
          properties: { invoiceId: { type: 'string' }, amount: { type: 'number' } },
        },
      },
    },
    ['customerId', 'totalAmt', 'applications']
  ),
  tool(
    'qbo_invoice',
    'Create or update a QuickBooks invoice, including a DocNumber backfill when Jobber sync missed one. Preview is the default and returns the exact Invoice body. confirm:true posts to the sandbox company only. Never sets EmailStatus and never sends the invoice. Pass id to update. Does not delete.',
    {
      customerId: { type: 'string' },
      txnDate: { type: 'string' },
      dueDate: { type: 'string' },
      docNumber: { type: 'string', description: 'Jobber invoice number to store as DocNumber.' },
      privateNote: { type: 'string' },
      customerMemo: { type: 'string', description: 'Customer-facing memo. This does not email the customer.' },
      id: { type: 'string' },
      syncToken: { type: 'string' },
      lines: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['amount', 'itemId'],
          properties: {
            amount: { type: 'number' },
            itemId: { type: 'string' },
            description: { type: 'string' },
            quantity: { type: 'number' },
            unitPrice: { type: 'number' },
          },
        },
      },
    },
    []
  ),
  tool(
    'qbo_categorize_purchase',
    'Set the expense account on an existing QuickBooks purchase. Preview returns the line account changes. confirm:true reads the purchase and posts it back with those AccountRef values. Pass accountId for every account-based line, or lines: [{ lineId, accountId }]. Does not create or delete a purchase.',
    {
      id: { type: 'string' },
      accountId: { type: 'string' },
      privateNote: { type: 'string' },
      lines: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['lineId', 'accountId'],
          properties: { lineId: { type: 'string' }, accountId: { type: 'string' } },
        },
      },
    },
    ['id']
  ),
  tool(
    'qbo_bill',
    'Create or update a QuickBooks bill. Preview is the default. confirm:true posts to the sandbox company only. Pass id to update. Does not delete or pay the bill (use qbo_bill_payment to pay).',
    {
      vendorId: { type: 'string' },
      txnDate: { type: 'string' },
      dueDate: { type: 'string' },
      docNumber: { type: 'string' },
      privateNote: { type: 'string' },
      id: { type: 'string' },
      syncToken: { type: 'string' },
      lines: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['amount', 'accountId'],
          properties: {
            amount: { type: 'number' },
            accountId: { type: 'string' },
            description: { type: 'string' },
            customerId: { type: 'string' },
          },
        },
      },
    },
    []
  ),
  tool(
    'qbo_bill_payment',
    'Create a QuickBooks bill payment (check or credit card) and apply it to bills. Preview is the default. confirm:true posts to the sandbox company only. totalAmt must equal the applications. Does not delete.',
    {
      vendorId: { type: 'string' },
      totalAmt: { type: 'number' },
      payType: { type: 'string', enum: ['Check', 'CreditCard'] },
      bankAccountId: { type: 'string', description: 'Required when payType is Check.' },
      creditCardAccountId: { type: 'string', description: 'Required when payType is CreditCard.' },
      txnDate: { type: 'string' },
      privateNote: { type: 'string' },
      applications: {
        type: 'array',
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['billId', 'amount'],
          properties: { billId: { type: 'string' }, amount: { type: 'number' } },
        },
      },
    },
    ['vendorId', 'totalAmt', 'payType', 'applications']
  ),
  tool(
    'qbo_attach_note',
    'Attach a memo or note to a QuickBooks transaction. mode private_note (default) sets PrivateNote. mode customer_memo sets Invoice CustomerMemo and does not email. mode attachable creates an Attachable note with IncludeOnSend false. Preview is the default. confirm:true posts to the sandbox company only.',
    {
      entityType: { type: 'string' },
      entityId: { type: 'string' },
      note: { type: 'string' },
      mode: { type: 'string', enum: ['private_note', 'attachable', 'customer_memo'] },
      syncToken: { type: 'string' },
    },
    ['entityType', 'entityId', 'note']
  ),
  tool(
    'qbo_closing_date',
    'Set QuickBooks AccountingInfoPrefs.BookCloseDate (the books close date). Preview shows the sparse Preferences update. confirm:true reads Preferences and posts BookCloseDate to the sandbox company only. Intuit may reject the write; the error is returned and nothing else is changed. Does not close a period by deleting transactions.',
    { closeDate: { type: 'string', description: 'YYYY-MM-DD. The books are closed through this date.' } },
    ['closeDate']
  ),
  tool(
    'qbo_void',
    'Void a QuickBooks Invoice or Payment. Preview is the default. confirm:true posts operation=void to the sandbox company only. This is not a delete. Journal entries are reversed with qbo_journal_entry, not voided. reason is stored in the audit log.',
    {
      entityType: { type: 'string', enum: ['Invoice', 'Payment'] },
      entityId: { type: 'string' },
      syncToken: { type: 'string' },
      reason: { type: 'string' },
    },
    ['entityType', 'entityId', 'reason']
  ),
];

export async function callQboWriteTool(
  name: string,
  args: Record<string, unknown>,
  deps?: QboWriteDeps
): Promise<McpToolResult> {
  if (!isQboWriteTool(name)) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown QuickBooks tool: ${name}` }) }], isError: true };
  }
  const result = await runQboWrite(name, args, deps);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: result.ok ? undefined : true,
  };
}
