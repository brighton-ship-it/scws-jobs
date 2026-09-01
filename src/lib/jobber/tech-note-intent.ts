/**
 * First-match tech-note parser from the live Jobber street book
 * (1,307 quotes + 248 tech notes). Do not default to $600 BT2.
 */

export type TechNoteKind =
  | 'pull_and_eval'
  | 'pressure_tank'
  | 'pump_replace'
  | 'controls'
  | 'electrical'
  | 'other';

export type IntentGuess = {
  kind: TechNoteKind;
  confidence: number;
  reason: string;
};

export type ParsedEquipment = {
  hp: number | null;
  volts: number | null;
  phase: 1 | 3 | null;
  amps: number | null;
  ampsNormal: boolean | null;
  tankGallons: number | null;
  tankModel: string | null;
  pulledWell: boolean;
  gpm: number | null;
  depthFt: number | null;
};

export type ParsedTechNote = {
  kind: TechNoteKind;
  confidence: number;
  guesses: IntentGuess[];
  equipment: ParsedEquipment;
  unclear: boolean;
  corpus: string;
  doNotQuote: TechNoteDoNotQuoteReason | null;
};

export type TechNoteDoNotQuoteReason = 'service_call_ticket' | 'precharge_only' | 'warranty';

export class UnclearTechNoteIntentError extends Error {
  readonly code = 'unclear_intent' as const;
  readonly guesses: IntentGuess[];
  readonly equipment: ParsedEquipment;

  constructor(guesses: IntentGuess[], equipment: ParsedEquipment) {
    super(
      'Could not determine quote type from tech notes or job title. Pass kind or add pull/eval, pressure-tank, or pump-replace language.'
    );
    this.name = 'UnclearTechNoteIntentError';
    this.guesses = guesses;
    this.equipment = equipment;
  }
}

export class TechNoteDoNotQuoteError extends Error {
  readonly code = 'do_not_quote' as const;
  readonly reason: TechNoteDoNotQuoteReason;
  readonly equipment: ParsedEquipment;

  constructor(reason: TechNoteDoNotQuoteReason, message: string, equipment: ParsedEquipment) {
    super(message);
    this.name = 'TechNoteDoNotQuoteError';
    this.reason = reason;
    this.equipment = equipment;
  }
}

const GPM_RE = /\b(\d+(?:\.\d+)?)\s*(?:gpm|gal(?:lon)?s?\s*per\s*min)\b/i;
const DEPTH_RE = /\b(\d{2,4})\s*(?:ft|feet|'|′)\b/i;

/** 2hp 230V 1ph FLA is typically ~10–13A. 11.7A is normal — not a failed motor. */
export function isNormalMotorAmps(
  hp: number | null,
  volts: number | null,
  phase: 1 | 3 | null,
  amps: number | null
): boolean | null {
  if (hp == null || volts == null || phase == null || amps == null) return null;
  if (hp === 2 && volts === 230 && phase === 1) {
    return amps >= 10 && amps <= 14;
  }
  if (hp === 1 && volts === 230 && phase === 1) {
    return amps >= 6 && amps <= 10;
  }
  if (hp === 1.5 && volts === 230 && phase === 1) {
    return amps >= 8 && amps <= 12;
  }
  if (hp === 3 && volts === 230 && phase === 1) {
    return amps >= 12 && amps <= 20;
  }
  return amps > 0 && amps < 20;
}

export function parseEquipment(text: string): ParsedEquipment {
  const hpMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hp|h\.p\.|horse)\b/i);
  const voltMatch = text.match(/\b(115|120|230|240|460)\s*(?:v|volt|volts)?\b/i);
  const ampMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:a|amp|amps|ampere)/i);
  const threePhase = /\b(3[\s-]?ph|three[\s-]?phase)\b/i.test(text);
  const singlePhase = /\b(1[\s-]?ph|single[\s-]?phase)\b/i.test(text);
  const galMatch = text.match(/\b(\d{2,3})\s*-?\s*(?:gal|gallon)/i);
  const modelMatch = text.match(/\b(pm\s*-?\s*\d{2,3})\b/i);
  const gpmMatch = text.match(GPM_RE);
  const depthMatch = text.match(DEPTH_RE);
  const pulledWell =
    /\b(out of the well|pulled (the )?(well|pump)|pump is out|well is pulled|already (out|pulled)|set[\s-]?only)\b/i.test(
      text
    );

  const hp = hpMatch ? Number(hpMatch[1]) : null;
  const volts = voltMatch ? Number(voltMatch[1]) : null;
  const amps = ampMatch ? Number(ampMatch[1]) : null;
  const phase: 1 | 3 | null = threePhase ? 3 : singlePhase ? 1 : null;
  const tankModel = modelMatch
    ? modelMatch[1].replace(/\s+/g, '').toUpperCase().replace('PM', 'PM')
    : null;
  const gpm = gpmMatch ? Number(gpmMatch[1]) : null;
  const depthFt = depthMatch ? Number(depthMatch[1]) : null;

  return {
    hp: Number.isFinite(hp) ? hp : null,
    volts: Number.isFinite(volts) ? volts : null,
    phase,
    amps: Number.isFinite(amps) ? amps : null,
    ampsNormal: isNormalMotorAmps(
      Number.isFinite(hp) ? hp : null,
      Number.isFinite(volts) ? volts : null,
      phase,
      Number.isFinite(amps) ? amps : null
    ),
    tankGallons: galMatch ? Number(galMatch[1]) : tankModel === 'PM260' ? 86 : null,
    tankModel,
    pulledWell,
    gpm: Number.isFinite(gpm) && gpm != null && gpm > 0 ? gpm : null,
    depthFt: Number.isFinite(depthFt) && depthFt != null && depthFt >= 20 && depthFt <= 2000 ? depthFt : null,
  };
}

