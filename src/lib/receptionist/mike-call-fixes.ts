/**
 * Three Mike call fixes. Speech rules are pasted into the SCWS Receptionist
 * system prompt (applyMikeCallFixes). Tool results enforce the same rules.
 *
 * Does not change the greeting, voice, call routing, or MIKE_CALLBACKS_ENABLED.
 * This file does not call Vapi.
 */

import { matchedTownName, normalizeServicePlace } from './service-area.ts';

export const SPANISH_ONLY_LINE =
  'Sí, un miembro de nuestro equipo que habla español le devolverá la llamada pronto. ¿Cuál es su nombre y número?';

export const SPANISH_SPEAKER_FLAG = 'Spanish speaker';

export const LOST_PRESSURE_HEADING = '## Lost pressure emergency (HARD RULE)';
export const SPANISH_HEADING = '## Spanish speaker (HARD RULE)';
export const ADDRESS_CONFIRM_HEADING = '## Confirm street and city (HARD RULE)';

export const MIKE_LOST_PRESSURE_RULE = `${LOST_PRESSURE_HEADING}
Treat this the same as no water. If the caller says the pressure is gone (including completely gone), or they have zero pressure or no pressure, AND they want help today or as soon as possible (today, tonight, right now, ASAP, immediately):
- It is an emergency, the same path as no water. Do not treat it as a routine low-pressure visit.
- Offer the earliest open slot from checkSchedule, including today, Saturday, or Sunday when one is listed. Do not offer only a later weekday (for example only Monday) when an earlier slot is listed.
- Say the office team cannot promise sooner, and call flagEmergency once so the on-call team can move it up.
- Skip the diagnostic-visit pitch.
A mild low-pressure problem they can wait on is not this rule.`;

export const MIKE_SPANISH_RULE = `${SPANISH_HEADING}
If the caller speaks Spanish, or asks whether you speak Spanish (including "do you speak Spanish"):
- Say only this exact line, and no other Spanish at any point on the call: "${SPANISH_ONLY_LINE}"
- Do not translate, improvise, or continue in Spanish.
- After they give a name and a number, call createCallback once. The reason must start with "${SPANISH_SPEAKER_FLAG}". Do not book a visit on this call.`;

export const MIKE_ADDRESS_CONFIRM_RULE = `${ADDRESS_CONFIRM_HEADING}
Before bookJob, confirm the street address and the city out loud, even for an existing customer. Ask: "Just to confirm, the well is at [street] in [city]?" and wait for a yes. Do not assume the city from the line they called (Ramona, Anza, or any other). An address on file is only a suggestion until they confirm the street and the city. If they give a different street or city, use what they said.`;

export const ADDRESS_ON_FILE_RULE =
  'Before book_job, confirm the street address and the city out loud, even for an existing customer. Ask: "Just to confirm, the well is at [street] in [city]?" and wait for a yes. Do not assume the city from the line they called. addressOnFile is only a suggestion until they confirm the street and the city. If they give a different street or city, use what they said. Never use the caller\'s name as the town.';

const INSERT_BEFORE = '## NEVER GO SILENT (hard rule)';

/** Returned on lookupCustomer so the live assistant sees the rules before booking. */
export const MIKE_CALL_RULES = [MIKE_LOST_PRESSURE_RULE, MIKE_SPANISH_RULE, MIKE_ADDRESS_CONFIRM_RULE].join('\n\n');

const RULES = [MIKE_LOST_PRESSURE_RULE, MIKE_SPANISH_RULE, MIKE_ADDRESS_CONFIRM_RULE] as const;

function headingOf(section: string): string {
  return section.split('\n')[0];
}

