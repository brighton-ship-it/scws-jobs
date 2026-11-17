/**
 * "Real leads" for Call to booking (pure; no network). Port of the QC classifier (qc/classify/cls.py).
 * One lead per caller (phone). A caller is NOT a real lead when they are staff/internal, spam/robocall/
 * solicitor/vendor, an existing customer (Jobber job created before their first call), or only ever
 * hung up / short-missed and were never reached. Extra calls from a lead are "repeat" (or "missed,
 * later reached" when the lead's earlier missed calls were followed by a connected call).
 * Any caller credited with a new-customer booking is always a real lead (numerator ⊆ denominator).
 */
import { digits10, SHORT_CALL_SECONDS, type AdCategory } from './call-dashboard.ts';

export type LeadReason = 'lead' | 'repeat' | 'missed_later_reached' | 'existing' | 'spam' | 'hangup' | 'internal';
export const LEAD_REASON_LABEL: Record<Exclude<LeadReason, 'lead'>, string> = {
  repeat: 'repeat calls (same caller counted once)',
  missed_later_reached: 'missed calls later reached',
  existing: 'existing customers',
  spam: 'spam / robocalls / solicitors / vendors',
  hangup: 'hang-ups / short calls never reached',
  internal: 'staff / internal',
};

export interface LeadCall { at: string; phone: string | null; durationSec: number | null; cat: AdCategory | null; live: boolean; text?: string | null; missed?: boolean }
export interface ContactEvent { at: string; phone: string | null; connected: boolean }
export interface RealLead { phone: string; at: string; cat: AdCategory | null; booked: boolean }
export interface RealLeadsResult { leads: RealLead[]; reasons: Array<{ at: string; cat: AdCategory | null; live: boolean; reason: LeadReason }>; unresolvedExisting: number }

export const STAFF_PHONES = new Set(['6193208264', '4422272898', '6192590410', '7604915348', '7604408520', '7607895955', '7604630493', '7603312502', '7602791262', '7604937719', '9516510957', '7608914264', '7604540365', '7608238910', '7608250520', '7608256285']);
/** SCWS's own numbers (GV lines, Twilio tracking/GBP/ads/Direct lines, staff cells, Twilio test line). Calls FROM these are internal/test calls. */
export const OWN_NUMBERS = new Set<string>([...Array.from(STAFF_PHONES), '7608237963',
  ...[process.env.TWILIO_FROM_NUMBER, process.env.PHONE_CALL_FORWARD_MAIN, process.env.PHONE_CALL_FORWARD_RANSOM, process.env.SCWS_OWN_NUMBERS]
    .flatMap((v) => (v ?? '').split(',')).map((v) => { const d = v.replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d; }).filter((d) => d.length === 10)]);
export const isOwnNumber = (phone: string | null | undefined) => { const d = (phone ?? '').replace(/\D/g, ''); return OWN_NUMBERS.has(d.length === 11 && d.startsWith('1') ? d.slice(1) : d); };
/** Number Twilio dials for the shop (SCWS Forward). Not a customer. Reads env at call time. */
export function isShopForwardNumber(phone: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const d = (phone ?? '').replace(/\D/g, '');
  const n = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (n.length !== 10) return false;
  const targets = [env.PHONE_CALL_FORWARD_MAIN, env.PHONE_CALL_FORWARD_RANSOM]
    .flatMap((value) => (value ?? '').split(','))
    .map((value) => { const x = value.replace(/\D/g, ''); return x.length === 11 && x.startsWith('1') ? x.slice(1) : x; })
    .filter((value) => value.length === 10);
  return targets.includes(n);
}
/**
 * Owner/test phones: Brighton's cell (408-318-1171) and the Twilio test line (760-823-7963).
 * Their calls are test traffic on dashboards, call lists, metrics, callback tracking and the daily review.
 * Dashboard-only on purpose: Mike, callbacks and missed-call texts keep treating Brighton's cell as a normal caller
 * (isOwnNumber is unchanged) so his live tests still behave like a customer call.
 */
