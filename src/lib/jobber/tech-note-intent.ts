export type TechNoteKind =
  | 'pull_and_eval'
  | 'pressure_tank'
  | 'pump_replace'
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
};

export type ParsedTechNote = {
  kind: TechNoteKind;
  confidence: number;
  guesses: IntentGuess[];
  equipment: ParsedEquipment;
  unclear: boolean;
  corpus: string;
};

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

const CLEAR_MARGIN = 0.15;
const CLEAR_MIN = 0.55;

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
  return null;
}

export function parseEquipment(text: string): ParsedEquipment {
  const hpMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:hp|h\.p\.|horse)\b/i);
  const voltMatch = text.match(/\b(115|120|230|240|460)\s*(?:v|volt|volts)?\b/i);
  const ampMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:a|amp|amps|ampere)/i);
  const threePhase = /\b(3[\s-]?ph|three[\s-]?phase)\b/i.test(text);
  const singlePhase = /\b(1[\s-]?ph|single[\s-]?phase)\b/i.test(text);
  const galMatch = text.match(/\b(\d{2,3})\s*-?\s*(?:gal|gallon)/i);
  const modelMatch = text.match(/\b(pm\s*-?\s*\d{2,3})\b/i);
  const pulledWell =
    /\b(out of the well|pulled (the )?(well|pump)|pump is out|well is pulled)\b/i.test(text);

  const hp = hpMatch ? Number(hpMatch[1]) : null;
  const volts = voltMatch ? Number(voltMatch[1]) : null;
  const amps = ampMatch ? Number(ampMatch[1]) : null;
  const phase: 1 | 3 | null = threePhase ? 3 : singlePhase ? 1 : null;
  const tankModel = modelMatch ? modelMatch[1].replace(/\s+/g, '').toUpperCase().replace('PM', 'PM') : null;
  const normalizedModel = tankModel ? tankModel.replace(/^PM/, 'PM') : null;

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
    tankGallons: galMatch ? Number(galMatch[1]) : normalizedModel === 'PM260' ? 86 : null,
    tankModel: normalizedModel,
    pulledWell,
  };
}

