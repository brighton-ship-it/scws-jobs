/**
 * Pure aggregation for the internal call-tracking dashboard (/ops/calls, /ops/calls/tv).
 * No network, no env. Inputs come from ads_calls, ads_offline_conversions, Google Ads
 * daily campaign cost, and (optionally) Jobber paid amounts.
 */
import { createHash } from 'node:crypto';

export const DASH_FLOOR_ISO = '2026-09-18T07:00:00.000Z'; // Sep 18 2026 00:00 PT
export const SHORT_CALL_SECONDS = 15;
export type DashRange = '7' | '30' | '90' | 'since';

export interface DashCall {
  started_at: string | null;
  duration_seconds: number | null;
  campaign_name: string | null;
  ad_group_name?: string | null;
  keyword: string | null;
  caller_area_code: string | null;
  caller_phone: string | null;
  call_status: string | null;
  call_source: string | null;
  customer_id: string | null;
  jobber_client_id: string | null;
  /** Live Mike/Vapi receptionist call (real time) */
  live?: boolean;
  live_booking_request?: boolean;
}

export interface DashConversion {
  jobber_job_id: string;
  conversion_at: string | null;
  value_usd: number | null;
  payload: unknown;
}

export interface SpendDay {
  date: string; // YYYY-MM-DD (account time zone, PT)
  campaign: string;
  costUsd: number;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const round = (n: number) => Math.round(n * 100) / 100;

export function digits10(phone: string | null | undefined): string | null {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) return d;
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  return null;
}

export function hashPhone(phone: string | null | undefined): string | null {
  const d = digits10(phone);
  return d ? sha(`+1${d}`) : null;
}

/** Mask all but the last 4 digits. */
export function maskPhone(phone: string | null | undefined, areaCode?: string | null): string {
  const d = digits10(phone);
  if (d) return `(•••) •••-${d.slice(6)}`;
  if (areaCode) return `(${areaCode}) •••-••••`;
  return 'Unknown';
}

const PT = 'America/Los_Angeles';

function ptParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: PT, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    minute: '2-digit', second: '2-digit',
  }).formatToParts(d);
  const g = (t: string) => Number(f.find((p) => p.type === t)?.value);
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), mi: g('minute'), s: g('second') };
}

/** UTC instant of 00:00 Pacific for the PT calendar day containing `d`, shifted by `dayOffset` days. */
export function ptStartOfDay(d: Date, dayOffset = 0): Date {
  const p = ptParts(d);
  const guess = Date.UTC(p.y, p.m - 1, p.d + dayOffset, 0, 0, 0);
  // Pacific is UTC-7 or UTC-8; find the offset that lands on local midnight.
  for (const off of [7, 8]) {
    const t = new Date(guess + off * 3600_000);
    const q = ptParts(t);
    if (q.h === 0 && q.mi === 0) return t;
  }
  return new Date(guess + 8 * 3600_000);
}

export function ptDateKey(d: Date): string {
  const p = ptParts(d);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function ptWeekStart(d: Date): Date {
  // Monday-based week in PT
  const day = new Date(Date.UTC(ptParts(d).y, ptParts(d).m - 1, ptParts(d).d)).getUTCDay(); // 0=Sun
  return ptStartOfDay(d, -((day + 6) % 7));
}

export function ptMonthStart(d: Date): Date {
  const p = ptParts(d);
  return ptStartOfDay(new Date(Date.UTC(p.y, p.m - 1, 1, 12)), 0);
}

export function parseRange(raw: string | null | undefined): DashRange {
  return raw === '7' || raw === '30' || raw === '90' || raw === 'since' ? raw : 'since';
}

export function rangeStart(range: DashRange, now: Date): Date {
  if (range === 'since') return new Date(DASH_FLOOR_ISO);
  return ptStartOfDay(now, -(Number(range) - 1));
}

export function isShort(call: Pick<DashCall, 'duration_seconds' | 'call_status'>): boolean {
  return (call.duration_seconds ?? 0) < SHORT_CALL_SECONDS;
}

export function isAnswered(call: Pick<DashCall, 'duration_seconds' | 'call_status'>): boolean {
  if ((call.call_status || '').toUpperCase() === 'MISSED') return false;
  return !isShort(call);
}

export interface ConvStages {
  booking: number;
  approved: number | null;
  invoiced: number | null;
}

export function stagesOf(c: DashConversion): ConvStages {
  const p = c.payload && typeof c.payload === 'object' ? (c.payload as Record<string, any>) : {};
  const s = p.stages && typeof p.stages === 'object' ? p.stages : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    booking: num(s.booking) ?? num(c.value_usd) ?? 0,
    approved: num(s.approved),
    invoiced: num(s.invoiced),
  };
}

