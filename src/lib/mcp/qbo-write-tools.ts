/**
 * QuickBooks Online write tool definitions for the Jobber MCP.
 * Preview is the default. confirm:true posts to whatever environment the env vars select.
 */
import type { McpToolDefinition, McpToolResult } from './protocol.ts';
import { runRelinkDeposit } from '../quickbooks/deposit-relink.ts';
import { runQboWrite, type QboWriteDeps } from '../quickbooks/durable-write.ts';
import { runJobberInvoiceImport } from '../quickbooks/jobber-invoice-import.ts';
import { runBatchRevert } from '../quickbooks/revert-batch.ts';
import { isQboWriteTool } from '../quickbooks/write-payloads.ts';

const confirm = {
  type: 'boolean',
  description: 'Default false (preview). true posts to whatever environment the env vars select. dryRun:false does not post. Do not set confirm and dryRun together.',
};
const requestId = {
  type: 'string',
  description: 'Idempotency key sent as Intuit requestid. Reuse it on retry. If omitted, the key is a hash of the tool and payload so an identical retry does not double-post.',
};
const batchId = {
  type: 'string',
  description: 'Groups this write so qbo_revert_batch can undo it. Required on confirm for an import.',
};

const writeProps = { confirm, requestId, batchId };

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
    'Create or update a QuickBooks journal entry. Preview is the default and returns the exact JournalEntry body. confirm:true posts to whatever environment the env vars select. Lines must balance. Pass id to update. Nothing is deleted; reverse a journal with another entry. Does not email.',
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
    'Create a QuickBooks deposit into a bank account. A line is either an account amount or an existing payment (paymentId) being deposited. A negative account amount is a fee line, such as a Jobber card or ACH fee, so the deposit total can match a net payout. Preview is the default. confirm:true posts to whatever environment the env vars select. Does not delete.',
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
    'Create a QuickBooks payment and apply it to one or more invoices. Preview is the default. confirm:true posts to whatever environment the env vars select. Pass txnDate for the payment date. totalAmt must equal the applications unless allowUnapplied is true. Does not email, and does not record a Jobber payment.',
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
    'Create or update a QuickBooks invoice, including a DocNumber backfill when Jobber sync missed one. Preview is the default and returns the exact Invoice body. confirm:true posts to whatever environment the env vars select. Never sets EmailStatus and never sends the invoice. Pass id to update. totalTax with txnTaxCodeId (update only, no lines) sparse-sets a tax override on TxnTaxDetail; confirm reads the invoice first so prior_state is audited and qbo_revert_batch restores the old tax. Does not delete.',
    {
      customerId: { type: 'string' },
      txnDate: { type: 'string' },
      dueDate: { type: 'string' },
      docNumber: { type: 'string', description: 'Jobber invoice number to store as DocNumber.' },
      privateNote: { type: 'string' },
      customerMemo: { type: 'string', description: 'Customer-facing memo. This does not email the customer.' },
      id: { type: 'string' },
      syncToken: { type: 'string' },
      totalTax: { type: 'number', description: 'Update only, without lines. Sparse-sets TxnTaxDetail.TotalTax (a tax override) so the saved tax matches the billed tax. Lines, addresses and the tax code stay as saved.' },
      txnTaxCodeId: { type: 'string', description: 'Required with totalTax: the TaxCode id to keep on TxnTaxDetail, for example 3.' },
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
    'Set the expense account on an existing QuickBooks purchase. Preview is the default and returns the line account changes. confirm:true reads the purchase and posts those AccountRef values to whatever environment the env vars select. Pass accountId for every account-based line, or lines: [{ lineId, accountId }]. Does not create or delete a purchase.',
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
    'Create or update a QuickBooks bill. Preview is the default. confirm:true posts to whatever environment the env vars select. Pass id to update. Does not delete or pay the bill (use qbo_bill_payment to pay).',
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
    'Create a QuickBooks bill payment (check or credit card) and apply it to bills. Preview is the default. confirm:true posts to whatever environment the env vars select. totalAmt must equal the applications. Does not delete.',
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
    'Attach a memo or note to a QuickBooks transaction. mode private_note (default) sets PrivateNote. mode customer_memo sets Invoice CustomerMemo and does not email. mode attachable creates an Attachable note with IncludeOnSend false. Preview is the default. confirm:true posts to whatever environment the env vars select.',
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
    'Set QuickBooks AccountingInfoPrefs.BookCloseDate (the books close date). Preview shows the sparse Preferences update. confirm:true reads Preferences and posts BookCloseDate to whatever environment the env vars select. Intuit may reject the write; the error is returned and nothing else is changed. Does not close a period by deleting transactions.',
    { closeDate: { type: 'string', description: 'YYYY-MM-DD. The books are closed through this date.' } },
    ['closeDate']
  ),
  tool(
    'qbo_item_tax_category',
    'Set the sales tax category (TaxClassificationRef) and optionally the Taxable flag on one QuickBooks item. Sparse update; name, price, accounts and type are unchanged. Preview is the default. confirm:true reads the item (audited as prior_state, so qbo_revert_batch can restore it) and posts to whatever environment the env vars select. Affects new and resaved transactions that use the item.',
    {
      itemId: { type: 'string' },
      taxClassificationId: { type: 'string', description: 'Tax category id, for example EUC-09020802-V1-00120000.' },
      taxable: { type: 'boolean' },
    },
    ['itemId', 'taxClassificationId']
  ),
  tool(
    'qbo_void',
    'Void a QuickBooks Invoice or Payment. Preview is the default. confirm:true posts operation=void to whatever environment the env vars select. This is not a delete. Journal entries are reversed with qbo_journal_entry, not voided. reason is stored in the audit log.',
    {
      entityType: { type: 'string', enum: ['Invoice', 'Payment'] },
      entityId: { type: 'string' },
      syncToken: { type: 'string' },
      reason: { type: 'string' },
    },
    ['entityType', 'entityId', 'reason']
  ),
  tool(
    'qbo_import_jobber_invoices',
    'Import Jobber invoices into QuickBooks one at a time. DocNumber is the invoice number. Customer and item match an explicit customerIds or itemIds entry, otherwise one exact DisplayName or Name. More than one match blocks that invoice. createCustomers:true creates a missing customer. Discounts become a negative line. Payment date and amount come from the Jobber payment record when one exists. payments: payout groups those payments into a new deposit with an optional fee line (feeAmount, feeAccountId, depositToAccountId). taxOverride:true sets TotalTax to the Jobber tax. Negative taxable lines are sent as NON so QuickBooks does not reject them. The preview reports CustomerMemo length and whether it was cut at 1,000 characters. Queries run sequentially and back off on HTTP 429. Header tax is a TaxCode id (San Diego County 3, Menifee 30, other Riverside County cities 65). ShipAddr and ShipFromAddr are the Jobber property address (structured, FreeFormAddress false) so Automated Sales Tax uses the jobsite instead of the company address. An invoice with no property street, city, and postal code is blocked, and so is an invoice whose jobs use different properties. PrivateNote on a create includes [batch:<batchId>] once when batchId is set. County rates are fixed ids, 4 for San Diego County and 25 for Riverside County, because TaxRate names are hashes. Preview blocks with ok false when those ids cannot be checked against TaxCode 3 and TaxCode 23, and nothing is posted. Confirm requires rate 4 or 25 to be present on the saved tax lines and the other county id to be absent, and TotalTax within $0.01 of the Jobber tax. A mismatch stops the chunk before payments and writes audit status tax_mismatch. Each call processes at most 10 invoices and returns nextCursor. Skips a DocNumber that already exists. confirm:true posts the chunk to whatever environment the env vars select (the configured write target, production when QBO_WRITE_ENVIRONMENT=production) and requires batchId. Does not email.',
    {
      invoiceNumbers: { type: 'array', items: { type: 'string' }, maxItems: 500 },
      fromInvoice: { type: 'integer' },
      toInvoice: { type: 'integer' },
      cursor: { type: 'string', description: 'nextCursor from the previous chunk. Inclusive invoice number to start at.' },
      limit: { type: 'integer', description: 'Invoices to process this call. Default 8, max 10.' },
      payments: { type: 'string', enum: ['none', 'undeposited', 'deposit', 'payout'] },
      depositId: { type: 'string', description: 'Existing QBO deposit to attach new payments to. Required when payments is deposit. Use qbo_relink_deposit when that deposit already credits 4010 Sales.' },
      depositToAccountId: { type: 'string', description: 'Bank account for payments: payout.' },
      payoutDate: { type: 'string', description: 'YYYY-MM-DD for the payout deposit. Defaults to the latest payment date in the chunk.' },
      feeAmount: { type: 'number', description: 'Jobber card or ACH fee subtracted on the payout deposit. Requires feeAccountId.' },
      feeAccountId: { type: 'string', description: 'Expense account for the payout fee line.' },
      taxOverride: { type: 'boolean', description: 'Set TxnTaxDetail.TotalTax to the Jobber tax amount so the tax matches to the cent.' },
      createCustomers: { type: 'boolean', description: 'Create a QuickBooks customer when the exact DisplayName is missing. Does not guess among several matches.' },
      customerIds: { type: 'object', additionalProperties: { type: 'string' }, description: 'Jobber client name to QuickBooks customer id. Skips the name lookup for those clients.' },
      itemIds: { type: 'object', additionalProperties: { type: 'string' }, description: 'Jobber line name to QuickBooks item id. Skips the name lookup for those items.' },
      discountItemId: { type: 'string', description: 'QuickBooks item for the Jobber discount line. Defaults to an item named Discount, then the first positive line item.' },
      txnTaxCodeId: { type: 'string', description: 'TaxCode id applied to every invoice in this call, for example 3. Looked up by id, not by name.' },
      taxCodeByCity: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'City to TaxCode id overrides, for example {"Hemet":"65","Phelan":"62"}.',
      },
    },
    []
  ),
  tool(
    'qbo_relink_deposit',
    'Replace one deposit line that posts to an income account (4010 Sales) with a ReceivePayment of the same amount applied to an invoice, then link that payment on the deposit. The deposit total does not change, so the bank reconciliation stays, and the invoice is the only income. Preview is the default and does not read QuickBooks. confirm:true posts to whatever environment the env vars select and requires batchId. qbo_revert_batch restores the deposit, then deletes the payment. salesAccountId is the QuickBooks account id. Pass lineId when more than one line has that amount.',
    {
      depositId: { type: 'string' },
      lineId: { type: 'string', description: 'Deposit line id to remove. Optional when amount and salesAccountId match one line.' },
      salesAccountId: { type: 'string', description: 'QuickBooks account id of the income line to remove, such as 4010 Sales.' },
      amount: { type: 'number' },
      invoiceId: { type: 'string' },
      customerId: { type: 'string' },
      txnDate: { type: 'string', description: 'YYYY-MM-DD payment date.' },
      paymentRefNum: { type: 'string' },
      privateNote: { type: 'string' },
    },
    ['depositId', 'amount', 'invoiceId', 'customerId', 'txnDate']
  ),
  tool(
    'qbo_revert_batch',
    'Undo one batchId. Preview lists the steps. confirm:true posts those undos to whatever environment the env vars select. It restores modified entities from the audited prior state, then deletes payments this batch created, then deletes the other created entities. It uses the ok audit rows for that batch. A pending row is the pre-write intent, not a second write, and a refused row did not post. It does not delete anything the batch did not create. It skips voids and anything on or before the books close date, and reports those in couldNot.',
    {},
    ['batchId']
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
  if (name === 'qbo_revert_batch') {
    const result = await runBatchRevert(args, deps);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result.ok === false };
  }
  if (name === 'qbo_import_jobber_invoices') {
    const result = await runJobberInvoiceImport(args, deps);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result.ok === false };
  }
  if (name === 'qbo_relink_deposit') {
    const result = await runRelinkDeposit(args, deps);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: result.ok === false };
  }
  const result = await runQboWrite(name, args, deps);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: result.ok ? undefined : true,
  };
}
