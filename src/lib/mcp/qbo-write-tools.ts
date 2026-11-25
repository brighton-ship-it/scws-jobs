/**
 * QuickBooks Online write tool definitions for the Jobber MCP.
 * Preview is the default. confirm:true posts to whatever environment the env vars select.
 */
import type { McpToolDefinition, McpToolResult } from './protocol.ts';
import { runRelinkDeposit } from '../quickbooks/deposit-relink.ts';
import { runQboWrite, writeRealmQuery, type QboWriteDeps } from '../quickbooks/durable-write.ts';
import { checkInvoiceRetax } from '../quickbooks/invoice-retax.ts';
import { checkItemTaxCategory } from '../quickbooks/item-tax-category.ts';
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

/** qbo_relink_deposit builds its own per-line keys and refuses a caller requestId. */
const NO_REQUEST_ID = new Set(['qbo_relink_deposit']);

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): McpToolDefinition {
  const shared: Record<string, unknown> = NO_REQUEST_ID.has(name) ? { confirm, batchId } : writeProps;
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required,
      properties: { ...properties, ...shared },
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
    'Create or update a QuickBooks invoice, including a DocNumber backfill when Jobber sync missed one. Preview is the default and returns the exact Invoice body. confirm:true posts to whatever environment the env vars select. Never sets EmailStatus and never sends the invoice. Pass id to update. totalTax with txnTaxCodeId and syncToken (update only, no lines) sparse-sets a tax override on TxnTaxDetail; confirm reads the invoice first so prior_state is audited and qbo_revert_batch restores the old tax, and refuses when the live SyncToken is not the one passed. retaxLineIds re-saves the live lines so QuickBooks recomputes tax with no override. After a totalTax or retaxLineIds write the saved invoice is checked: header TxnTaxCodeRef, the county rate that code must carry (4 San Diego, 25 Riverside, the other absent), and for retax NetAmountTaxable equal to the TAX lines. A difference returns ok:false with status tax_code_changed and taxCodeChanged reasons (the write did happen; read it back), and the audit row gets status tax_code_changed (still revertible). retaxLineIds refuses an invoice with any line other than sales and subtotal lines. cdtfaVerified with shipAddr and/or shipFromAddr (full postal address, no coordinates in the lines), or with reuseLiveAddress: true, sets TxnTaxDetail.UseAutomatedSalesTax false plus TxnTaxCodeRef to expectedTaxCodeId, so a Temecula mailing city cannot replace unincorporated Riverside code 23 with city code 29. reuseLiveAddress resends ShipAddr and ShipFromAddr exactly as read, so the address the customer sees does not change. Lines are not sent. Optional totalTax is an explicit amount on that same payload. The saved invoice must have that code, expectedTaxRateIds and no others, expectedTotalTax, no AST_TAX_OVERRIDE, and the same lines, or the result is ok:false with status tax_code_changed or tax_mismatch. Does not delete.',
    {
      customerId: { type: 'string' },
      txnDate: { type: 'string' },
      dueDate: { type: 'string' },
      docNumber: { type: 'string', description: 'Jobber invoice number to store as DocNumber.' },
      privateNote: { type: 'string' },
      customerMemo: { type: 'string', description: 'Customer-facing memo. This does not email the customer.' },
      id: { type: 'string' },
      syncToken: { type: 'string' },
      retaxLineIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Update only, with syncToken and txnTaxCodeId, without lines, totalTax or other fields. Re-saves the invoice so QuickBooks computes the tax itself (no override): resends the live Line array sparse with these line ids set TAX (their TaxClassificationRef is dropped, a harmless defensive step since QuickBooks takes the class from the item), plus the live ShipAddr/ShipFromAddr and TxnTaxCodeRef. Refused when a listed line item is not Taxable, the SyncToken changed, the invoice has no ShipFromAddr, or it has any line other than sales and subtotal lines (a sparse Line array would delete discount, description-only or group lines). If the saved code, county rate or NetAmountTaxable is not what was asked, the result is ok:false with status tax_code_changed.',
      },
      totalTax: { type: 'number', description: 'Under Automated Sales Tax QuickBooks prorates this over the code it assigns and may replace TxnTaxCodeRef (saved code is checked and flagged as taxCodeChanged); prefer retaxLineIds. Update only, without lines or privateNote, and requires syncToken. Sparse-sets TxnTaxDetail.TotalTax (a tax override) so the saved tax matches the billed tax. Confirm refuses when the live SyncToken differs. Lines and addresses stay as saved. On a cdtfaVerified ship-address update this is optional: it sets TotalTax on the partner tax code. Omit it so QuickBooks applies that code\'s rates. A TotalTax-only payload leaves AST_TAX_OVERRIDE and fails the ship-address post-check.' },
      txnTaxCodeId: { type: 'string', description: 'Required with totalTax: the TaxCode id to keep on TxnTaxDetail, for example 3.' },
      cdtfaVerified: { type: 'boolean', description: 'Required to pin expectedTaxCodeId with UseAutomatedSalesTax false. The caller has checked CDTFA that this jobsite is unincorporated even though the mailing city is a city QuickBooks geocodes inside city limits (Temecula). Pass shipAddr and/or shipFromAddr, or reuseLiveAddress.' },
      reuseLiveAddress: { type: 'boolean', description: 'With cdtfaVerified, resend ShipAddr and ShipFromAddr exactly as they were read. Do not pass shipAddr or shipFromAddr. The customer-visible address stays as it is; only the tax hold is applied.' },
      shipAddr: {
        type: 'object',
        additionalProperties: false,
        description: 'Ship-to postal address to resend in full. Line1, City, CountrySubDivisionCode, and PostalCode are required. No coordinates in the lines.',
        properties: {
          Line1: { type: 'string' },
          Line2: { type: 'string' },
          Line3: { type: 'string' },
          Line4: { type: 'string' },
          Line5: { type: 'string' },
          City: { type: 'string' },
          Country: { type: 'string' },
          CountrySubDivisionCode: { type: 'string' },
          PostalCode: { type: 'string' },
        },
      },
      shipFromAddr: {
        type: 'object',
        additionalProperties: false,
        description: 'Ship-from postal address, same shape as shipAddr. California district tax follows the ship-to address, so this alone does not remove a Temecula city rate.',
        properties: {
          Line1: { type: 'string' },
          Line2: { type: 'string' },
          Line3: { type: 'string' },
          Line4: { type: 'string' },
          Line5: { type: 'string' },
          City: { type: 'string' },
          Country: { type: 'string' },
          CountrySubDivisionCode: { type: 'string' },
          PostalCode: { type: 'string' },
        },
      },
      expectedTaxCodeId: { type: 'string', description: 'TaxCode the saved invoice must keep, for example 23 for unincorporated Riverside. Required with cdtfaVerified.' },
      expectedTaxRateIds: { type: 'array', items: { type: 'string' }, description: 'TaxRate ids that must be on the saved invoice and no others. Unincorporated Riverside is ["3","25","9"]. Rate 13 (Temecula city) fails the check.' },
      expectedTotalTax: { type: 'number', description: 'TotalTax the saved invoice must match, within one cent. 193.75 is 7.75 percent of a 2500 taxable amount (invoice total 34693.75 when the pre-tax total is 34500).' },
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
    'Set the sales tax category (TaxClassificationRef) and optionally the Taxable flag on one QuickBooks item. Sparse update; name, price, accounts and type are unchanged. Preview and confirm both refuse unless the class is on the QuickBooks TaxClassification list, the item Type is one the class applies to (Service classes such as EUC-99990202 for Service items, goods classes such as EUC-09020802 only for Inventory/NonInventory), and syncToken is the live one. confirm:true reads the item again (audited as prior_state, so qbo_revert_batch can restore it), refuses if the SyncToken or Type changed, and posts to whatever environment the env vars select. Affects new and resaved transactions that use the item.',
    {
      itemId: { type: 'string' },
      taxClassificationId: { type: 'string', description: 'Tax category id, for example EUC-99990202-V1-00020000 (Service marked taxable).' },
      taxable: { type: 'boolean' },
      syncToken: { type: 'string', description: 'The item SyncToken you read. Refused when QuickBooks has a different one.' },
    },
    ['itemId', 'taxClassificationId', 'syncToken']
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
    'Import Jobber invoices into QuickBooks one at a time. DocNumber is the invoice number. Customer and item match an explicit customerIds or itemIds entry, otherwise one exact DisplayName or Name. More than one match blocks that invoice. createCustomers:true creates a missing customer. Discounts become a negative line. Payment date and amount come from the Jobber payment record when one exists. payments: payout groups those payments into a new deposit with an optional fee line (feeAmount, feeAccountId, depositToAccountId). taxOverride:true sets TotalTax to the Jobber tax. Negative taxable lines are sent as NON so QuickBooks does not reject them. The preview reports CustomerMemo length and whether it was cut at 1,000 characters. Queries run sequentially and back off on HTTP 429. Header tax is a TaxCode id (San Diego County 3, Menifee 30, Murrieta 25, La Quinta 59, Desert Hot Springs 34, Indio 35, other Riverside County places 23, San Bernardino County unincorporated 31, Yucaipa 46, San Bernardino city 55). A Temecula mailing address is geocoded to city code 29 (rate 13) even with a house number; Murrieta and Hemet unincorporated addresses stay on 23. cdtfaVerifiedCities sets UseAutomatedSalesTax false so the requested code and its rates are kept. A taxCodeByCity entry only overrides the code and leaves Automated Sales Tax on. The saved invoice for a CDTFA-verified city must then match that code, the rate set for that code (23 is 3/9/25 and not 13), Jobber TotalTax, and must not be AST_TAX_OVERRIDE. ShipAddr and ShipFromAddr are the Jobber property address (structured, FreeFormAddress false) so Automated Sales Tax uses the jobsite instead of the company address. An invoice with no property street, city, and postal code is blocked, and so is an invoice whose jobs use different properties. PrivateNote on a create includes [batch:<batchId>] once when batchId is set. County rates are fixed ids, 4 for San Diego County, 25 for Riverside County and 26 for San Bernardino County, because TaxRate names are hashes. Preview blocks with ok false when those ids cannot be checked against TaxCode 3, 23 and 31, and nothing is posted. Confirm requires the jobsite county rate (4, 25 or 26) on the saved tax lines and the other county ids to be absent, and TotalTax within $0.01 of the Jobber tax. A mismatch stops the chunk before payments and writes audit status tax_mismatch. Each call processes at most 10 invoices and returns nextCursor. Skips a DocNumber that already exists. confirm:true posts the chunk to whatever environment the env vars select (the configured write target, production when QBO_WRITE_ENVIRONMENT=production) and requires batchId. Does not email.',
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
      discountItemId: { type: 'string', description: 'QuickBooks item for the Jobber discount line. Defaults to the one active item named Discount (any case), then the first positive line item.' },
      txnTaxCodeId: { type: 'string', description: 'TaxCode id applied to every invoice in this call, for example 3. Looked up by id, not by name.' },
      taxCodeByCity: {
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'City to TaxCode id overrides, for example {"Anza":"23","San Marcos":"40","Wildomar":"33"}. This only changes the header code that is sent. Automated Sales Tax stays on, so an already-working preview is unchanged. To keep the code against AST, pass the city in cdtfaVerifiedCities.',
      },
      cdtfaVerifiedCities: {
        type: 'array',
        items: { type: 'string' },
        description: 'Mailing cities verified with CDTFA as unincorporated. Those invoices are created with UseAutomatedSalesTax false and the city tax code (taxCodeByCity or the default map). Temecula needs this. Murrieta and Hemet unincorporated addresses do not.',
      },
    },
    []
  ),
  tool(
    'qbo_relink_deposit',
    'Replace one deposit line that posts to an income account (4010 Sales) with a ReceivePayment of the same amount applied to an invoice, then link that payment on the deposit. The deposit total does not change, so the bank reconciliation stays, and the invoice is the only income. Preview is the default and does not read QuickBooks. confirm:true posts to whatever environment the env vars select and requires batchId. qbo_revert_batch restores the deposit, then deletes the payment. salesAccountId is the QuickBooks account id. Pass lineId when more than one line has that amount. Each relink gets its own Intuit requestid built from the batch, deposit, line, invoice, customer and amount, so several relinks on one deposit do not replay each other. requestId is not accepted. Retries must pass identical arguments: lineId and salesAccountId are part of the key, so adding, dropping or changing either one gives a new key. Before creating the payment it refuses when the invoice already has a payment for that amount and customer that is not on a deposit. After the payment is created it must match the requested amount, customer and invoice, and the saved deposit must have a higher SyncToken and link the new payment, or the call throws.',
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
    'Undo one batchId. Preview lists the steps. confirm:true posts those undos to whatever environment the env vars select. It restores modified entities from the audited prior state, then deletes payments this batch created, then deletes the other created entities. It uses the ok audit rows for that batch. A pending row is the pre-write intent, not a second write, and a refused row did not post. It does not delete anything the batch did not create. It skips voids and transactions on or before the books close date, and reports those in couldNot. A transaction row with no TxnDate is dated from the live entity before that check. Items and other non-transaction entities are not refused for a missing date. When two ok rows created the same QuickBooks id (a replayed response), it deletes that entity once and lists the extra row in duplicates. A row with status unknown (the post was sent, no response came back) may have posted and is reported in couldNot, never treated as failed.',
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
  if (name === 'qbo_invoice' && (args.reuseLiveAddress === true || (typeof args.reuseLiveAddress === 'string' && args.reuseLiveAddress.trim().toLowerCase() === 'true'))) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    if (!/^\d+$/.test(id)) {
      const refused = { ok: false, dryRun: true, wrote: false, refused: true, error: 'id must be a QuickBooks invoice id.' };
      return { content: [{ type: 'text', text: JSON.stringify(refused, null, 2) }], isError: true };
    }
    const query = deps?.qboQuery || ((sql: string) => writeRealmQuery(sql, deps || {}));
    const json = (await query(`select * from Invoice where Id = '${id}'`)) as { QueryResponse?: { Invoice?: unknown } };
    const list = json?.QueryResponse?.Invoice;
    const rows = Array.isArray(list) ? list : list ? [list] : [];
    const invoice = rows.find((row) => String((row as { Id?: unknown })?.Id) === id) as Record<string, unknown> | undefined;
    if (!invoice) {
      const refused = { ok: false, dryRun: true, wrote: false, refused: true, error: `Invoice ${id} was not found in QuickBooks.` };
      return { content: [{ type: 'text', text: JSON.stringify(refused, null, 2) }], isError: true };
    }
    args = { ...args, liveInvoice: invoice };
  }
  if (name === 'qbo_invoice' && Array.isArray(args.retaxLineIds)) {
    // The body is built from the live invoice, so the preview shows exactly what confirm will send.
    const checked = await checkInvoiceRetax(args, deps);
    if (!checked.ok) {
      const refused = { ok: false, dryRun: true, wrote: false, refused: true, error: checked.error };
      return { content: [{ type: 'text', text: JSON.stringify(refused, null, 2) }], isError: true };
    }
    args = { ...args, liveInvoice: checked.invoice };
  }
  if (name === 'qbo_item_tax_category') {
    // Checked against the live TaxClassification list and item Type on preview and confirm.
    const checked = await checkItemTaxCategory(args, deps);
    if (!checked.ok) {
      const refused = { ok: false, dryRun: true, wrote: false, refused: true, error: checked.error };
      return { content: [{ type: 'text', text: JSON.stringify(refused, null, 2) }], isError: true };
    }
    args = { ...args, applicableTo: checked.applicableTo };
  }
  const result = await runQboWrite(name, args, deps);
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    isError: result.ok ? undefined : true,
  };
}