export function convPhoneHashes(c: DashConversion): string[] {
  const p = c.payload && typeof c.payload === 'object' ? (c.payload as Record<string, any>) : {};
  const conv = p.conversion && typeof p.conversion === 'object' ? p.conversion : p;
  const ids = conv.user_identifiers ?? conv.userIdentifiers;
  if (!Array.isArray(ids)) return [];
  return ids
    .map((i: any) => i?.hashed_phone_number ?? i?.hashedPhoneNumber)
    .filter((h: unknown): h is string => typeof h === 'string');
}

export function bestValue(s: ConvStages): number {
  return Math.max(s.booking, s.approved ?? 0, s.invoiced ?? 0);
}

export interface GroupRow {
  key: string;
  calls: number;
  answered: number;
  short: number;
  booked: number;
  spend: number | null;
  costPerCall: number | null;
  invoiced: number;
}

export interface Dashboard {
  range: DashRange;
  start: string;
  revenueStart: string;
  totals: {
    calls: number; answered: number; missedOrShort: number; matched: number;
    bookedNew: number; knownExisting: number; unmatched: number;
    quoteValue: number; bookedValue: number; invoicedValue: number; paidValue: number | null;
    perCall: { booked: number | null; quote: number | null; invoiced: number | null };
    spend: number | null; costPerCall: number | null; costPerBooked: number | null;
    multipleInvoiced: number | null; multiplePaid: number | null;
  };
  byCampaign: GroupRow[];
  byKeyword: GroupRow[];
  byTrackingNumber: GroupRow[];
  recent: Array<{
    at: string | null; phone: string; durationSeconds: number | null; campaign: string;
    outcome: string; value: number | null;
  }>;
  tv: {
    callsToday: number; answeredToday: number; missedToday: number;
    bookedToday: number; bookedWeek: number;
    revenueWeek: { invoiced: number; paid: number | null };
    revenueMonth: { invoiced: number; paid: number | null };
    spendMonth: number | null; multipleMonth: number | null;
    ticker: Array<{ at: string | null; kind: 'call' | 'booking'; text: string }>;
  };
  gaps: string[];
}

function group(
  calls: Array<DashCall & { _booked: boolean; _inv: number }>,
  keyOf: (c: DashCall) => string,
  spendByKey?: Map<string, number>
): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const c of calls) {
    const key = keyOf(c) || '(none)';
    const r = map.get(key) ?? { key, calls: 0, answered: 0, short: 0, booked: 0, spend: null, costPerCall: null, invoiced: 0 };
    r.calls += 1;
    if (isAnswered(c)) r.answered += 1;
    if (isShort(c)) r.short += 1;
    if (c._booked) { r.booked += 1; r.invoiced += c._inv; }
    map.set(key, r);
  }
  const rows = Array.from(map.values());
  for (const r of rows) {
    r.invoiced = round(r.invoiced);
    const sp = spendByKey?.get(r.key);
    if (sp != null) { r.spend = round(sp); r.costPerCall = r.calls ? round(sp / r.calls) : null; }
  }
  return rows.sort((a, b) => b.calls - a.calls);
}