function ampsAreNormal(equipment: ParsedEquipment): boolean {
  if (equipment.ampsNormal === false) return false;
  return true;
}

function isGoodToGoOrOnSiteFix(corpus: string): boolean {
  if (
    /\bgood\s+to\s+go\b|\ball\s+good\b|\bworking\s+now\b|\bno\s+further\s+work\b|\bfixed\s+on\s+site\b|\brepaired\s+on\s+site\b/i.test(
      corpus
    )
  ) {
    return true;
  }
  const onSitePart =
    /\b(?:well\s+)?cap\b|\b40\s*\/\s*60\b|\bpressure\s+switch\b|\bgauge\b|\bpump\s*saver\b/i.test(corpus);
  const replaced =
    /\breplaced\b|\binstalled\b|\bchanged\b|\bswapped\b|\bput\s+(?:a\s+)?new\b/i.test(corpus);
  const biggerJob =
    /\bpinhole\b|\btank\s+leak|\bleaking\s+tank|\bwaterlogged\b|\bshort\s+to\s+ground|\bhigh\s+amps|\bpull\b|\bno\s+water\b/i.test(
      corpus
    );
  return onSitePart && replaced && !biggerJob;
}

function isTankFail(corpus: string): boolean {
  return (
    /\bpinhole\b|\btank\s+(?:has\s+a\s+)?leak|\bleaking\s+(?:pressure\s+)?tank|\bwaterlogged\b|\bwater[\s-]*logged\b|\bbladder\b.*\b(?:fail|bad|rott|leak|gone)\b|\b(?:fail|bad|rott|leak|gone).*\bbladder\b|\bneeds?\s+a\s+new\s+pressure\s+tank\b/i.test(
      corpus
    )
  );
}

function isPrechargeOnly(corpus: string, tankLeaking: boolean, ampsNormal: boolean): boolean {
  if (tankLeaking || !ampsNormal) return false;
  return (
    /\bpre[\s-]?charge\b|\bair\s+charge\b|\blow\s+air\b|\badded\s+air\b|\badd(?:ed)?\s+air\b|\btank\s+air\s+low\b|\bneeds?\s+air\b/i.test(
      corpus
    ) && !/\breplace\s+(?:the\s+)?(?:pressure\s+)?tank\b|\bnew\s+(?:pressure\s+)?tank\b/i.test(corpus)
  );
}

