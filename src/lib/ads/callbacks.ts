/**
 * Callback matching for missed, voicemail, and AI-answered inbound calls.
 * Pure: no network. A callback is the first later outbound call to that number,
 * or a later inbound call from that number that a staff member answered.
 */
import { digits10 } from './call-dashboard.ts';
import { formatDuration, formatPhone, type FeedRow } from './call-feed.ts';
import { staffLines, type StaffLine } from './staff-lines.ts';

export const HANGUP_SECONDS = 10;
export const COLD_ATTEMPTS = 3;
export const COLD_DAYS = 3;
/** Shop Google Voice lines only. Personal cells are not in the audit log. */
export const OUTREACH_TOOLTIP =
  'Counts outbound calls from shop Google Voice lines (Liz, Shanicey, Brighton). Personal cell calls are not in this log, so a callback from a cell does not show here.';
export const COLD_TOOLTIP =
  'Going cold: 3 or more Voice attempts with no connected call or booking, or no attempt in the last 3 days.';

const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);
const SPAM = /spam|robocall|wrong number|telemarket|solicit|marketing|\bSEO\b|google (listing|business)|sales department|extended warranty on (your|their) (car|vehicle)/i;
const VENDOR = /insurance|home ?guard|supplier|vendor|distributor|adjuster|permit office/i;

export interface CallbackSource {
  at: string;
  phone: string | null;
  kind: 'outbound' | 'staff_answered';
  durationSeconds: number | null;
  staff: string | null;
}

export interface CallbackCandidate {
  at: string;
  phone: string | null;
  outcome: 'missed' | 'voicemail' | 'forwarded_ai';
  durationSeconds: number | null;
  ringSeconds: number | null;
  name: string | null;
  line: string;
  summary: string | null;
  spam: boolean;
  vendor: boolean;
  aiBooked: boolean;
}

export interface NeedsCallbackRow {
  at: string;
  phone: string;
  name: string | null;
  line: string;
  outcome: string;
  durationSeconds: number | null;
  outreach: string;
  goingCold: boolean;
  pastDue: boolean;
  /** Sum of unpaid invoice balances, when the mirror can show one. */
  balance?: number | null;
  /** Invoice client also placed an inbound call that is not clearly about the invoice. */
  alsoCalledIn?: boolean;
}

export interface OutreachAttempt {
  at: string;
  phone: string | null;
  staff: string | null;
  durationSeconds: number | null;
}

export interface OutreachView {
  attempts: number;
  lastAt: string | null;
  lastBy: string | null;
  label: string;
  goingCold: boolean;
}

export interface PastDueClient {
  id: string;
  name: string | null;
  phones: string[];
  /** Earliest unpaid invoice issue time. Anchor for the 3-day cold clock. */
  issuedAt: string;
  /** Sum of balances owed. Null when the mirror has no amount to show. */
  balance?: number | null;
  /**
   * True when the client has a past-due invoice and should be listed with no inbound call.
   * Omitted on older rows, which were past-due only and still appear without a call.
   */
  pastDue?: boolean;
}

export interface MirrorInvoice {
  client_id?: string | null;
  issued_date?: string | null;
  invoice_status?: string | null;
  /** Set only when jobber_invoices has a balance column. Numeric columns may arrive as strings. */
  balance?: number | string | null;
  amounts?: { total?: number | null; paymentsTotal?: number | null; invoiceBalance?: number | null } | null;
  data?: { amounts?: { total?: number | null; paymentsTotal?: number | null; invoiceBalance?: number | null } | null } | null;
}

export interface NeedsCallbackView {
  count: number;
  rows: NeedsCallbackRow[];
}

const SOURCE_LINE: Record<string, string> = {
  gbp_anza: 'GBP Anza', gbp_ramona: 'GBP Ramona', gmb: 'GBP', google_ads: 'Ads', ads: 'Ads',
  seo: 'Website', yelp: 'Yelp', apple_maps: 'Apple Maps', direct: 'Direct', main_line: 'Main', ransom_line: 'Ransom',
};

const OUTCOME_LABEL: Record<CallbackCandidate['outcome'], string> = {
  missed: 'Missed',
  voicemail: 'Voicemail',
  forwarded_ai: 'Mike (AI)',
};