export function buildDashboard(input: {
  calls: DashCall[];
  conversions: DashConversion[];
  spend: SpendDay[] | null;
  paidByJob: Map<string, number> | null;
  range: DashRange;
  now?: Date;
}): Dashboard {
  const now = input.now ?? new Date();
  const floor = new Date(DASH_FLOOR_ISO);
  const start = rangeStart(input.range, now);
  const revStart = start < floor ? floor : start;
  const gaps: string[] = [];

  const inRange = (iso: string | null, from: Date) => !!iso && Date.parse(iso) >= from.getTime();
  const callsAll = input.calls.filter((c) => inRange(c.started_at, start));

  const convs = input.conversions;
  const convByHash = new Map<string, DashConversion>();
  for (const c of convs) for (const h of convPhoneHashes(c)) if (!convByHash.has(h)) convByHash.set(h, c);

  const decorated = callsAll.map((c) => {
    const h = hashPhone(c.caller_phone);
    const conv = h ? convByHash.get(h) : undefined;
    const st = conv ? stagesOf(conv) : null;
    return Object.assign({}, c, { _booked: !!conv, _inv: st ? (st.invoiced ?? 0) : 0, _conv: conv ?? null });
  });

  // Per-conversion (job) money, windowed by booking time.
  const convWindow = convs.filter((c) => inRange(c.conversion_at, revStart));
  const sum = (list: DashConversion[], pick: (s: ConvStages) => number) =>
    round(list.reduce((a, c) => a + pick(stagesOf(c)), 0));
  const invoicedOf = (s: ConvStages) => s.invoiced ?? 0;
  const paidSum = (list: DashConversion[]): number | null =>
    input.paidByJob ? round(list.reduce((a, c) => a + (input.paidByJob!.get(c.jobber_job_id) ?? 0), 0)) : null;

  const spendSlice = (from: Date, to: Date = now): number | null => {
    if (!input.spend) return null;
    const a = ptDateKey(from), b = ptDateKey(to);
    return round(input.spend.filter((d) => d.date >= a && d.date <= b).reduce((x, d) => x + d.costUsd, 0));
  };
  if (!input.spend) gaps.push('Ad spend unavailable (Google Ads not configured or query failed).');
  if (!input.paidByJob) gaps.push('Paid amounts unavailable (Jobber read failed); paid multiple hidden.');

  const spend = spendSlice(revStart);
  const spendByCampaign = new Map<string, number>();
  if (input.spend) {
    const a = ptDateKey(start);
    for (const d of input.spend) if (d.date >= a) spendByCampaign.set(d.campaign, (spendByCampaign.get(d.campaign) ?? 0) + d.costUsd);
  }

  const bookedCalls = decorated.filter((c) => c._booked).length;
  const known = decorated.filter((c) => !c._booked && (c.customer_id || c.jobber_client_id)).length;
  const matched = decorated.filter((c) => c.caller_phone).length;
  const invoicedValue = sum(convWindow, invoicedOf);
  const paidValue = paidSum(convWindow);
  const callsN = callsAll.length;
  const ratio = (a: number, b: number | null) => (b && b > 0 ? round(a / b) : null);

  const noKeyword = decorated.every((c) => !c.keyword);
  if (noKeyword) gaps.push('Keyword is not returned by Google Ads call_view, so the keyword table shows ad group instead.');
  gaps.push('Tracking number is not stored; the table shows the call source/area code reported by Google Ads.');
  gaps.push('New vs existing: booked = new customer (offline-conversion rules); "known" = phone matches a CRM/Jobber client with no new-customer booking.');
  gaps.push('Live vs delayed: calls answered by Mike (AI receptionist) appear within about a minute of hang-up. Google Ads call data (campaign, ad source) is synced every 15 minutes, but Google itself can report calls hours late, so ad-attributed counts and today\'s ad calls may lag. Jobber bookings/payments refresh about every 10-15 minutes. Spend is daily.');
  gaps.push('Revenue, spend and multiples count from Sep 18, 2026 (when closed-loop tracking began).');

  const outcome = (c: (typeof decorated)[number]): string => {
    if (c._booked) return 'Booked (new)';
    if (c.live) return c.live_booking_request ? 'Mike: booking request taken' : isShort(c) ? 'Mike: short / hang-up' : 'Mike: answered';
    if (c.customer_id || c.jobber_client_id) return 'Existing/known client';
    if (isShort(c)) return 'Short / missed';
    return 'Answered';
  };

  const recent = [...decorated]
    .sort((a, b) => Date.parse(b.started_at || '') - Date.parse(a.started_at || ''))
    .slice(0, 25)
    .map((c) => ({
      at: c.started_at,
      phone: maskPhone(c.caller_phone, c.caller_area_code),
      durationSeconds: c.duration_seconds,
      campaign: c.campaign_name || '(unknown)',
      outcome: outcome(c),
      value: c._conv ? bestValue(stagesOf(c._conv)) : null,
    }));

  // TV tiles (independent of the selected range)
  const todayStart = ptStartOfDay(now);
  const weekStart = ptWeekStart(now);
  const monthStart = ptMonthStart(now);
  const callsToday = input.calls.filter((c) => inRange(c.started_at, todayStart));
  const convWeek = convs.filter((c) => inRange(c.conversion_at, weekStart));
  const convMonth = convs.filter((c) => inRange(c.conversion_at, monthStart < floor ? floor : monthStart));
  const spendMonth = spendSlice(monthStart < floor ? floor : monthStart);
  const monthInv = sum(convMonth, invoicedOf);

  const ticker = [
    ...input.calls
      .filter((c) => inRange(c.started_at, ptStartOfDay(now, -2)))
      .map((c) => ({
        at: c.started_at,
        kind: 'call' as const,
        text: `${maskPhone(c.caller_phone, c.caller_area_code)} · ${c.campaign_name || 'unknown'} · ${
          isAnswered(c) ? `${c.duration_seconds ?? 0}s answered` : 'missed/short'
        }`,
      })),
    ...convs
      .filter((c) => inRange(c.conversion_at, ptStartOfDay(now, -6)))
      .map((c) => ({
        at: c.conversion_at,
        kind: 'booking' as const,
        text: `Booked job · $${Math.round(bestValue(stagesOf(c))).toLocaleString('en-US')}`,
      })),
  ]
    .sort((a, b) => Date.parse(b.at || '') - Date.parse(a.at || ''))
    .slice(0, 20);

  return {
    range: input.range,
    start: start.toISOString(),
    revenueStart: revStart.toISOString(),
    totals: {
      calls: callsN,
      answered: decorated.filter(isAnswered).length,
      missedOrShort: decorated.filter((c) => !isAnswered(c)).length,
      matched,
      bookedNew: bookedCalls,
      knownExisting: known,
      unmatched: callsN - bookedCalls - known,
      quoteValue: sum(convWindow, (s) => s.approved ?? 0),
      bookedValue: sum(convWindow, (s) => s.booking),
      invoicedValue,
      paidValue,
      perCall: {
        booked: callsN ? round(sum(convWindow, (s) => s.booking) / callsN) : null,
        quote: callsN ? round(sum(convWindow, (s) => s.approved ?? 0) / callsN) : null,
        invoiced: callsN ? round(invoicedValue / callsN) : null,
      },
      spend,
      costPerCall: spend != null && callsN ? round(spend / callsN) : null,
      costPerBooked: spend != null && convWindow.length ? round(spend / convWindow.length) : null,
      multipleInvoiced: ratio(invoicedValue, spend),
      multiplePaid: paidValue == null ? null : ratio(paidValue, spend),
    },
    byCampaign: group(decorated, (c) => c.campaign_name || '', spendByCampaign),
    byKeyword: group(decorated, (c) => c.keyword || (c.ad_group_name ? `ad group: ${c.ad_group_name}` : '')),
    byTrackingNumber: group(decorated, (c) => c.call_source || (c.caller_area_code ? `area ${c.caller_area_code}` : '')),
    recent,
    tv: {
      callsToday: callsToday.length,
      answeredToday: callsToday.filter(isAnswered).length,
      missedToday: callsToday.filter((c) => !isAnswered(c)).length,
      bookedToday: convs.filter((c) => inRange(c.conversion_at, todayStart)).length,
      bookedWeek: convWeek.length,
      revenueWeek: { invoiced: sum(convWeek, invoicedOf), paid: paidSum(convWeek) },
      revenueMonth: { invoiced: monthInv, paid: paidSum(convMonth) },
      spendMonth,
      multipleMonth: ratio(monthInv, spendMonth),
      ticker,
    },
    gaps,
  };
}


