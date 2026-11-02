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
Treat this the same as no water. If the caller says the pressure is completely gone, or they have zero pressure or no pressure, AND they want help today or as soon as possible (today, tonight, right now, ASAP, immediately):
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

/** Pressure is gone, or they have zero / no pressure. Low pressure does not match. */
export function isLostPressure(text: string): boolean {
  const t = norm(text);
  if (/\b(?:zero|no|none)\s+pressure\b/.test(t)) return true;
  if (/\bpressure\s+(?:is\s+)?(?:at\s+)?zero\b/.test(t)) return true;
  if (/\bwithout\s+(?:any\s+)?pressure\b/.test(t)) return true;
  if (/\bpressure\b[^.]{0,48}\b(?:completely|totally|all)\s+gone\b/.test(t)) return true;
  if (/\b(?:completely|totally|all)\s+gone\b[^.]{0,48}\bpressure\b/.test(t)) return true;
  return false;
}

/** Today, tonight, right now, ASAP, or immediately. A later week does not match. */
export function wantsHelpSoon(text: string): boolean {
  return /\b(?:today|tonight|this morning|this afternoon|right now|right away|asap|a s a p|as soon as possible|as soon as you can|immediately)\b/.test(norm(text));
}

export function isNoWater(text: string): boolean {
  return /\bno water\b/.test(norm(text));
}

/**
 * No water, or lost / zero / no pressure when they want help today or ASAP.
 * Same booking path as no water: earliest slot, including today, plus flagEmergency.
 */
export function isLostPressureEmergency(text: string): boolean {
  return isLostPressure(text) && wantsHelpSoon(text);
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
  /\b(?:do you speak spanish|speaks spanish|speak spanish|you speak spanish|hablas?\s+espa[nñ]ol|espa[nñ]ol|en espa[nñ]ol|no hablo ingl[eé]s|spanish speaker)\b/i;

const SPANISH_MARKER =
  /\b(?:hola|buenos|buenas|gracias|por favor|necesito|tengo|agua|presi[oó]n|pozo|bomba|ayuda|llame|llamada|nombre|n[uú]mero|urgente|completamente|cero|se[nñ]or|se[nñ]ora|quiero|puede|pueden|alguien|favor|d[ií]as|tardes)\b/gi;

/** Caller is speaking Spanish, or asked whether Mike speaks Spanish. */
export function callerNeedsSpanish(text: string): boolean {
  const raw = String(text || '');
  if (!raw.trim()) return false;
  if (SPANISH_ASK.test(raw)) return true;
  if (/[¿¡ñ]/i.test(raw)) return true;
  const markers = raw.match(SPANISH_MARKER);
  return (markers?.length || 0) >= 2;
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

const STREET_SUFFIX =
  /\b(?:avenue|ave|street|st|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|place|pl|way|circle|cir|trail|trl)\b/g;
const DIRECTION = /^(?:n|s|e|w|north|south|east|west)$/;

function streetTokens(address: string): string[] {
  return norm(address)
    .replace(STREET_SUFFIX, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !DIRECTION.test(token) && !/^\d+$/.test(token));
}

function mentionsStreet(haystack: string, address: string): boolean {
  const tokens = streetTokens(address);
  if (!tokens.length) return false;
  const h = norm(haystack);
  return tokens.every((token) => new RegExp(`\\b${token}\\b`).test(h));
}

function mentionsCity(haystack: string, city: string): boolean {
  const wanted = normalizeServicePlace(city);
  if (!wanted) return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(normalizeServicePlace(haystack));
}

function lastStatedTown(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const town = matchedTownName(lines[i]);
    if (town) return town;
  }
  return null;
}

function isAffirmative(text: string): boolean {
  return /\b(?:yes|yeah|yep|yup|correct|that'?s right|that is right|that'?s the one|sure|ok|okay)\b/.test(norm(text));
}

function contradicts(text: string, city: string): boolean {
  const town = matchedTownName(text);
  if (town && normalizeServicePlace(town) !== normalizeServicePlace(city)) return true;
  const n = norm(text);
  if (/\b(?:wrong address|not that address|different address)\b/.test(n)) return true;
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
  const stated = lastStatedTown(users);
  if (stated && normalizeServicePlace(stated) !== normalizeServicePlace(city)) {
    return addressReject(`the caller said ${stated}, not ${city}`);
  }

  const hasTranscript = users.length > 0;
  if (!hasTranscript) {
    const confirmed = str(params.addressConfirmed) || str(params.callerAddressYes);
    if (confirmed && isAffirmative(confirmed) && !contradicts(confirmed, city)) return { ok: true };
    return addressReject('the street and city were not confirmed');
  }

  let asked = false;
  let agreed = false;
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn.role !== 'bot' || !mentionsStreet(turn.text, address) || !mentionsCity(turn.text, city)) continue;
    asked = true;
    const reply: string[] = [];
    for (let j = i + 1; j < turns.length && turns[j].role === 'user'; j++) reply.push(turns[j].text);
    if (reply.some((text) => userConfirms(text, address, city))) agreed = true;
  }
  if (!asked) return addressReject('you have not read back the street and the city');
  if (!agreed) return addressReject('the caller has not said yes to that street and city');
  return { ok: true };
}
