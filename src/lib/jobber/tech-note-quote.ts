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
  buildPressureTankLines,
  buildPullAndEvalLines,
  buildReplaceMotorLine,
  customerMessageForTechNote,
  mentionsServiceCallCredit,
  ELECTRICAL_TITLE,
  PRESSURE_TANK_TITLE,
  PULL_AND_EVAL_TITLE,
  REPLACE_TITLE,
  type QuoteLineDraft,
} from './shop-book.ts';
import { assignShop, motorBrandForShop } from './shops.ts';
import { resolveJobberTax } from './tax.ts';
import {
  requireTechNoteIntent,
  type IntentGuess,
  type ParsedEquipment,
  type TechNoteKind,
  UnclearTechNoteIntentError,
} from './tech-note-intent.ts';

export type TechNoteQuoteInput = {
  jobNumber?: string | number | null;
  jobId?: string | null;
  techNotes?: string | null;
  kind?: TechNoteKind | 'replace';
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
  intent: TechNoteKind;
  motorBrand: 'Franklin' | 'CentriPro' | null;
  equipment: ParsedEquipment;
  guesses: IntentGuess[];
  lineItems: QuoteLineDraft[];
  customerMessage: string;
};

export { UnclearTechNoteIntentError };

function titleForIntent(kind: TechNoteKind): string {
  if (kind === 'pressure_tank') return PRESSURE_TANK_TITLE;
  if (kind === 'pump_replace') return REPLACE_TITLE;
  if (kind === 'electrical') return ELECTRICAL_TITLE;
  return PULL_AND_EVAL_TITLE;
}

function linesForIntent(
  kind: TechNoteKind,
  shop: 'ramona' | 'anza',
  equipment: ParsedEquipment
): { lineItems: QuoteLineDraft[]; motorBrand: 'Franklin' | 'CentriPro' | null } {
  if (kind === 'pressure_tank') {
    if (equipment.tankGallons != null && equipment.tankGallons !== 86) {
      throw new UnclearTechNoteIntentError(
        [
          {
            kind: 'pressure_tank',
            confidence: 0.9,
            reason: `Named ${equipment.tankGallons}-gal tank; shop book only prices the 86-gal Promax PM260 at $1370`,
          },
        ],
        equipment
      );
    }
    return {
      lineItems: buildPressureTankLines({ includeHoist: equipment.pulledWell }),
      motorBrand: null,
    };
  }

  if (kind === 'pump_replace') {
    const motorBrand = motorBrandForShop(shop);
    return {
      lineItems: [
        buildReplaceMotorLine(motorBrand, {
          hp: equipment.hp,
          volts: equipment.volts,
          phase: equipment.phase,
        }),
      ],
      motorBrand,
    };
  }

  if (kind === 'pull_and_eval') {
    return { lineItems: buildPullAndEvalLines(), motorBrand: null };
  }

  throw new UnclearTechNoteIntentError(
    [
      {
        kind,
        confidence: 0.5,
        reason: 'Recognized this intent but have no shop-book kit to price a draft',
      },
    ],
    equipment
  );
}

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
      intent: 'other',
      motorBrand: null,
      equipment: {
        hp: null,
        volts: null,
        phase: null,
        amps: null,
        ampsNormal: null,
        tankGallons: null,
        tankModel: null,
        pulledWell: false,
      },
      guesses: [],
      lineItems: [],
      customerMessage: '',
    };
  }

  const parsed = requireTechNoteIntent({
    techNotes: input.techNotes,
    jobTitle: job.title,
    kind: input.kind,
  });

  const city = job.property?.address?.city || null;
  const shop = assignShop(city);
  const { lineItems, motorBrand } = linesForIntent(parsed.kind, shop, parsed.equipment);
  assertShopBookLines(lineItems);

  if (parsed.kind === 'pressure_tank') {
    if (lineItems.some((line) => /hoist/i.test(line.name)) && !parsed.equipment.pulledWell) {
      throw new Error('Hoist is not allowed on a tank swap unless the well was pulled');
    }
    if (lineItems.some((line) => /pump|motor|BT2/i.test(line.name))) {
      throw new Error('Pressure-tank swap must not add a pump, motor, or BT2 pull');
    }
  }

  const message = customerMessageForTechNote(parsed.kind, {
    motorBrand: motorBrand || undefined,
    hp: parsed.equipment.hp,
    volts: parsed.equipment.volts,
    phase: parsed.equipment.phase,
  });
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
    laborOnly: parsed.kind === 'pull_and_eval',
    env: deps?.env,
  });

  const title = titleForIntent(parsed.kind);
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
    intent: parsed.kind,
    motorBrand,
    equipment: parsed.equipment,
    guesses: parsed.guesses,
    lineItems,
    customerMessage: message,
  };
}