export interface LiveCallRow {
  vapi_call_id: string;
  phone: string | null;
  duration_sec: number | null;
  called_at: string | null;
}

/**
 * Convert receptionist (Mike/Vapi) calls into DashCalls, dropping any that already appear in
 * ads_calls (same phone within 15 minutes) so a call is never counted twice.
 */
export function mergeLiveCalls(adsCalls: DashCall[], rows: LiveCallRow[]): Array<DashCall & { _vapi: string }> {
  const out: Array<DashCall & { _vapi: string }> = [];
  for (const r of rows) {
    const d = digits10(r.phone);
    const t = Date.parse(r.called_at || '');
    if (!d || !Number.isFinite(t)) continue;
    const dup = adsCalls.some(
      (a) => digits10(a.caller_phone) === d && Math.abs(Date.parse(a.started_at || '') - t) < 15 * 60_000
    );
    if (dup) continue;
    out.push({
      started_at: r.called_at,
      duration_seconds: r.duration_sec,
      campaign_name: '(Mike live call)',
      keyword: null,
      caller_area_code: d.slice(0, 3),
      caller_phone: d,
      call_status: null,
      call_source: 'Mike (AI receptionist)',
      customer_id: null,
      jobber_client_id: null,
      live: true,
      _vapi: r.vapi_call_id,
    });
  }
  return out;
}
