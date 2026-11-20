/**
 * Who gets a Mike or Sarah follow-up.
 *
 * The end-of-call path creates one Jobber task (taskCreate) for Brian Schroeder
 * or Damian Famania. It does not insert scws-jobs public.tasks, does not assign
 * Travis or Brighton in the app, and does not text or email the customer.
 * Existing pending app tasks are left alone. Gap-caller backfill is not here.
 *
 * The hourly Mike → Jobber Ops routine stays the catch-up. Tasks it already
 * opened are titled "Follow up with {name}" with the phone in the description
 * and a start on the call day. This module uses that same title and skips when
 * an open task for the same phone, or the same name when the task has no phone,
 * falls inside the last or next 48 hours.
 */
import { digits10 } from '../ads/call-dashboard.ts';
import { buildDatedTaskFilter, type TaskListFilter } from '../jobber/mcp-tasks.ts';
import { STOP_WORDS } from './missed-call-text.ts';
import { doNotCallText } from './mike-callback.ts';
import { formatPhoneDisplay } from './office-callback.ts';
import { isReceptionistTestCaller } from './test-call.ts';

export const FOLLOW_UP_DEDUPE_MS = 48 * 60 * 60 * 1000;

export const FOLLOW_UP_ASSIGNEES = {
  pump: { lane: 'pump' as const, name: 'Brian Schroeder', email: 'bschroeder@scwellservice.com' },
  drill: { lane: 'drill' as const, name: 'Damian Famania', email: 'damian@scwellservice.com' },
};

export type FollowUpLane = keyof typeof FOLLOW_UP_ASSIGNEES;

export type FollowUpSource = 'mike' | 'sarah';

export type FollowUpSkipReason =
  | 'no-phone'
  | 'test-ani'
  | 'stop-dnc'
  | 'already-booked'
  | 'oasis-liam'
  | 'billing-only'
  | 'well-certification'
  | 'water-testing'
  | 'no-ask'
  | 'duplicate-open-task';

export type FollowUpInput = {
  source: FollowUpSource;
  phone: string;
  name?: string | null;
  serviceNeeded?: string | null;
  summary?: string | null;
  /** Caller lines only, when the route can split them from the assistant. */
  callerText?: string | null;
  /** Used when callerText is empty (Sarah payloads that are one blob). */
  transcript?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  leadSource?: string | null;
  urgent?: boolean;
  booked?: boolean;
  /** Extra test flag. A known test ANI is always skipped. */
  testCaller?: boolean;
  durationSec?: number | null;
};

export type OpenTaskHint = {
  id: string;
  title?: string | null;
  description?: string | null;
  clientName?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  isComplete?: boolean;
};

export type FollowUpPlan = {
  lane: FollowUpLane;
  assigneeName: string;
  assigneeEmail: string;
  title: string;
  instructions: string;
};

export type FollowUpDecision =
  | { action: 'skip'; reason: FollowUpSkipReason; existingTaskId?: string }
  | ({ action: 'create' } & FollowUpPlan);

/** Writes this path performs. taskCreate forces emailAssignments false. No SMS. */
export function followUpTaskWrites(): readonly string[] {
  return ['taskCreate'];
}

const PUMP_SERVICE =
  /\b(?:pumps?|pressure|leaks?|tanks?|no\s+water|no\s+pressure|service\s+call|booster|breaker|squeak|cycling|repairs?|broke(?:n)?)\b/i;
const AMBIGUOUS_ASK =
  /\b(?:quotes?|estimates?|schedule|appointment|come\s+out|look\s+at|help|wells?|service|fix|install)\b/i;
const DRILL =
  /\b(?:new\s+well|(?:new\s+)?drill(?:ing|er)?|deepen(?:ing)?|well\s+abandon\w*|abandon\w*\s+(?:the\s+|a\s+|their\s+)?well)\b/i;
const WELL_CERT =
  /\b(?:well\s+certif\w*|certif\w*\s+(?:of\s+)?(?:the\s+)?well|water\s+well\s+certif\w*)\b/i;
const WATER_TEST =
  /\b(?:water\s+tests?|test(?:ing)?\s+(?:the\s+|my\s+|our\s+)?water|water\s+quality\s+(?:test|sample)|bacteriological)\b/i;
