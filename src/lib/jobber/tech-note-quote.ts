import {
  createUnsentQuote,
  fetchTaxRates,
  findBrightonSalespersonId,
  findLiveQuoteForJob,
  loadJobByIdOrNumber,
  type JobberDeps,
  type JobberQuoteSummary,
} from './quotes.ts';
import {
  assertShopBookLines,
  buildPullAndEvalLines,
  buildReplaceMotorLine,
  customerMessageForTechNote,
  inferTechNoteKind,
  mentionsServiceCallCredit,
  PULL_AND_EVAL_TITLE,
  REPLACE_TITLE,
  type QuoteLineDraft,
} from './shop-book.ts';
import { assignShop, motorBrandForShop } from './shops.ts';
import { resolveJobberTax } from './tax.ts';

export type TechNoteQuoteInput = {
  jobNumber?: string | number | null;
  jobId?: string | null;
  techNotes?: string | null;
  kind?: 'pull_and_eval' | 'replace';
};

export type TechNoteQuoteResult = {
  success: true;
  draft: true;
  sentAt: null;
  reused: boolean;
  quote: JobberQuoteSummary;
  client: { id: string; name: string | null };
  job: { id: string; jobNumber: string | number | null };
  tax: { county: string; taxRateId: string | null; name: string | null };
  shop: 'ramona' | 'anza';
  motorBrand: 'Franklin' | 'CentriPro' | null;
  lineItems: QuoteLineDraft[];
  customerMessage: string;
};

export async function createTechNoteQuote(
  input: TechNoteQuoteInput,
  deps?: JobberDeps
): Promise<TechNoteQuoteResult> {
  const job = await loadJobByIdOrNumber(
    { jobId: input.jobId, jobNumber: input.jobNumber },
    deps
  );
  const client = job.client;
  if (!client?.id) {
    throw new Error('Jobber job has no client — refusing to create a client');
  }

  const existing = findLiveQuoteForJob(job.quotes?.nodes, job);
  if (existing) {
    return {
      success: true,
      draft: true,
      sentAt: null,
      reused: true,
      quote: existing,
      client: { id: client.id, name: client.name ?? null },
      job: { id: job.id, jobNumber: job.jobNumber ?? null },
      tax: { county: 'unknown', taxRateId: null, name: null },
      shop: assignShop(job.property?.address?.city),
      motorBrand: null,
      lineItems: [],
      customerMessage: '',
    };
  }

  const kind = input.kind || inferTechNoteKind(input.techNotes);
  const city = job.property?.address?.city || null;
  const shop = assignShop(city);
  const motorBrand = kind === 'replace' ? motorBrandForShop(shop) : null;
  const lineItems = buildPullAndEvalLines();
  if (kind === 'replace' && motorBrand) {
    lineItems.push(buildReplaceMotorLine(motorBrand));
  }
  assertShopBookLines(lineItems);

  const message = customerMessageForTechNote(kind, motorBrand || undefined);
  if (mentionsServiceCallCredit(message)) {
    throw new Error('Customer message must not mention the $200 service call');
  }

  const [rates, salespersonId] = await Promise.all([
    fetchTaxRates(deps),
    findBrightonSalespersonId(deps),
  ]);
  const tax = resolveJobberTax({
    city,
    rates,
    laborOnly: kind === 'pull_and_eval',
    env: deps?.env,
  });

  const title = kind === 'replace' ? REPLACE_TITLE : PULL_AND_EVAL_TITLE;
  const quote = await createUnsentQuote(
    {
      clientId: client.id,
      propertyId: job.property?.id,
      title: job.jobNumber != null ? `${title} (job ${job.jobNumber})` : title,
      message,
      salespersonId,
      taxRateId: tax.taxRateId,
      lineItems,
    },
    deps
  );

  return {
    success: true,
    draft: true,
    sentAt: null,
    reused: false,
    quote,
    client: { id: client.id, name: client.name ?? null },
    job: { id: job.id, jobNumber: job.jobNumber ?? null },
    tax: { county: tax.county, taxRateId: tax.taxRateId, name: tax.name },
    shop,
    motorBrand,
    lineItems,
    customerMessage: message,
  };
}