function isWarranty(corpus: string): boolean {
  return /\bwarranty\b|\bno\s+charge\b|\bn\/c\b|\bnocharge\b|\bcomplimentary\b|\bdo\s+not\s+bill\b/i.test(
    corpus
  );
}

function isPullEval(corpus: string): boolean {
  return (
    /\bshort\s+to\s+(?:ground|earth)\b|\bgrounded\b|\bhigh\s+amps?\b|\bover[\s-]?amp/i.test(corpus) ||
    /\bpull\s*(and|&|\/|-)?\s*eval/.test(corpus) ||
    /\bpull\b.{0,24}\bevaluat/.test(corpus) ||
    /\bneeds?\s+(?:a\s+)?pull\b|\bpull\s+the\s+(?:pump|well)\b|\bpull\/eval\b/i.test(corpus) ||
    (/\bno\s+water\b|\bwon'?t\s+pump\b|\bno\s+flow\b/i.test(corpus) &&
      !/\bpinhole\b|\btank\s+leak|\bwaterlogged\b/i.test(corpus)) ||
    (/\bout of the well\b|\bpump is out\b/i.test(corpus) && /\bevaluat/i.test(corpus))
  );
}

function isControls(corpus: string): boolean {
  return (
    /\bcontrol\s+box\b|\bpressure\s+switch\b|\bpump\s*saver\b|\bstart\s+cap(?:acitor)?\b|\brun\s+cap(?:acitor)?\b/i.test(
      corpus
    ) && !/\bpull\b|\bshort\s+to\s+ground|\bhigh\s+amps?\b|\bno\s+water\b/i.test(corpus)
  );
}

function guessList(corpus: string, equipment: ParsedEquipment): IntentGuess[] {
  const guesses: IntentGuess[] = [];
  if (/\bpull\b|\beval/i.test(corpus)) {
    guesses.push({
      kind: 'pull_and_eval',
      confidence: 0.35,
      reason: 'mentions pull/eval but is not a clear street-book match',
    });
  }
  if (/\btank\b|\bbladder\b/i.test(corpus)) {
    guesses.push({
      kind: 'pressure_tank',
      confidence: 0.3,
      reason: 'mentions a tank but amps or leak language is incomplete',
    });
  }
  if (/\bpump\b|\bmotor\b/i.test(corpus)) {
    guesses.push({
      kind: 'pump_replace',
      confidence: equipment.pulledWell ? 0.35 : 0.25,
      reason: equipment.pulledWell
        ? 'pump is out but HP/GPM/depth are not all known'
        : 'mentions pump/motor without pull, set-only, or fail language',
    });
  }
  if (/\bcontrol\b|\bswitch\b|\bsaver\b/i.test(corpus)) {
    guesses.push({
      kind: 'controls',
      confidence: 0.3,
      reason: 'mentions controls but the pump may already be pulled',
    });
  }
  if (guesses.length === 0) {
    guesses.push({
      kind: 'other',
      confidence: 0.2,
      reason: 'no pull/eval, tank, pump-replace, or controls language',
    });
  }
  return guesses.slice(0, 4);
}

function decided(
  kind: TechNoteKind,
  reason: string,
  equipment: ParsedEquipment,
  corpus: string
): ParsedTechNote {
  return {
    kind,
    confidence: 0.9,
    guesses: [{ kind, confidence: 0.9, reason }],
    equipment,
    unclear: false,
    corpus,
    doNotQuote: null,
  };
}

