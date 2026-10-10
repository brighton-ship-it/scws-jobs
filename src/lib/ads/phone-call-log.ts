/**
 * Inbound call log built from the Google Workspace Voice audit log (Reports API, app=voice).
 * Metadata only. Pure functions, no network.
 *
 * What the log provides (verified 2026-10-10):
 *  - RING_GROUP_INCOMING_CALL_RECEIVED: one per call to the main line ring group
 *    (source, destination, PARAM_DURATION talk ms, PARAM_RING_DURATION ms, DISTRIBUTION_ID).
 *  - INCOMING_CALL_RECEIVED: one per ringing user leg (actor email), same DISTRIBUTION_ID;
 *    a leg with duration > 0 is the person who answered.
 *  - RING_GROUP_OUTGOING_CALL_MADE to the Sarah/Mike Vapi number: the call was forwarded to the AI.
 * It has NO voicemail event and no user display names (email only). Events lag the call by a
 * few minutes and per-user legs can appear later than the ring-group event.
 */
import { normalizePhone } from './book-job.ts';

export const MIKE_FORWARD_NUMBER = '+17604915348';
export const MAIN_LINE = '+17604408520';
export type CallOutcome = 'answered' | 'missed' | 'forwarded_ai' | 'voicemail' | 'answered_unknown';

export interface PhoneLogRow {
  voice_call_key: string;
  started_at: string;
  direction: 'inbound';
  caller_phone: string | null;
  called_number: string | null;
  ring_group: string | null;
  duration_seconds: number | null;
  ring_seconds: number | null;
  outcome: CallOutcome;
  answered_by: string | null;
  legs: Array<{ email: string | null; duration_seconds: number; ring_seconds: number }>;
}

type Params = Map<string, string>;
interface Ev { time: string; qualifier: string | null; name: string; email: string | null; p: Params }

function flatten(payload: unknown): Ev[] {
  const items = payload && typeof payload === 'object' && Array.isArray((payload as any).items) ? (payload as any).items : [];
  const out: Ev[] = [];
  for (const item of items) {
    const time = item?.id?.time;
    if (typeof time !== 'string') continue;
    const email = typeof item?.actor?.email === 'string' ? item.actor.email : null;
    for (const event of Array.isArray(item.events) ? item.events : []) {
      const p: Params = new Map();
      for (const param of Array.isArray(event?.parameters) ? event.parameters : []) {
        const v = param?.value ?? param?.intValue ?? param?.boolValue;
        if (typeof param?.name === 'string' && v != null) p.set(param.name.toUpperCase(), String(v));
      }
      out.push({ time, qualifier: item?.id?.uniqueQualifier ?? null, name: String(event?.name || ''), email, p });
    }
  }
  return out;
}

const sec = (v: string | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n / 1000) : null;
};