const BILL_NOUN = 'bills?|invoices?';
const BILLING = new RegExp(
  [
    String.raw`\b(?:invoices?|billing|payments?|balance\s+due|pay\s+(?:my|the)\s+bill|past\s+due|how\s+much\s+(?:do\s+)?(?:i|we)\s+owe)\b`,
    // resend my bill, send the bill, send me the invoice, resend bill
    String.raw`\b(?:re)?send(?:\s+me|\s+us)?(?:\s+(?:my|the|our|a))?\s+(?:${BILL_NOUN})\b`,
    // resent my bill, bill resent, bill re-sent
    String.raw`\bre-?sent(?:\s+(?:my|the|our))?\s+(?:${BILL_NOUN})\b`,
    String.raw`\b(?:${BILL_NOUN})\s+re-?sent\b`,
    // my bill again, the invoice again
    String.raw`\b(?:my|the|our)\s+(?:${BILL_NOUN})\s+again\b`,
    String.raw`\b(?:${BILL_NOUN})\s+again\b`,
  ].join('|'),
  'i',
);
const GENERIC_SERVICE = /^(?:phone(?:\s+inquiry)?|inquiry|unknown|n\/a|none|call)?$/i;
const USELESS_NAME = /^(?:unknown(?:\s+client)?|caller|customer|phone inquiry)$/i;
const FILLER = /^(?:hi|hello|hey|um+|uh+|yeah|yes|no|ok(?:ay)?)[.!?\s]*$/i;

export function followUpDedupeFilter(now: Date = new Date()): TaskListFilter {
  return buildDatedTaskFilter({
    status: 'open',
    occursWithin: {
      startAt: new Date(now.getTime() - FOLLOW_UP_DEDUPE_MS).toISOString(),
      endAt: new Date(now.getTime() + FOLLOW_UP_DEDUPE_MS).toISOString(),
    },
  });
}

function corpus(input: FollowUpInput): string {
  const caller = (input.callerText || '').trim() || (input.transcript || '').trim();
  return [input.serviceNeeded, input.summary, caller, input.notes, input.leadSource]
    .map((part) => (part || '').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/southern california well service/gi, ' ')
    .replace(/\bwell service\b/gi, 'service call');
}

function dncCorpus(input: FollowUpInput): string {
  const caller = (input.callerText || '').trim();
  return [input.name, caller || input.transcript, input.summary].map((part) => part || '').join('\n');
}

export function isOasisLiamLead(text: string): boolean {
  const compact = text.replace(/\s+/g, ' ');
  if (/\boasis\s*[-–—/]\s*liam\b/i.test(compact) || /\bliam\s*[-–—/]\s*oasis\b/i.test(compact)) return true;
  const oasisAt = [...compact.matchAll(/\boasis\b/gi)].map((match) => match.index ?? -1);
  const liamAt = [...compact.matchAll(/\bliam\b/gi)].map((match) => match.index ?? -1);
  return oasisAt.some((oasis) => liamAt.some((liam) => Math.abs(oasis - liam) <= 80));
}

function isStopOrDnc(input: FollowUpInput): boolean {
  const text = dncCorpus(input);
  if (doNotCallText(input.name || '', text)) return true;
  return text.split(/\n+/).some((line) => STOP_WORDS.test(line.trim()));
}

function hasDrillAsk(text: string): boolean {
  return DRILL.test(text);
}

function hasPumpOrServiceAsk(text: string): boolean {
  return PUMP_SERVICE.test(text);
}

function hasAmbiguousAsk(text: string): boolean {
  return AMBIGUOUS_ASK.test(text);
}

function serviceLabelIsGeneric(serviceNeeded: string | null | undefined): boolean {
  return GENERIC_SERVICE.test((serviceNeeded || '').trim());
}

function isSilentOrNoAsk(input: FollowUpInput, text: string): boolean {
  if (hasDrillAsk(text) || hasPumpOrServiceAsk(text) || hasAmbiguousAsk(text)) return false;
  if (input.urgent) return false;
  const seconds = input.durationSec;
  if (seconds != null && Number.isFinite(seconds) && seconds < 10) return true;
  const caller = (input.callerText || '').trim();
  const callerIsEmpty = !caller || FILLER.test(caller) || caller.length < 12;
  if (callerIsEmpty && serviceLabelIsGeneric(input.serviceNeeded) && !hasDrillAsk(input.summary || '') && !hasPumpOrServiceAsk(input.summary || '') && !hasAmbiguousAsk(input.summary || '')) {
    return true;
  }
  return !hasDrillAsk(text) && !hasPumpOrServiceAsk(text) && !hasAmbiguousAsk(text) && serviceLabelIsGeneric(input.serviceNeeded);
}

function usableName(name: string | null | undefined): string | null {
  const trimmed = (name || '').replace(/\s+/g, ' ').trim();
  if (!trimmed || USELESS_NAME.test(trimmed)) return null;
  return trimmed;
}

function followUpTitle(name: string | null, phone: string): string {
  return `Follow up with ${name || formatPhoneDisplay(phone) || phone}`;
}

function e164(phone: string): string | null {
  const local = digits10(phone);
  return local ? `+1${local}` : null;
}