/** Insert the three hard rules. Idempotent. Leaves every other line as it was. */
export function applyMikeCallFixes(prompt: string): string {
  let next = prompt;
  for (let i = RULES.length - 1; i >= 0; i--) {
    const section = RULES[i];
    if (next.includes(headingOf(section))) continue;
    if (!next.includes(INSERT_BEFORE)) {
      throw new Error('Mike prompt is missing the NEVER GO SILENT anchor');
    }
    next = next.replace(INSERT_BEFORE, `${section}\n\n${INSERT_BEFORE}`);
  }
  return next;
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "No pressure to rush" is not a dry well. Strip it before any pressure match. */
export function stripPressureIdiom(text: string): string {
  return String(text || '').replace(/\bno pressure to (?:rush|hurry|worry)\b/gi, ' ');
}

/** Pressure is gone, or they have zero / no pressure. Low pressure does not match. */
export function isLostPressure(text: string): boolean {
  const t = norm(stripPressureIdiom(text));
  if (/\b(?:zero|none)\s+pressure\b/.test(t)) return true;
  if (/\bno pressure\b/.test(t)) return true;
  if (/\bpressure\s+(?:is\s+)?(?:at\s+)?zero\b/.test(t)) return true;
  if (/\bwithout\s+(?:any\s+)?pressure\b/.test(t)) return true;
  if (/\bpressure(?:'s|\s+is|\s+has)?\s+(?:completely\s+|totally\s+|all\s+)?gone\b/.test(t)) return true;
  if (/\b(?:completely|totally|all)\s+gone\b[^.]{0,48}\bpressure\b/.test(t)) return true;
  return false;
}

/**
 * A request to come today / ASAP. "Calling today" and "no pressure to rush"
 * are not a request for same-day help.
 */
export function wantsHelpSoon(text: string): boolean {
  const t = norm(stripPressureIdiom(text));
  if (/\b(?:asap|a s a p|as soon as possible|as soon as you can|right now|right away|immediately)\b/.test(t)) return true;
  const soon = '(?:today|tonight|this morning|this afternoon)';
  const ask = '(?:need(?:ed|s)?|want(?:ed|s)?|send|come|coming|help|someone|somebody|tech|technician)';
  if (new RegExp(`\\b${ask}\\b[^.]{0,40}\\b${soon}\\b`).test(t)) return true;
  if (new RegExp(`\\b${soon}\\b[^.]{0,40}\\b${ask}\\b`).test(t)) return true;
  return false;
}

function splitStatements(text: string): string[] {
  return String(text || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function isNoWater(text: string): boolean {
  return /\bno water\b/.test(norm(text));
}

/**
 * No water, or lost / zero / no pressure when they want help today or ASAP.
 * Same booking path as no water: earliest slot, including today, plus flagEmergency.
 */
/**
 * Lost pressure plus same-day help, judged on one problem statement
 * (a sentence, or that sentence plus the next). A "today" elsewhere in the
 * call does not combine with a later pressure phrase.
 */
export function isLostPressureEmergency(text: string): boolean {
  const parts = splitStatements(text);
  for (let i = 0; i < parts.length; i++) {
    const window = [parts[i], parts[i + 1]].filter(Boolean).join(' ');
    const pressureHere = isLostPressure(parts[i]) || (parts[i + 1] ? isLostPressure(parts[i + 1]) : false);
    if (!pressureHere || !isLostPressure(window)) continue;
    if (wantsHelpSoon(window)) return true;
  }
  return false;
}

export const PRESSURE_EMERGENCY_TAG = 'Emergency: pressure gone, wants today';
export const NO_WATER_EMERGENCY_TAG = 'Emergency: no water';

/** Short note for Jobber. Never the caller's transcript. */
export function emergencyNoteTag(text: string): string {
  if (isLostPressureEmergency(text)) return PRESSURE_EMERGENCY_TAG;
  if (isNoWater(text)) return NO_WATER_EMERGENCY_TAG;
  return '';
}

export function withEmergencyNote(notes: unknown, text: string): string {
  const tag = emergencyNoteTag(text);
  const current = typeof notes === 'string' ? notes.trim() : '';
  if (!tag) return current;
  if (current.includes(tag)) return current;
  return current ? `${tag}. ${current}` : tag;
}

export function isSameAsNoWaterEmergency(text: string): boolean {
  return isNoWater(text) || isLostPressureEmergency(text);
}

export function sameAsNoWaterBookingSuffix(
  text: string,
  slots: Array<{ date?: string; time?: string }> = [],
): string {
  if (!isSameAsNoWaterEmergency(text)) return '';
  const first = slots.find((slot) => slot.date || slot.time);
  const when = first ? [first.date, first.time].filter(Boolean).join(' ') : 'the earliest openSlots time';
  return ` EMERGENCY, same as no water. Offer ${when} first. If that slot is today, Saturday, or Sunday, offer it. Do not offer only a later weekday such as Monday when an earlier slot is listed. Say the office cannot promise sooner, and call flagEmergency once. Skip the diagnostic pitch.`;
}

const SPANISH_ASK =
  /\b(?:do you speak spanish|can you speak spanish|you speak spanish|hablas?\s+espa[nñ]ol|no hablo ingl[eé]s)\b/i;

const SPANISH_WORD = new Set([
  'hola', 'buenos', 'buenas', 'gracias', 'necesito', 'tengo', 'agua', 'presion', 'pozo', 'bomba',
  'ayuda', 'quiero', 'puede', 'pueden', 'alguien', 'senor', 'senora', 'completamente', 'numero',
  'llamada', 'llame', 'ustedes', 'usted', 'estoy', 'estamos', 'calle', 'problema', 'tambien',
  'porque', 'donde', 'manana', 'porfa', 'vengan', 'venga', 'tenemos', 'tiene', 'tienen',
  'nuestra', 'nuestro', 'hablo', 'hablas', 'habla', 'espanol', 'ingles', 'funciona', 'funcionan',
  'roto', 'rota', 'arreglo', 'tecnico', 'hoy', 'nada', 'hay', 'casa', 'desde', 'ayer', 'servicio',
  'urgente', 'cero',
]);

const ENGLISH_WORD = new Set([
  'i', 'me', 'my', 'the', 'a', 'an', 'need', 'help', 'please', 'water', 'pressure', 'well', 'pump',
  'today', 'tomorrow', 'can', 'you', 'we', 'have', 'has', 'is', 'are', 'was', 'and', 'or', 'but',
  'to', 'for', 'of', 'in', 'on', 'at', 'with', 'from', 'this', 'that', 'it', 'its', 'our', 'your',
  'yes', 'no', 'not', 'do', 'does', 'did', 'want', 'wanted', 'someone', 'come', 'out', 'now',
  'asap', 'hello', 'thanks', 'thank', 'hi', 'hey', 'gone', 'completely', 'zero', 'low', 'name',
  'called', 'line', 'just', 'what', 'going',
]);

function foldWord(word: string): string {
  return word
    .replace(/ñ/g, 'n')
    .replace(/[áà]/g, 'a')
    .replace(/[éè]/g, 'e')
    .replace(/[íì]/g, 'i')
    .replace(/[óò]/g, 'o')
    .replace(/[úù]/g, 'u');
}

function wordsOf(text: string): string[] {
  return norm(text).split(' ').filter(Boolean).map(foldWord);
}

/** A real Spanish sentence: at least three Spanish words, and more Spanish than English. */
export function mostlySpanish(text: string): boolean {
  const words = wordsOf(text);
  if (words.length < 3) return false;
  let spanish = 0;
  let english = 0;
  for (const word of words) {
    if (SPANISH_WORD.has(word)) spanish += 1;
    else if (ENGLISH_WORD.has(word)) english += 1;
  }
  return spanish >= 3 && spanish > english;
}

function spanishUtterances(text: string): string[] {
  return String(text || '')
    .split(/\n+|(?<=[.!?¿¡])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * Clear request ("do you speak Spanish", "habla español") or a mostly-Spanish
 * utterance. A ñ in a name, or two Spanish words inside English, does not qualify.
 */
export function callerNeedsSpanish(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  const chunks = spanishUtterances(raw);
  return (chunks.length ? chunks : [raw]).some((chunk) => SPANISH_ASK.test(chunk) || mostlySpanish(chunk));
}

/** Block every tool except createCallback once the caller actually needs Spanish. */
export function spanishToolBlock(toolName: string, callerText: string): Record<string, unknown> | null {
  if (toolName === 'createCallback') return null;
  if (!callerNeedsSpanish(callerText)) return null;
  return spanishSpeechResult();
}

export function spanishSpeechResult(base?: Record<string, unknown> | null): Record<string, unknown> {
  if (base && base.success === false) return base;
  return {
    ...(base || {}),
    success: true,
    spanishSpeaker: true,
    sayExactly: SPANISH_ONLY_LINE,
    nextTool: 'createCallback',
    instruction:
      'Say message verbatim and no other Spanish. After a name and number, call createCallback once with reason starting "Spanish speaker". Do not book.',
    message: SPANISH_ONLY_LINE,
  };
}

export function withSpanishSpeakerFlag(params: Record<string, unknown>): Record<string, unknown> {
  const current = [params.reason, params.notes, params.message, params.details]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => String(value).trim())
    .join('. ');
  const reason = current.toLowerCase().includes(SPANISH_SPEAKER_FLAG.toLowerCase())
    ? current
    : `${SPANISH_SPEAKER_FLAG}${current ? `. ${current}` : ''}`;
  return { ...params, spanishSpeaker: true, reason };
}

const STREET_WORD: Record<string, string> = {
  st: 'street', street: 'street',
  ave: 'avenue', avenue: 'avenue',
  rd: 'road', road: 'road',
  dr: 'drive', drive: 'drive',
  ln: 'lane', lane: 'lane',
  ct: 'court', court: 'court',
  blvd: 'boulevard', boulevard: 'boulevard',
  pl: 'place', place: 'place',
  hwy: 'highway', highway: 'highway',
  cir: 'circle', circle: 'circle',
  trl: 'trail', trail: 'trail',
  way: 'way',
};

const DIRECTION_WORD: Record<string, string> = {
  n: 'north', north: 'north',
  s: 'south', south: 'south',
  e: 'east', east: 'east',
  w: 'west', west: 'west',
};

const GENERIC_STREET = new Set([
  'north', 'south', 'east', 'west', 'street', 'avenue', 'road', 'drive', 'lane', 'court',
  'boulevard', 'place', 'circle', 'trail', 'way',
]);

function canonicalWords(value: string): string[] {
  return norm(value)
    .split(' ')
    .filter(Boolean)
    .map((token) => DIRECTION_WORD[token] || STREET_WORD[token] || token);
}

/** Distinctive street words. Hwy and Highway match. A leading house number is optional. */
function significantAddressTokens(address: string): string[] {
  const words = canonicalWords(address);
  const body = words[0] && /^\d+$/.test(words[0]) && words.length > 1 ? words.slice(1) : words;
  const significant = body.filter((token) => !GENERIC_STREET.has(token));
  return significant.length ? significant : body.filter((token) => !DIRECTION_WORD[token]);
}

function mentionsStreet(haystack: string, address: string): boolean {
  const needed = significantAddressTokens(address);
  if (!needed.length) return false;
  const hay = new Set(canonicalWords(haystack));
  return needed.every((token) => hay.has(token));
}

function mentionsCity(haystack: string, city: string): boolean {
  const wanted = normalizeServicePlace(city);
  if (!wanted) return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalizeServicePlace(haystack));
}

function isAffirmative(text: string): boolean {
  return /\b(?:yes|yeah|yep|yup|correct|that'?s right|that is right|that'?s the one|sure|ok|okay)\b/.test(norm(text));
}

function withoutLineMention(text: string): string {
  return text.replace(/\b[\w.'’-]+\s+line\b/gi, ' ');
}

/** A town the caller gave as the well location. "The Ramona line" is not one. */
function claimedServiceTown(text: string): string | null {
  const cleaned = withoutLineMention(text);
  const placesWell = /\b(?:well|address|street|live|living|located|property|house|home)\b/i.test(cleaned)
    || /\b(?:i'm|i am|we're|we are)\s+in\b/i.test(cleaned);
  const town = matchedTownName(cleaned);
  if (!town) return null;
  if (placesWell) return town;
  if (/\bno\b/.test(norm(cleaned))) return town;
  return null;
}

function contradicts(text: string, city: string): boolean {
  const claimed = claimedServiceTown(text);
  if (claimed && normalizeServicePlace(claimed) !== normalizeServicePlace(city)) return true;
  if (/\b(?:wrong address|not that address|different address)\b/.test(norm(text))) return true;
  return false;
}

function userConfirms(text: string, address: string, city: string): boolean {
  if (contradicts(text, city)) return false;
  if (isAffirmative(text)) return true;
  return mentionsStreet(text, address) && mentionsCity(text, city);
}

export type AddressTurn = { role: 'bot' | 'user'; text: string };

export type AddressDecision =
  | { ok: true }
  | { ok: false; result: Record<string, unknown> };

export const ADDRESS_CONFIRM_RETRY_LIMIT = 2;

function addressReject(why: string): AddressDecision {
  return {
    ok: false,
    result: {
      booked: false,
      canConfirm: false,
      mayBook: false,
      addressConfirmationRequired: true,
      message:
        `NOT BOOKED (${why}). Before booking, confirm the street address and the city out loud, even for an existing customer. ` +
        `Ask: "Just to confirm, the well is at [street] in [city]?" Do not assume Ramona, Anza, or the line they called. ` +
        `Wait for a yes, then call book_job again with that street, that city, and addressConfirmed set to their exact yes. ` +
        `If they correct the street or city, use what they said.`,
    },
  };
}

function addressFallback(): AddressDecision {
  return {
    ok: false,
    result: {
      booked: false,
      canConfirm: false,
      mayBook: false,
      addressConfirmationRequired: false,
      fallback: 'createCallback',
      message:
        `NOT BOOKED. The street and city were not confirmed after ${ADDRESS_CONFIRM_RETRY_LIMIT} tries. ` +
        'Call createCallback once with their name, number, and the street and city you have. Do not call book_job again.',
    },
  };
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * book_job must have a street and a city the caller confirmed.
 * An address on file, or the city of the line they dialed, is not confirmation.
 */
export function checkServiceAddressConfirmation(
  params: Record<string, unknown>,
  turns: AddressTurn[] = [],
): AddressDecision {
  const address = str(params.address) || str(params.serviceAddress) || str(params.street);
  const city = str(params.city) || str(params.town);
  if (!address || !city) return addressReject('street and city are both required');

  const users = turns.filter((turn) => turn.role === 'user').map((turn) => turn.text);
  const hasTranscript = users.length > 0;
  let asks = 0;
  let agreed = false;
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== 'bot' || !mentionsStreet(turn.text, address) || !mentionsCity(turn.text, city)) continue;
    asks += 1;
    const reply: string[] = [];
    for (let j = i + 1; j < turns.length && turns[j].role === 'user'; j++) reply.push(turns[j].text);
    if (reply.some((text) => userConfirms(text, address, city))) agreed = true;
  }
  if (agreed) return { ok: true };

  const claimed = users.map(claimedServiceTown).find((town) => town && normalizeServicePlace(town) !== normalizeServicePlace(city));
  if (claimed && asks < ADDRESS_CONFIRM_RETRY_LIMIT) {
    return addressReject(`the caller said ${claimed}, not ${city}`);
  }
  if (asks >= ADDRESS_CONFIRM_RETRY_LIMIT) return addressFallback();

  if (!hasTranscript) {
    const confirmed = str(params.addressConfirmed) || str(params.callerAddressYes);
    if (confirmed && isAffirmative(confirmed) && !contradicts(confirmed, city)) return { ok: true };
    return addressReject('the street and city were not confirmed');
  }

  if (!asks) return addressReject('you have not read back the street and the city');
  return addressReject('the caller has not said yes to that street and city');
}