export function parsePhoneCallLog(payload: unknown): PhoneLogRow[] {
  const events = flatten(payload);
  const legsById = new Map<string, Ev[]>();
  const forwards: Ev[] = [];
  for (const e of events) {
    if (e.name === 'INCOMING_CALL_RECEIVED') {
      const id = e.p.get('PARAM_DISTRIBUTION_ID');
      if (id) legsById.set(id, [...(legsById.get(id) ?? []), e]);
    } else if (e.name === 'RING_GROUP_OUTGOING_CALL_MADE' && e.p.get('PARAM_DESTINATION') === MIKE_FORWARD_NUMBER) {
      forwards.push(e);
    }
  }
  const rows: PhoneLogRow[] = [];
  const consumed = new Set<string>();
  const build = (e: Ev, key: string, legs: Ev[], ringGroup: string | null): PhoneLogRow => {
    const duration = sec(e.p.get('PARAM_DURATION'));
    const t = Date.parse(e.time);
    const caller = e.p.get('PARAM_SOURCE') ?? null;
    const forwarded = forwards.some(
      (f) => f.p.get('PARAM_SOURCE') === caller && Math.abs(Date.parse(f.time) - t) <= 10_000
    );
    const legRows = legs.map((l) => ({
      email: l.email,
      duration_seconds: sec(l.p.get('PARAM_DURATION')) ?? 0,
      ring_seconds: sec(l.p.get('PARAM_RING_DURATION')) ?? 0,
    }));
    const answerer = legRows.filter((l) => l.duration_seconds > 0).sort((a, b) => b.duration_seconds - a.duration_seconds)[0];
    let outcome: CallOutcome;
    if (forwarded) outcome = 'forwarded_ai';
    else if (answerer) outcome = 'answered';
    else if ((duration ?? 0) <= 0) outcome = 'missed';
    else outcome = 'answered_unknown';
    return {
      voice_call_key: key,
      started_at: e.time,
      direction: 'inbound',
      caller_phone: caller,
      called_number: e.p.get('PARAM_DESTINATION') ?? null,
      ring_group: ringGroup,
      duration_seconds: duration,
      ring_seconds: sec(e.p.get('PARAM_RING_DURATION')),
      outcome,
      answered_by: outcome === 'answered' ? answerer?.email ?? null : null,
      legs: legRows,
    };
  };
  for (const e of events) {
    if (e.name !== 'RING_GROUP_INCOMING_CALL_RECEIVED') continue;
    const id = e.p.get('PARAM_DISTRIBUTION_ID') ?? e.qualifier ?? e.time;
    if (consumed.has(id)) continue;
    consumed.add(id);
    rows.push(build(e, id, legsById.get(id) ?? [], e.p.get('PARAM_RING_GROUP_NAME') ?? null));
  }
  // Direct calls to a person's own Voice number (not part of a ring group call)
  for (const [id, legs] of Array.from(legsById.entries())) {
    if (consumed.has(id)) continue;
    consumed.add(id);
    const first = legs.sort((a: Ev, b: Ev) => b.time.localeCompare(a.time))[0];
    const row = build(first, id, legs, null);
    rows.push(row);
  }
  return rows.filter((r) => r.caller_phone);
}

export interface AdsCallLite { caller_phone: string | null; started_at: string | null; campaign_name: string | null; keyword: string | null; call_view_resource: string }
export interface ReceptionistLite { vapi_call_id: string; phone: string | null; called_at: string | null }
export interface Party { phone: string | null; customer_id: string | null; jobber_client_id: string | null; name?: string | null }

export interface EnrichedRow extends PhoneLogRow {
  customer_id: string | null;
  jobber_client_id: string | null;
  client_name: string | null;
  campaign_name: string | null;
  keyword: string | null;
  ads_call_resource: string | null;
  receptionist_call_id: string | null;
}

const within = (a: string | null, b: string, ms: number) => a != null && Math.abs(Date.parse(a) - Date.parse(b)) <= ms;

export function enrichPhoneLog(
  rows: PhoneLogRow[], ads: AdsCallLite[], mike: ReceptionistLite[], parties: Party[]
): EnrichedRow[] {
  const byPhone = new Map<string, Party>();
  for (const p of parties) {
    const n = normalizePhone(p.phone);
    if (n && !byPhone.has(n)) byPhone.set(n, p);
  }
  return rows.map((r) => {
    const n = normalizePhone(r.caller_phone);
    const ad = n ? ads.find((a) => normalizePhone(a.caller_phone) === n && within(a.started_at, r.started_at, 10 * 60_000)) : undefined;
    const mk = n && r.outcome === 'forwarded_ai'
      ? mike.find((m) => normalizePhone(m.phone) === n && within(m.called_at, r.started_at, 10 * 60_000))
      : undefined;
    const party = n ? byPhone.get(n) : undefined;
    return {
      ...r,
      customer_id: party?.customer_id ?? null,
      jobber_client_id: party?.jobber_client_id ?? null,
      client_name: party?.name ?? null,
      campaign_name: ad?.campaign_name ?? null,
      keyword: ad?.keyword ?? null,
      ads_call_resource: ad?.call_view_resource ?? null,
      receptionist_call_id: mk?.vapi_call_id ?? null,
    };
  });
}