export function parseTechNoteIntent(input: {
  techNotes?: string | null;
  jobTitle?: string | null;
  kind?: TechNoteKind | 'replace' | null;
}): ParsedTechNote {
  const corpus = [input.jobTitle, input.techNotes].filter(Boolean).join('\n').toLowerCase();
  const equipment = parseEquipment(corpus);
  const tankLeaking = isTankFail(corpus);
  const ampsNormal = ampsAreNormal(equipment);

  // Hard do-not-quote rules run before a kind override so warranty / good-to-go stay unsent.
  if (isGoodToGoOrOnSiteFix(corpus)) {
    return {
      kind: 'other',
      confidence: 1,
      guesses: [
        {
          kind: 'other',
          confidence: 1,
          reason: 'Completed service call — the $200 call is the ticket',
        },
      ],
      equipment,
      unclear: false,
      corpus,
      doNotQuote: 'service_call_ticket',
    };
  }
  if (isPrechargeOnly(corpus, tankLeaking, ampsNormal)) {
    return {
      kind: 'other',
      confidence: 1,
      guesses: [
        {
          kind: 'other',
          confidence: 1,
          reason: 'Precharge low only — do not sell a tank',
        },
      ],
      equipment,
      unclear: false,
      corpus,
      doNotQuote: 'precharge_only',
    };
  }
  if (isWarranty(corpus)) {
    return {
      kind: 'other',
      confidence: 1,
      guesses: [{ kind: 'other', confidence: 1, reason: 'Warranty / no charge' }],
      equipment,
      unclear: false,
      corpus,
      doNotQuote: 'warranty',
    };
  }

  if (input.kind && input.kind !== 'replace') {
    return {
      kind: input.kind,
      confidence: 1,
      guesses: [{ kind: input.kind, confidence: 1, reason: `kind override (${input.kind})` }],
      equipment,
      unclear: false,
      corpus,
      doNotQuote: null,
    };
  }
  if (input.kind === 'replace') {
    return {
      kind: 'pump_replace',
      confidence: 1,
      guesses: [{ kind: 'pump_replace', confidence: 1, reason: 'kind override (replace)' }],
      equipment,
      unclear: false,
      corpus,
      doNotQuote: null,
    };
  }

  // 4. Pinhole / tank leak / waterlogged bladder AND amps normal.
  if (tankLeaking && ampsNormal) {
    return decided(
      'pressure_tank',
      'Tank leak / pinhole / waterlogged bladder with amps in a normal band.',
      equipment,
      corpus
    );
  }

  // 5. Short to ground, high amps, needs pull/eval, no water + amps normal.
  if (isPullEval(corpus)) {
    return decided(
      'pull_and_eval',
      'Pull and evaluate (short to ground, high amps, no water, or explicit pull).',
      equipment,
      corpus
    );
  }

  // 6. Pump already out + known HP / GPM / depth → set-only replace.
  if (equipment.pulledWell && equipment.hp && equipment.gpm && equipment.depthFt) {
    return decided(
      'pump_replace',
      'Pump already out with known HP, GPM, and depth — set-only Goulds GS + CentriPro.',
      equipment,
      corpus
    );
  }

  // 7. Control box / switch / pump saver, pump still in.
  if (isControls(corpus) && !equipment.pulledWell) {
    return decided(
      'controls',
      'Controls / switch / pump saver with the pump still in the well.',
      equipment,
      corpus
    );
  }

  // 8. Unclear — never default to $600 BT2.
  const guesses = guessList(corpus, equipment);
  return {
    kind: guesses[0]?.kind ?? 'other',
    confidence: guesses[0]?.confidence ?? 0.2,
    guesses,
    equipment,
    unclear: true,
    corpus,
    doNotQuote: null,
  };
}

export function requireTechNoteIntent(input: {
  techNotes?: string | null;
  jobTitle?: string | null;
  kind?: TechNoteKind | 'replace' | null;
}): ParsedTechNote {
  const parsed = parseTechNoteIntent(input);
  if (parsed.doNotQuote === 'service_call_ticket') {
    throw new TechNoteDoNotQuoteError(
      'service_call_ticket',
      'Notes look like a completed service call (good to go / parts replaced on site). Do not quote — the $200 call is the ticket.',
      parsed.equipment
    );
  }
  if (parsed.doNotQuote === 'precharge_only') {
    throw new TechNoteDoNotQuoteError(
      'precharge_only',
      'Precharge is low and the tank is not leaking. Do not sell a tank.',
      parsed.equipment
    );
  }
  if (parsed.doNotQuote === 'warranty') {
    throw new TechNoteDoNotQuoteError(
      'warranty',
      'Notes say warranty / no charge. Do not create a customer quote.',
      parsed.equipment
    );
  }
  if (parsed.unclear) {
    throw new UnclearTechNoteIntentError(parsed.guesses, parsed.equipment);
  }
  return parsed;
}
