/**
 * Outbound calls placed from the Twilio tracking numbers. Metadata only.
 * Pure parse plus a thin fetch so the call-log cron and the dashboard can share it.
 */
import { TRACKING_SOURCES } from '../phone-calls/config.ts';
import { digits10 } from './call-dashboard.ts';
import type { PhoneLogRow } from './phone-call-log.ts';

const LINE_BY_SOURCE: Record<string, string> = {
  seo: 'Website', yelp: 'Yelp', apple_maps: 'Apple Maps', google_ads: 'Ads',
  gbp_ramona: 'GBP Ramona', gbp_anza: 'GBP Anza', direct: 'Direct',
};

export function trackingNumberSet(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const set = new Set<string>();
  for (const number of Object.keys(TRACKING_SOURCES)) {
    const d = digits10(number);
    if (d) set.add(d);
  }
  for (const part of (env.TWILIO_TRACKING_NUMBERS ?? '').split(',')) {
    const d = digits10(part);
    if (d) set.add(d);
  }
  return set;
}

function lineFor(from: string | null): string {
  const d = digits10(from);
  if (!d) return 'Tracking';
  const e164 = `+1${d}`;
  const source = TRACKING_SOURCES[e164];
  return (source && LINE_BY_SOURCE[source]) || 'Tracking';
}

/** Twilio Calls.json page -> outbound rows from our tracking numbers only. */
export function parseTwilioOutbound(payload: unknown, tracking: Set<string> = trackingNumberSet()): PhoneLogRow[] {
  const calls = payload && typeof payload === 'object' && Array.isArray((payload as any).calls) ? (payload as any).calls : [];
  const rows: PhoneLogRow[] = [];
  const seen = new Set<string>();
  for (const c of calls) {
    const direction = String(c?.direction || '');
    if (!direction.startsWith('outbound')) continue;
    const from = typeof c?.from === 'string' ? c.from : null;
    const to = typeof c?.to === 'string' ? c.to : null;
    const fromD = digits10(from);
    const toD = digits10(to);
    if (!fromD || !tracking.has(fromD) || !toD || tracking.has(toD)) continue;
    const sid = typeof c?.sid === 'string' && c.sid ? c.sid : null;
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const started = typeof c?.start_time === 'string' ? c.start_time : typeof c?.date_created === 'string' ? c.date_created : null;
    const t = started ? Date.parse(started) : NaN;
    if (!Number.isFinite(t)) continue;
    const duration = c?.duration == null || c.duration === '' ? null : Number(c.duration);
    const durationSeconds = duration != null && Number.isFinite(duration) ? Math.round(duration) : null;
    rows.push({
      voice_call_key: `twilio:${sid}`,
      started_at: new Date(t).toISOString(),
      direction: 'outbound',
      caller_phone: toD.length === 10 ? `+1${toD}` : to,
      called_number: from,
      ring_group: lineFor(from),
      duration_seconds: durationSeconds,
      ring_seconds: null,
      outcome: (durationSeconds ?? 0) > 0 ? 'answered' : 'missed',
      answered_by: null,
      legs: [],
    });
  }
  return rows;
}

export async function fetchTwilioOutbound(
  startIso: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<PhoneLogRow[]> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return [];
  const tracking = trackingNumberSet(env);
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const day = new Date(startIso).toISOString().slice(0, 10);
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json?PageSize=200&${encodeURIComponent('StartTime>')}=${day}`;
  const rows: PhoneLogRow[] = [];
  for (let page = 0; page < 5 && url; page += 1) {
    const response = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Twilio calls failed (${response.status})`);
    const body = await response.json() as { calls?: unknown[]; next_page_uri?: string | null };
    rows.push(...parseTwilioOutbound(body, tracking));
    url = body.next_page_uri ? `https://api.twilio.com${body.next_page_uri}` : null;
  }
  return rows;
}