export function isHangupUnder10s(duration: number | null | undefined, ring: number | null | undefined): boolean {
  if (duration == null && ring == null) return false;
  return Math.max(duration ?? 0, ring ?? 0) < HANGUP_SECONDS;
}

export function formatCallbackStatus(
  match: { at: string; durationSeconds: number | null } | null,
  eligible: boolean,
  now: Date,
): string | null {
  if (!eligible) return null;
  if (!match) return 'No callback yet';
  const d = new Date(match.at);
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const when = day === today
    ? time
    : `${d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })}, ${time}`;
  return `Called back ${when} PT, ${formatDuration(match.durationSeconds)}`;
}

/** Missed, voicemail, or the AI receptionist (Mike / Sarah). A live answer or a booking does not. */
export function feedNeedsCallback(outcome: string): boolean {
  if (outcome === 'Booked' || outcome === 'Answered' || outcome.startsWith('Answered')) return false;
  return outcome === 'Missed' || outcome === 'Voicemail' || /^(Mike|Sarah)\b/.test(outcome);
}

const INVOICE_TALK = /\b(invoice|invoices|past[-\s]?due|balance|payment|payments|collection|collections|amount due|unpaid|billing)\b/i;
const SERVICE_TALK = /\b(no water|pressure|pump|well|drill|quote|estimate|install|service call)\b/i;

/** True when the call text is about the invoice and not also a new job. Empty text is not obvious. */
export function obviouslyAboutInvoice(name: string | null, summary: string | null): boolean {
  const text = `${summary ?? ''}\n${name ?? ''}`.trim();
  if (!text || !INVOICE_TALK.test(text)) return false;
  if (SERVICE_TALK.test(text)) return false;
  return true;
}

function byPhone<T extends { phone: string | null; at: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const p = digits10(row.phone);
    const t = Date.parse(row.at);
    if (!p || !Number.isFinite(t)) continue;
    const list = map.get(p) ?? [];
    list.push(row);
    map.set(p, list);
  }
  for (const list of Array.from(map.values())) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return map;
}

export function firstCallback(phone: string | null, afterIso: string, sources: CallbackSource[]): CallbackSource | null {
  const p = digits10(phone);
  const after = Date.parse(afterIso);
  if (!p || !Number.isFinite(after)) return null;
  let best: CallbackSource | null = null;
  for (const s of sources) {
    if (digits10(s.phone) !== p) continue;
    const t = Date.parse(s.at);
    if (!Number.isFinite(t) || t <= after) continue;
    if (!best || t < Date.parse(best.at)) best = s;
  }
  return best;
}

/** A callback that actually connected: outbound talk time, or a later inbound a person answered. */
export function handlingCallback(phone: string | null, afterIso: string, sources: CallbackSource[]): CallbackSource | null {
  const p = digits10(phone);
  const after = Date.parse(afterIso);
  if (!p || !Number.isFinite(after)) return null;
  let best: CallbackSource | null = null;
  for (const s of sources) {
    if (digits10(s.phone) !== p) continue;
    const t = Date.parse(s.at);
    if (!Number.isFinite(t) || t <= after) continue;
    const connected = s.kind === 'staff_answered' || (s.durationSeconds ?? 0) > 0;
    if (!connected) continue;
    if (!best || t < Date.parse(best.at)) best = s;
  }
  return best;
}

function shopStaffName(row: Record<string, any>, lines: StaffLine[]): string | null {
  const email = String(row.answered_by ?? '').split('@')[0].toLowerCase();
  const phone = digits10(row.called_number);
  const ring = String(row.ring_group ?? '').trim().toLowerCase();
  for (const line of lines) {
    const local = (line.email ?? '').split('@')[0].toLowerCase();
    if (email && local && email === local) return line.name;
    if (phone && line.phone && phone === line.phone) return line.name;
    if (ring && ring === line.name.toLowerCase()) return line.name;
  }
  return null;
}

