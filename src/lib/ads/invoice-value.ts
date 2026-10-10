/** Pre-tax invoice dollars. Drafts and voids are not revenue. */

const EXCLUDED_STATUS = new Set(['draft', 'void', 'bad_debt']);

export interface InvoiceAmountInput {
  invoiceStatus?: string | null;
  issuedDate?: string | null;
  amounts?: {
    subtotal?: number | null;
    total?: number | null;
    taxAmount?: number | null;
  } | null;
}

export function isIssuedInvoice(invoice: InvoiceAmountInput): boolean {
  const status = (invoice.invoiceStatus || '').trim().toLowerCase();
  if (!status) return Boolean(invoice.issuedDate);
  return !EXCLUDED_STATUS.has(status);
}

export function invoicePretaxUsd(invoice: InvoiceAmountInput): number | null {
  if (!isIssuedInvoice(invoice)) return null;
  const subtotal = invoice.amounts?.subtotal;
  if (typeof subtotal === 'number' && Number.isFinite(subtotal) && subtotal > 0) {
    return Math.round(subtotal * 100) / 100;
  }
  const total = invoice.amounts?.total;
  const tax = invoice.amounts?.taxAmount;
  if (
    typeof total === 'number' &&
    Number.isFinite(total) &&
    typeof tax === 'number' &&
    Number.isFinite(tax) &&
    tax >= 0 &&
    total - tax > 0
  ) {
    return Math.round((total - tax) * 100) / 100;
  }
  return null;
}

export function sumIssuedInvoicePretax(invoices: InvoiceAmountInput[] | null | undefined): number | null {
  const values = (invoices ?? [])
    .map((invoice) => invoicePretaxUsd(invoice))
    .filter((value): value is number => value != null && value > 0);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100;
}

export function bookJobValueUsd(input: {
  invoices?: InvoiceAmountInput[] | null;
  jobTotal?: number | null;
}): { valueUsd: number | null; valueSource: 'invoice_pretax' | 'job_total' | null } {
  const invoice = sumIssuedInvoicePretax(input.invoices);
  if (invoice != null && invoice > 0) {
    return { valueUsd: invoice, valueSource: 'invoice_pretax' };
  }
  if (typeof input.jobTotal === 'number' && Number.isFinite(input.jobTotal) && input.jobTotal > 0) {
    return { valueUsd: Math.round(input.jobTotal * 100) / 100, valueSource: 'job_total' };
  }
  return { valueUsd: null, valueSource: null };
}