export function buildFollowUpPlan(input: FollowUpInput, lane: FollowUpLane): FollowUpPlan {
  const assignee = FOLLOW_UP_ASSIGNEES[lane];
  const name = usableName(input.name);
  const phone = e164(input.phone) || formatPhoneDisplay(input.phone) || input.phone.trim();
  const where = [input.address, input.city].map((part) => (part || '').trim()).filter(Boolean).join(', ');
  const summary = (input.summary || input.callerText || input.transcript || '').trim().slice(0, 1200);
  const lines = [
    lane === 'drill'
      ? 'New drill, deepen, or abandon follow-up for Damian Famania.'
      : 'Pump, service, or urgent no-water follow-up for Brian Schroeder.',
    'Do not text or email the customer from this task.',
    '',
    phone,
    name ? `Name: ${name}` : '',
    input.serviceNeeded?.trim() ? `Service: ${input.serviceNeeded.trim()}` : '',
    input.urgent ? 'Urgent: yes' : '',
    where ? `Address: ${where}` : '',
    input.leadSource?.trim() ? input.leadSource.trim() : '',
    summary ? `Summary: ${summary}` : '',
    '',
    `source: ${input.source}-webhook`,
    `lane: ${lane}`,
  ].filter((line) => line !== '');
  return {
    lane,
    assigneeName: assignee.name,
    assigneeEmail: assignee.email,
    title: followUpTitle(name, input.phone),
    instructions: lines.join('\n'),
  };
}

function digitsBlob(task: OpenTaskHint): string {
  return `${task.title || ''}\n${task.description || ''}`.replace(/\D/g, '');
}

function taskHasSomePhone(task: OpenTaskHint): boolean {
  return /\d{10}/.test(digitsBlob(task));
}

function nameIn(haystack: string, name: string): boolean {
  const normalized = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized || (normalized.length < 5 && !normalized.includes(' '))) return false;
  const text = haystack.toLowerCase().replace(/\s+/g, ' ');
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\b)${escaped}(?:\\b|$)`).test(text);
}

export function taskInDedupeWindow(task: OpenTaskHint, now: Date): boolean {
  const stamps = [task.startAt, task.endAt]
    .map((value) => (value ? Date.parse(value) : NaN))
    .filter((value) => Number.isFinite(value));
  if (!stamps.length) return true;
  const at = now.getTime();
  return stamps.some((stamp) => Math.abs(stamp - at) <= FOLLOW_UP_DEDUPE_MS);
}

export function matchingOpenTask(tasks: OpenTaskHint[], input: FollowUpInput, now: Date): OpenTaskHint | null {
  const phone = digits10(input.phone);
  const name = usableName(input.name);
  for (const task of tasks) {
    if (!task?.id || task.isComplete) continue;
    if (!taskInDedupeWindow(task, now)) continue;
    const blob = digitsBlob(task);
    if (phone && blob.includes(phone)) return task;
    if (phone && taskHasSomePhone(task)) continue;
    if (!name) continue;
    const titled = `${task.title || ''}\n${task.clientName || ''}`;
    if (nameIn(titled, name)) return task;
  }
  return null;
}

function routeLane(text: string, urgent: boolean): FollowUpLane | null {
  const pump = hasPumpOrServiceAsk(text);
  const drill = hasDrillAsk(text);
  // Urgent no-water and pump failures stay with Brian even if a new well is also mentioned.
  if (drill && !pump) return 'drill';
  if (urgent || pump || hasAmbiguousAsk(text)) return 'pump';
  if (drill) return 'drill';
  return null;
}

/**
 * Pure routing, skip, and dedupe. Pass open Jobber tasks from the 48-hour
 * window. An empty list means "none known", not "do not check".
 */
export function decideFollowUp(
  input: FollowUpInput,
  openTasks: OpenTaskHint[] = [],
  now: Date = new Date(),
): FollowUpDecision {
  if (!digits10(input.phone)) return { action: 'skip', reason: 'no-phone' };
  if (input.testCaller || isReceptionistTestCaller(input.phone)) return { action: 'skip', reason: 'test-ani' };
  if (isStopOrDnc(input)) return { action: 'skip', reason: 'stop-dnc' };
  if (input.booked) return { action: 'skip', reason: 'already-booked' };

  const text = corpus(input);
  if (isOasisLiamLead(text)) return { action: 'skip', reason: 'oasis-liam' };
  const drill = hasDrillAsk(text);
  const pump = hasPumpOrServiceAsk(text);
  // A bill or invoice ask is not a pump task. "help" / "well" / "service" in the
  // same transcript must not send it to Brian. A real pump or drill symptom still does.
  if (BILLING.test(text) && !drill && !pump) {
    return { action: 'skip', reason: 'billing-only' };
  }
  if (WELL_CERT.test(text) && !drill && !pump) return { action: 'skip', reason: 'well-certification' };
  if (WATER_TEST.test(text) && !drill && !pump) return { action: 'skip', reason: 'water-testing' };
  if (isSilentOrNoAsk(input, text)) return { action: 'skip', reason: 'no-ask' };

  const lane = routeLane(text, Boolean(input.urgent));
  if (!lane) return { action: 'skip', reason: 'no-ask' };

  const duplicate = matchingOpenTask(openTasks, input, now);
  if (duplicate) return { action: 'skip', reason: 'duplicate-open-task', existingTaskId: duplicate.id };
  return { action: 'create', ...buildFollowUpPlan(input, lane) };
}