/** Outbound calls placed from a configured shop Voice line. Twilio tracking lines are not attempts. */
export function voiceAttempts(log: Array<Record<string, any>>, lines: StaffLine[] = staffLines()): OutreachAttempt[] {
  const out: OutreachAttempt[] = [];
  for (const row of log) {
    if (row.direction !== 'outbound') continue;
    const staff = shopStaffName(row, lines);
    if (!staff) continue;
    const at = String(row.started_at ?? '');
    if (!Number.isFinite(Date.parse(at))) continue;
    out.push({
      at,
      phone: row.caller_phone ?? null,
      staff,
      durationSeconds: row.duration_seconds ?? null,
    });
  }
  return out;
}

function formatAttemptWhen(iso: string, now: Date): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
  if (day === today) return `today ${time}`;
  const age = now.getTime() - d.getTime();
  if (age >= 0 && age < 7 * 86400_000) {
    const weekday = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' });
    return `${weekday} ${time}`;
  }
  const date = d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' });
  return `${date}, ${time}`;
}

export function summarizeOutreach(input: {
  phone: string | null;
  attempts: OutreachAttempt[];
  fromMs: number;
  now: Date;
  anchorAt: string;
  connected?: boolean;
  booked?: boolean;
  trackCold?: boolean;
}): OutreachView {
  const phone = digits10(input.phone);
  const end = input.now.getTime();
  const inWindow = input.attempts.filter((a) => {
    if (!phone || digits10(a.phone) !== phone) return false;
    const t = Date.parse(a.at);
    return Number.isFinite(t) && t >= input.fromMs && t <= end;
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const last = inWindow.length ? inWindow[inWindow.length - 1] : null;
  const connected = !!input.connected || inWindow.some((a) => (a.durationSeconds ?? 0) > 0);
  const booked = !!input.booked;
  const anchor = Date.parse(input.anchorAt);
  const lastMs = last ? Date.parse(last.at) : NaN;
  const stale = Number.isFinite(lastMs)
    ? end - lastMs >= COLD_DAYS * 86400_000
    : Number.isFinite(anchor) && end - anchor >= COLD_DAYS * 86400_000;
  const unansweredBurst = inWindow.length >= COLD_ATTEMPTS && !connected && !booked;
  const goingCold = input.trackCold === false ? false : unansweredBurst || stale;
  const label = !last
    ? 'No Voice attempts yet'
    : `${inWindow.length} ${inWindow.length === 1 ? 'attempt' : 'attempts'}, last ${formatAttemptWhen(last.at, input.now)}${last.staff ? ` · ${last.staff}` : ''}`;
  return { attempts: inWindow.length, lastAt: last?.at ?? null, lastBy: last?.staff ?? null, label, goingCold };
}

function invoiceStatus(inv: MirrorInvoice): string {
  return String(inv.invoice_status ?? '').toLowerCase().replace(/\s+/g, '_');
}

function invoiceAmounts(inv: MirrorInvoice) {
  return inv.amounts ?? inv.data?.amounts ?? null;
}

/** Balance from the column, or from amounts when the column is absent. Null if unknown. */
export function invoiceOwed(inv: MirrorInvoice, hasBalanceColumn: boolean): number | null {
  if (hasBalanceColumn) {
    if (inv.balance == null || inv.balance === '') return null;
    const n = typeof inv.balance === 'number' ? inv.balance : Number(inv.balance);
    return Number.isFinite(n) ? n : null;
  }
  const amounts = invoiceAmounts(inv);
  if (!amounts) return null;
  if (typeof amounts.invoiceBalance === 'number' && Number.isFinite(amounts.invoiceBalance)) return amounts.invoiceBalance;
  const total = amounts.total;
  const paid = amounts.paymentsTotal;
  if (typeof total === 'number' && typeof paid === 'number' && Number.isFinite(total) && Number.isFinite(paid)) {
    return Math.round((total - paid) * 100) / 100;
  }
  return null;
}

function invoiceUnpaid(inv: MirrorInvoice, hasBalanceColumn: boolean): boolean {
  if (hasBalanceColumn) {
    const owed = invoiceOwed(inv, true);
    return owed != null && owed > 0;
  }
  const status = invoiceStatus(inv);
  return status === 'past_due' || status === 'awaiting_payment';
}

/**
 * True when jobber_invoices has no balance column.
 * PostgREST says PGRST204 ("Could not find the 'balance' column").
 * Postgres says 42703 ("column jobber_invoices.balance does not exist").
 */
export function balanceColumnMissing(
  error: { code?: string | number | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
): boolean {
  if (!error) return false;
  const text = [error.message, error.details, error.hint].filter((part) => !!part).join(' ');
  if (!/balance/i.test(text)) return false;
  const code = String(error.code ?? '');
  return code === '42703' || code === 'PGRST204' || /does not exist|schema cache|could not find/i.test(text);
}

/**
 * A website form after the call means they already reached us.
 * source=phone is the row Mike files for the call itself (Phone Inquiry, Callback, Emergency), not a booking.
 */
export function requestResolvesCallback(source: string | null | undefined): boolean {
  return (source ?? '').trim().toLowerCase() !== 'phone';
}

/**
 * One row per client with an unpaid invoice.
 * Balance column (when present): unpaid means balance > 0.
 * Otherwise: past_due or awaiting_payment. pastDue is true only for past_due, so those
 * clients can be worked with no inbound call. Balance is summed for display when known.
 */
export function groupPastDueClients(
  invoices: MirrorInvoice[],
  clients: Array<{ id: string; name?: string | null; phones_digits?: string[] | null }>,
  opts?: { hasBalanceColumn?: boolean },
): PastDueClient[] {
  const hasBalanceColumn = opts?.hasBalanceColumn ?? invoices.some((inv) => Object.prototype.hasOwnProperty.call(inv, 'balance'));
  const grouped = new Map<string, { issuedAt: string; balance: number | null; pastDue: boolean }>();
  for (const inv of invoices) {
    if (!inv.client_id || !inv.issued_date || !invoiceUnpaid(inv, hasBalanceColumn)) continue;
    if (!Number.isFinite(Date.parse(inv.issued_date))) continue;
    const prev = grouped.get(inv.client_id);
    const owed = invoiceOwed(inv, hasBalanceColumn);
    const add = owed != null && owed > 0 ? owed : null;
    const balance = add == null ? (prev?.balance ?? null) : Math.round(((prev?.balance ?? 0) + add) * 100) / 100;
    const issuedAt = !prev || Date.parse(inv.issued_date) < Date.parse(prev.issuedAt) ? inv.issued_date : prev.issuedAt;
    const pastDue = (prev?.pastDue ?? false) || invoiceStatus(inv) === 'past_due';
    grouped.set(inv.client_id, { issuedAt, balance, pastDue });
  }
  const byId = new Map(clients.map((c) => [c.id, c]));
  const out: PastDueClient[] = [];
  for (const [id, row] of Array.from(grouped.entries())) {
    const client = byId.get(id);
    const phones = (client?.phones_digits ?? []).map((p) => digits10(p)).filter((p): p is string => !!p);
    if (!phones.length) continue;
    out.push({ id, name: client?.name ?? null, phones, issuedAt: row.issuedAt, balance: row.balance, pastDue: row.pastDue });
  }
  return out;
}

function bestPastDuePhone(phones: string[], attempts: OutreachAttempt[], fromMs: number, now: Date): string | null {
  let best: string | null = null;
  let bestAt = -1;
  for (const phone of phones) {
    for (const a of attempts) {
      if (digits10(a.phone) !== phone) continue;
      const t = Date.parse(a.at);
      if (!Number.isFinite(t) || t < fromMs || t > now.getTime()) continue;
      if (t >= bestAt) { bestAt = t; best = phone; }
    }
  }
  return best ?? phones[0] ?? null;
}

export function indexWorkTimes(rows: Array<{ phone: string | null; at: string }>): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const row of rows) {
    const p = digits10(row.phone);
    const t = Date.parse(row.at);
    if (!p || !Number.isFinite(t)) continue;
    const list = map.get(p) ?? [];
    list.push(t);
    map.set(p, list);
  }
  return map;
}

export function hasWorkAfter(phone: string | null, afterIso: string, work: Map<string, number[]>): boolean {
  const p = digits10(phone);
  const after = Date.parse(afterIso);
  if (!p || !Number.isFinite(after)) return false;
  return (work.get(p) ?? []).some((t) => t > after);
}

const textBlob = (name: string | null, summary: string | null) => `${summary ?? ''}\n${name ?? ''}`;

function flags(name: string | null, summary: string | null, phone: string | null, outcome: string | null): { spam: boolean; vendor: boolean } {
  const text = textBlob(name, summary);
  const p = digits10(phone);
  const toll = !!p && TOLL_FREE.has(p.slice(0, 3));
  const o = (outcome ?? '').toLowerCase();
  const spam = toll || o === 'spam' || (!!text.trim() && SPAM.test(text));
  const vendor = o === 'sales_vendor' || (!!text.trim() && VENDOR.test(text) && !/no water|pressure|pump|well/i.test(text));
  return { spam, vendor };
}

/** Inbound calls that can still need a callback, one row per call (recordings win over the voice log). */
export function callbackCandidates(input: {
  log: Array<Record<string, any>>;
  recordings: Array<Record<string, any>>;
  mike: Array<Record<string, any>>;
  bookedMike?: Set<string> | Iterable<string>;
}): CallbackCandidate[] {
  const booked = new Set(input.bookedMike ?? []);
  const rows: Array<CallbackCandidate & { _t: number; _d: string | null }> = [];
  const push = (row: CallbackCandidate) => {
    const t = Date.parse(row.at);
    if (!Number.isFinite(t)) return;
    rows.push({ ...row, _t: t, _d: digits10(row.phone) });
  };
  for (const r of input.recordings) {
    const answered = r.answered !== false && r.dial_status !== 'no-answer' && r.dial_status !== 'busy' && r.dial_status !== 'failed';
    const o = String(r.outcome || '');
    let outcome: CallbackCandidate['outcome'] | null = null;
    if (o === 'booked') outcome = null;
    else if (!answered) outcome = 'missed';
    else if (o === 'voicemail_or_no_answer') outcome = 'voicemail';
    if (!outcome) continue;
    const f = flags(r.caller_name ?? null, r.summary ?? null, r.caller_number ?? null, o);
    push({
      at: r.started_at, phone: r.caller_number ?? null, outcome, durationSeconds: r.duration_seconds ?? null,
      ringSeconds: r.ring_seconds ?? null, name: r.caller_name ?? null, line: SOURCE_LINE[r.source] ?? r.line ?? 'Tracking line',
      summary: r.summary ?? null, spam: f.spam, vendor: f.vendor, aiBooked: false,
    });
  }
  for (const r of input.log) {
    if (r.direction === 'outbound') continue;
    const outcome = r.outcome === 'missed' ? 'missed' : r.outcome === 'voicemail' ? 'voicemail' : r.outcome === 'forwarded_ai' ? 'forwarded_ai' : null;
    if (!outcome) continue;
    const t = Date.parse(r.started_at);
    const d = digits10(r.caller_phone);
    if (rows.some((x) => x._d && x._d === d && Math.abs(x._t - t) < 3 * 60_000)) continue;
    const f = flags(r.client_name ?? null, null, r.caller_phone ?? null, outcome);
    push({
      at: r.started_at, phone: r.caller_phone ?? null, outcome, durationSeconds: r.duration_seconds ?? null,
      ringSeconds: r.ring_seconds ?? null, name: r.client_name ?? null,
      line: r.campaign_name ? 'Ads' : (r.ring_group || 'Main'),
      summary: null, spam: f.spam, vendor: f.vendor,
      aiBooked: !!(r.receptionist_call_id && booked.has(r.receptionist_call_id)),
    });
  }
  for (const m of input.mike) {
    const t = Date.parse(m.called_at);
    const d = digits10(m.phone);
    if (!Number.isFinite(t) || rows.some((x) => x._d && x._d === d && Math.abs(x._t - t) < 5 * 60_000)) continue;
    const id = m.vapi_call_id ?? m.id;
    const f = flags(m.customer_name ?? null, m.summary ?? null, m.phone ?? null, null);
    push({
      at: m.called_at, phone: m.phone ?? null, outcome: 'forwarded_ai', durationSeconds: m.duration_sec ?? null,
      ringSeconds: null, name: m.customer_name ?? null, line: 'Mike', summary: m.summary ?? null,
      spam: f.spam, vendor: f.vendor, aiBooked: !!(id && booked.has(id)),
    });
  }
  return rows.sort((a, b) => b._t - a._t).map(({ _t, _d, ...row }) => row);
}

export function callbackSources(input: {
  log: Array<Record<string, any>>;
  recordings?: Array<Record<string, any>>;
}): CallbackSource[] {
  const sources: CallbackSource[] = [];
  for (const r of input.log) {
    if (r.direction === 'outbound') {
      sources.push({
        at: r.started_at, phone: r.caller_phone ?? null, kind: 'outbound',
        durationSeconds: r.duration_seconds ?? null, staff: r.ring_group ?? r.answered_by ?? null,
      });
      continue;
    }
    if (r.outcome === 'answered' && r.answered_by) {
      sources.push({
        at: r.started_at, phone: r.caller_phone ?? null, kind: 'staff_answered',
        durationSeconds: r.duration_seconds ?? null, staff: r.answered_by ?? null,
      });
    }
  }
  for (const r of input.recordings ?? []) {
    const answered = r.answered !== false && r.dial_status !== 'no-answer' && r.dial_status !== 'busy' && r.dial_status !== 'failed';
    const o = String(r.outcome || '');
    if (!answered || o === 'voicemail_or_no_answer' || o === 'spam' || o === 'sales_vendor') continue;
    sources.push({
      at: r.started_at, phone: r.caller_number ?? null, kind: 'staff_answered',
      durationSeconds: r.duration_seconds ?? null, staff: null,
    });
  }
  return sources;
}

/**
 * Attempt text belongs on calls that still need a callback: missed, voicemail, or Mike/Sarah,
 * and not a booking. A live answer shows attempt text only when someone actually dialed out.
 * Booked outcome, or a quote/request/job after the call, shows nothing.
 */
export function annotateFeed(
  rows: FeedRow[],
  sources: CallbackSource[],
  now: Date,
  extra?: { attempts?: OutreachAttempt[]; fromMs?: number; pastDuePhones?: Set<string>; work?: Map<string, number[]> },
): FeedRow[] {
  const attempts = extra?.attempts ?? [];
  const fromMs = extra?.fromMs ?? 0;
  const work = extra?.work ?? new Map<string, number[]>();
  return rows.map((row) => {
    const needsOutcome = feedNeedsCallback(row.outcome);
    const resolved = row.outcome === 'Booked' || (needsOutcome && hasWorkAfter(row.phone, row.at, work));
    const needs = needsOutcome && !resolved;
    const match = needs ? handlingCallback(row.phone, row.at, sources) : null;
    const outreach = summarizeOutreach({
      phone: row.phone,
      attempts,
      fromMs,
      now,
      anchorAt: row.at,
      connected: !!match || row.outcome === 'Answered' || row.outcome.startsWith('Answered'),
      booked: resolved || row.outcome === 'Booked',
      trackCold: needs && !match,
    });
    const answeredWithAttempts = (row.outcome === 'Answered' || row.outcome.startsWith('Answered ·')) && outreach.attempts > 0;
    const showOutreach = needs || answeredWithAttempts;
    return {
      ...row,
      callback: formatCallbackStatus(match, needs, now),
      outreach: showOutreach ? outreach.label : null,
      goingCold: needs ? outreach.goingCold : false,
    };
  });
}

const NEEDS_CAP = 100;

export interface CallbackQueues {
  leads: NeedsCallbackView;
  invoices: NeedsCallbackView;
}

function queue(rows: NeedsCallbackRow[]): NeedsCallbackView {
  const byUrgency = (a: NeedsCallbackRow, b: NeedsCallbackRow) =>
    Number(b.goingCold) - Number(a.goingCold) || Date.parse(b.at) - Date.parse(a.at);
  const sorted = [...rows].sort(byUrgency);
  return { count: sorted.length, rows: sorted.slice(0, NEEDS_CAP) };
}

/**
 * New leads stay on `leads` (same exclusions as before, including AI bookings and later
 * quote/request/job). Callers who match an unpaid invoice go to `invoices` only.
 * Past-due clients are listed even when they never called. Awaiting-payment clients
 * appear only when they called.
 */
export function needsCallback(input: {
  candidates: CallbackCandidate[];
  sources: CallbackSource[];
  work: Map<string, number[]>;
  fromMs: number;
  now?: Date;
  attempts?: OutreachAttempt[];
  pastDue?: PastDueClient[];
}): CallbackQueues {
  const now = input.now ?? new Date();
  const attempts = input.attempts ?? [];
  const pastDue = input.pastDue ?? [];
  const invoiceByPhone = new Map<string, PastDueClient>();
  for (const client of pastDue) {
    for (const p of client.phones) {
      const d = digits10(p);
      if (d && !invoiceByPhone.has(d)) invoiceByPhone.set(d, client);
    }
  }
  const callsByClient = new Map<string, CallbackCandidate[]>();
  const leads: NeedsCallbackRow[] = [];
  const seen = new Set<string>();
  for (const c of input.candidates) {
    const t = Date.parse(c.at);
    const phone = digits10(c.phone);
    if (!phone || !Number.isFinite(t) || t < input.fromMs || t > now.getTime()) continue;
    // AI booked a service call, or the call is junk: this number does not need a callback.
    if (c.aiBooked || c.spam || c.vendor) continue;
    if (isHangupUnder10s(c.durationSeconds, c.ringSeconds)) continue;
    const client = invoiceByPhone.get(phone);
    if (client) {
      const list = callsByClient.get(client.id) ?? [];
      list.push(c);
      callsByClient.set(client.id, list);
      continue;
    }
    if (hasWorkAfter(c.phone, c.at, input.work)) continue;
    if (handlingCallback(c.phone, c.at, input.sources)) continue;
    if (seen.has(phone)) continue;
    seen.add(phone);
    const outreach = summarizeOutreach({
      phone, attempts, fromMs: input.fromMs, now, anchorAt: c.at, trackCold: true,
    });
    leads.push({
      at: c.at,
      phone: formatPhone(c.phone),
      name: c.name,
      line: c.line,
      outcome: OUTCOME_LABEL[c.outcome],
      durationSeconds: c.durationSeconds,
      outreach: outreach.label,
      goingCold: outreach.goingCold,
      pastDue: false,
      balance: null,
      alsoCalledIn: false,
    });
  }
  const invoices: NeedsCallbackRow[] = [];
  for (const client of pastDue) {
    const calls = (callsByClient.get(client.id) ?? []).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const includeWithoutCall = client.pastDue !== false;
    if (!includeWithoutCall && calls.length === 0) continue;
    const phone = digits10(calls[0]?.phone) ?? bestPastDuePhone(client.phones, attempts, input.fromMs, now);
    if (!phone || seen.has(phone)) {
      const existing = phone ? invoices.find((r) => digits10(r.phone) === phone) : undefined;
      if (existing) {
        const invoice = summarizeOutreach({
          phone, attempts, fromMs: input.fromMs, now, anchorAt: client.issuedAt,
          connected: !!handlingCallback(phone, client.issuedAt, input.sources),
          booked: hasWorkAfter(phone, client.issuedAt, input.work),
          trackCold: true,
        });
        if (invoice.goingCold) existing.goingCold = true;
      }
      continue;
    }
    seen.add(phone);
    const isPastDue = client.pastDue !== false;
    const outreach = summarizeOutreach({
      phone, attempts, fromMs: input.fromMs, now, anchorAt: client.issuedAt,
      connected: !!handlingCallback(phone, client.issuedAt, input.sources),
      booked: hasWorkAfter(phone, client.issuedAt, input.work),
      trackCold: true,
    });
    invoices.push({
      at: calls[0]?.at ?? client.issuedAt,
      phone: formatPhone(phone),
      name: client.name,
      line: 'Invoice',
      outcome: isPastDue ? 'Past due' : 'Awaiting payment',
      durationSeconds: null,
      outreach: outreach.label,
      goingCold: outreach.goingCold,
      pastDue: isPastDue,
      balance: client.balance ?? null,
      alsoCalledIn: calls.some((c) => !obviouslyAboutInvoice(c.name, c.summary)),
    });
  }
  return { leads: queue(leads), invoices: queue(invoices) };
}
