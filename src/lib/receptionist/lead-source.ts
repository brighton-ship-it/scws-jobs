/**
 * Where a Mike call came from, for the per-call office email.
 *
 * The number the customer dialed rides on the SIP INVITE Vapi receives as the
 * Diversion header (Google Voice main line or a Twilio tracking number that
 * forwarded to Mike). A Twilio tracking-line recording (inbound_call_recordings)
 * for the same caller just before Mike picked up is also used, and beats a
 * generic Main/Ransom diversion (same rule as the call dashboard).
 * Channel names come from the dashboard's own map (sourceFromDialed).
 */
import { digits10, sourceFromDialed } from '../ads/call-dashboard.ts';
import { formatPhoneDisplay } from './office-callback.ts';

/** Dashboard short name -> wording for the office email. */
const FRIENDLY: Record<string, string> = {
  Ads: 'Google Ads',
  Website: 'Website (SEO)',
  Main: 'Main line',
  Ransom: 'Ransom line',
  'GBP Anza': 'Google Business Profile (Anza)',
  'GBP Ramona': 'Google Business Profile (Ramona)',
  GBP: 'Google Business Profile',
  Direct: 'Direct line',
  Yelp: 'Yelp',
  'Apple Maps': 'Apple Maps',
  'Toll-free': 'Toll-free line',
  'Line 823-7963': 'Test line',
};

type AnyRecord = Record<string, unknown>;
const rec = (v: unknown): AnyRecord | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : null);

/** All numbers in SIP Diversion header(s), most recent redirect first (RFC 5806 order). */
export function diversionNumbers(call: unknown): string[] {
  const sip = rec(rec(rec(call)?.phoneCallProviderDetails)?.sip);
  if (!sip) return [];
  const values: string[] = [];
  const headers = rec(sip.headers);
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() !== 'diversion') continue;
      if (typeof v === 'string') values.push(v);
      else if (Array.isArray(v)) values.push(...v.map(String));
    }
  }
  if (!values.length && typeof sip.raw === 'string') {
    for (const m of Array.from(sip.raw.matchAll(/^Diversion:\s*(.+)$/gim))) values.push(m[1]);
  }
  const out: string[] = [];
  for (const v of values) {
    for (const m of Array.from(v.matchAll(/sip:(\+?\d{10,15})@/g))) {
      const d = digits10(m[1]);
      if (d && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

/** The number Vapi itself answered on (Mike's line), as a last resort for "dialed". */
export function vapiAnsweredNumber(call: unknown): string | null {
  const c = rec(call);
  const pn = rec(c?.phoneNumber);
  const direct = typeof pn?.number === 'string' ? pn.number : null;
  if (direct) return digits10(direct);
  const to = rec(rec(rec(c?.phoneCallProviderDetails)?.sip)?.headers)?.to;
  const m = typeof to === 'string' ? to.match(/sip:(\+?\d{10,15})@/) : null;
  return m ? digits10(m[1]) : null;
}

export type RecordingHint = { tracking_number?: string | null; source?: string | null; started_at?: string | null };

export type LeadSource = { label: string | null; dialed: string | null };

const specific = (label: string | null) => !!label && label !== 'Main' && label !== 'Ransom';

/**
 * Pick the lead source. Tracking-line recordings and Diversion numbers are candidates;
 * a specific channel (Ads, GBP, SEO...) beats Main/Ransom; otherwise the first mapped one.
 */
export function resolveLeadSource(input: { diversions?: string[]; recordings?: RecordingHint[]; answered?: string | null }): LeadSource {
  const candidates: LeadSource[] = [];
  for (const r of input.recordings || []) {
    if ((r.source || '').toLowerCase() === 'test') continue;
    const label = sourceFromDialed(r.tracking_number, r.source);
    if (label) candidates.push({ label, dialed: digits10(r.tracking_number) });
  }
  // Last Diversion entry is the original number dialed; check it first.
  for (const d of [...(input.diversions || [])].reverse()) {
    const label = sourceFromDialed(d);
    candidates.push({ label, dialed: d });
  }
  const best = candidates.find((c) => specific(c.label)) || candidates.find((c) => c.label);
  if (best) return best;
  const dialed = candidates[0]?.dialed || digits10(input.answered) || null;
  return { label: null, dialed };
}

export function leadSourceLine(src: LeadSource): string {
  const num = src.dialed ? formatPhoneDisplay(src.dialed) : '';
  if (src.label) return `Lead source: ${FRIENDLY[src.label] ?? src.label}${num ? ` ${num}` : ''}`;
  return `Lead source: Unknown (${num ? `dialed ${num}` : 'dialed number not available'})`;
}

/** From Mike's lookupCustomer result on this call: existing Jobber client, new, or unknown (Mike never looked). */
export function jobberClientLine(messages: unknown[] | null | undefined): string | null {
  let status: string | null = null;
  for (const raw of messages || []) {
    const m = rec(raw);
    if (!m || (m.role !== 'tool_call_result' && m.role !== 'tool')) continue;
    if (String(m.name || '') !== 'lookupCustomer') continue;
    let r: unknown = m.result ?? m.content;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch { continue; } }
    let res = rec(r);
    if (res && rec(res.result)) res = rec(res.result);
    if (!res || typeof res.found !== 'boolean') continue;
    status = res.found
      ? `Existing Jobber client${typeof res.customerName === 'string' && res.customerName.trim() ? ` (${res.customerName.trim()})` : ''}`
      : 'New caller (number not in Jobber)';
    if (res.found) break;
  }
  return status ? `Client: ${status}` : null;
}