function scoreIntent(corpus: string, equipment: ParsedEquipment): IntentGuess[] {
  const guesses: IntentGuess[] = [];

  let tank = 0;
  const tankReasons: string[] = [];
  if (/\bpressure\s+tank\b|\btank\b/.test(corpus) && /\b(pinhole|leak|leaking|water\s*logged|waterlogged|bladder|rust)\b/.test(corpus)) {
    tank += 0.55;
    tankReasons.push('tank defect (pinhole/leak/waterlogged)');
  }
  if (/\b(needs? a new pressure tank|new pressure tank|replace\w* (the )?pressure tank|pressure tank replace)\b/.test(corpus)) {
    tank += 0.4;
    tankReasons.push('notes ask for a new pressure tank');
  }
  if (/\bpm\s*-?\s*260\b|\b86\s*-?\s*gal/.test(corpus)) {
    tank += 0.15;
    tankReasons.push('named Promax / 86-gal size');
  }
  if (tank > 0) {
    guesses.push({
      kind: 'pressure_tank',
      confidence: Math.min(1, tank),
      reason: tankReasons.join('; ') || 'pressure tank language',
    });
  }

  let pull = 0;
  const pullReasons: string[] = [];
  if (/\bpull\s*(and|&|\/|-)?\s*eval/.test(corpus) || /\bpull\b.{0,24}\bevaluat/.test(corpus)) {
    pull += 0.7;
    pullReasons.push('explicit pull/eval');
  }
  if (/\bout of the well\b/.test(corpus)) {
    pull += 0.45;
    pullReasons.push('pump/equipment is out of the well');
  }
  if (/\bpull (the )?(well )?pump\b/.test(corpus) && /\beval/.test(corpus)) {
    pull += 0.2;
    pullReasons.push('pull the pump and evaluate');
  }
  if (pull > 0) {
    guesses.push({
      kind: 'pull_and_eval',
      confidence: Math.min(1, pull),
      reason: pullReasons.join('; ') || 'pull language',
    });
  }

  let pump = 0;
  const pumpReasons: string[] = [];
  if (
    /\breplace\w*(?:\s+\w+){0,8}\s+(the )?(pump|motor)\b/.test(corpus) ||
    /\b(pump|motor)\s+replace/.test(corpus)
  ) {
    pump += 0.65;
    pumpReasons.push('replace pump/motor');
  }
  if (/\bnew (pump|motor)\b/.test(corpus) && !/\bpressure tank\b/.test(corpus)) {
    pump += 0.35;
    pumpReasons.push('new pump/motor');
  }
  if (/\b(pump|motor)\b.{0,20}\b(seized|locked|burnt|burned|bad|dead|failed|grounded)\b/.test(corpus)) {
    pump += 0.6;
    pumpReasons.push('failed pump/motor');
  }
  if (equipment.ampsNormal) {
    pump -= 0.35;
    pumpReasons.push('nameplate amps look normal — not a motor fail');
  }
  if (tank >= 0.55) {
    pump -= 0.4;
  }
  if (pump > 0) {
    guesses.push({
      kind: 'pump_replace',
      confidence: Math.min(1, Math.max(0.05, pump)),
      reason: pumpReasons.join('; ') || 'pump/motor language',
    });
  }

  let electrical = 0;
  const elecReasons: string[] = [];
  if (/\b(control box|pressure switch|breaker|capacitor|starter|no power|electrical)\b/.test(corpus)) {
    electrical += 0.5;
    elecReasons.push('electrical component language');
  }
  if (tank >= 0.4 || pump >= 0.5 || pull >= 0.5) {
    electrical -= 0.3;
  }
  if (electrical > 0) {
    guesses.push({
      kind: 'electrical',
      confidence: Math.min(1, Math.max(0.05, electrical)),
      reason: elecReasons.join('; ') || 'electrical language',
    });
  }

  guesses.sort((a, b) => b.confidence - a.confidence);
  if (guesses.length === 0) {
    guesses.push({
      kind: 'other',
      confidence: 0.2,
      reason: 'no pull/eval, tank, pump-replace, or electrical language',
    });
  }
  return guesses;
}

export function parseTechNoteIntent(input: {
  techNotes?: string | null;
  jobTitle?: string | null;
  kind?: TechNoteKind | 'replace' | null;
}): ParsedTechNote {
  const corpus = [input.jobTitle, input.techNotes].filter(Boolean).join('\n').toLowerCase();
  const equipment = parseEquipment(corpus);
  const guesses = scoreIntent(corpus, equipment);

  if (input.kind && input.kind !== 'replace') {
    return {
      kind: input.kind,
      confidence: 1,
      guesses: [
        { kind: input.kind, confidence: 1, reason: `kind override (${input.kind})` },
        ...guesses.filter((guess) => guess.kind !== input.kind),
      ],
      equipment,
      unclear: false,
      corpus,
    };
  }
  if (input.kind === 'replace') {
    return {
      kind: 'pump_replace',
      confidence: 1,
      guesses: [
        { kind: 'pump_replace', confidence: 1, reason: 'kind override (replace)' },
        ...guesses.filter((guess) => guess.kind !== 'pump_replace'),
      ],
      equipment,
      unclear: false,
      corpus,
    };
  }

  const top = guesses[0];
  const second = guesses[1];
  const unclear =
    !top ||
    top.kind === 'other' ||
    top.confidence < CLEAR_MIN ||
    (second != null && top.confidence - second.confidence < CLEAR_MARGIN && second.confidence >= 0.4);

  return {
    kind: top.kind,
    confidence: top.confidence,
    guesses,
    equipment,
    unclear,
    corpus,
  };
}

export function requireTechNoteIntent(input: {
  techNotes?: string | null;
  jobTitle?: string | null;
  kind?: TechNoteKind | 'replace' | null;
}): ParsedTechNote {
  const parsed = parseTechNoteIntent(input);
  if (parsed.unclear) {
    throw new UnclearTechNoteIntentError(parsed.guesses, parsed.equipment);
  }
  return parsed;
}