export const TEST_CALLER_PHONES = new Set<string>(['4083181171', '7608237963']);
export const isTestCallerPhone = (phone: string | null | undefined) => { const d = (phone ?? '').replace(/\D/g, ''); return TEST_CALLER_PHONES.has(d.length === 11 && d.startsWith('1') ? d.slice(1) : d); };
/** Excluded from every dashboard count/list: SCWS's own lines and staff, plus owner/test phones. */
export const isExcludedCaller = (phone: string | null | undefined) => isOwnNumber(phone) || isTestCallerPhone(phone);
const TOLL_FREE = new Set(['800', '833', '844', '855', '866', '877', '888']);
const SPAM = /spam|robocall|wrong number|telemarket|solicit|marketing|\bSEO\b|google (listing|business)|sales department|extended warranty on (your|their) (car|vehicle)/i;
const REAL_NEED = /no water|pressure|pump|well (is|has|stopped)|drill/i;
const VENDOR = /insurance|home ?guard|supplier|vendor|distributor|adjuster|permit office/i;
const EXISTING_TEXT = /cancel|reschedul|confirm (their|the|her|his)? ?(scheduled|appointment)|existing appointment|invoice|\bbill\b|follow up on a previous|scheduled (well|service)|pick up the old/i;
const DAY = 86400_000;

export function classifyRealLeads(input: {
  calls: LeadCall[];
  /** Other inbound contact (Voice log etc.) used only as evidence the caller was reached. */
  contacts?: ContactEvent[];
  /** Earliest Jobber job createdAt (ms) per phone; null = no prior Jobber client/job; missing = unknown. */
  firstJobAt: Map<string, number | null>;
  /** Phones credited with a new-customer booking, with the booking's campaign type. */
  booked: Map<string, AdCategory | null>;
}): RealLeadsResult {
  const byPhone = new Map<string, LeadCall[]>();
  const reasons: RealLeadsResult['reasons'] = [];
  for (const c of input.calls) {
    const p = digits10(c.phone);
    if (!p || !Number.isFinite(Date.parse(c.at))) { reasons.push({ at: c.at, cat: c.cat, live: c.live, reason: 'hangup' }); continue; }
    const list = byPhone.get(p) ?? []; list.push(c); byPhone.set(p, list);
  }
  const reached = new Map<string, number[]>();
  for (const e of input.contacts ?? []) { const p = digits10(e.phone); const t = Date.parse(e.at); if (p && e.connected && Number.isFinite(t)) (reached.get(p) ?? reached.set(p, []).get(p)!).push(t); }
  const connected = (c: LeadCall) => !c.missed && (c.durationSec ?? 0) >= SHORT_CALL_SECONDS;
  const leads: RealLead[] = [];
  let unresolved = 0;
  for (const [p, raw] of Array.from(byPhone.entries())) {
    const list = [...raw].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const first = Date.parse(list[0].at);
    const text = list.map((c) => c.text || '').join(' ');
    const bookedCat = input.booked.has(p) ? input.booked.get(p) ?? null : undefined;
    let phoneReason: LeadReason | null = null;
    if (OWN_NUMBERS.has(p) || TEST_CALLER_PHONES.has(p)) phoneReason = 'internal';
    else if (bookedCat === undefined) {
      const fj = input.firstJobAt.get(p);
      if (fj === undefined) unresolved += 1;
      if (TOLL_FREE.has(p.slice(0, 3))) phoneReason = 'spam';
      else if (text.trim() && SPAM.test(text) && !REAL_NEED.test(text)) phoneReason = 'spam';
      else if (text.trim() && VENDOR.test(text) && !REAL_NEED.test(text)) phoneReason = 'spam';
      else if (fj != null && fj < first) phoneReason = 'existing';
      else if (text.trim() && EXISTING_TEXT.test(text)) phoneReason = 'existing';
      else {
        const anyConn = list.some(connected) || (reached.get(p) ?? []).some((t) => t >= first - 60_000 && t <= first + 7 * DAY);
        if (!anyConn) phoneReason = 'hangup';
      }
    }
    if (phoneReason) { for (const c of list) reasons.push({ at: c.at, cat: c.cat, live: c.live, reason: phoneReason }); continue; }
    // Real lead: counted once, on the caller's first call in the window.
    const firstConnIdx = list.findIndex(connected);
    list.forEach((c, i) => reasons.push({ at: c.at, cat: c.cat, live: c.live, reason: i === 0 ? 'lead' : (firstConnIdx < 0 || i <= firstConnIdx) && !connected(c) ? 'missed_later_reached' : 'repeat' }));
    const adCat = list.find((c) => c.cat)?.cat ?? null;
    leads.push({ phone: p, at: list[0].at, cat: bookedCat !== undefined ? bookedCat ?? adCat : adCat, booked: bookedCat !== undefined });
  }
  return { leads, reasons, unresolvedExisting: unresolved };
}
