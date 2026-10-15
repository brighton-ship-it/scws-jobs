/**
 * Outbound calls placed from the Twilio tracking numbers. Metadata only.
 * Pure parse plus a thin fetch so the call-log cron and the dashboard can share it.
 */
import { TRACKING_SOURCES } from '../phone-calls/config.ts';
import { COLLECTIONS_E164 } from '../collections/policy.ts';
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

export interface TwilioText {
  sid: string;
  at: string;
  to: string | null;
  body: string;
}

/** Outbound SMS from the shop collections number. Tracking-line calls are not texts. */
export function parseTwilioCollectionMessages(payload: unknown, fromNumbers: Set<string>): TwilioText[] {
  const messages = payload && typeof payload === 'object' && Array.isArray((payload as any).messages) ? (payload as any).messages : [];
  const rows: TwilioText[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const direction = String(message?.direction || '');
    if (direction && !direction.startsWith('outbound')) continue;
    const from = digits10(typeof message?.from === 'string' ? message.from : null);
    if (fromNumbers.size && (!from || !fromNumbers.has(from))) continue;
    const sid = typeof message?.sid === 'string' && message.sid ? message.sid : null;
    if (!sid || seen.has(sid)) continue;
    const started = typeof message?.date_sent === 'string' && message.date_sent
      ? message.date_sent
      : typeof message?.date_created === 'string' ? message.date_created : null;
    const t = started ? Date.parse(started) : NaN;
    if (!Number.isFinite(t)) continue;
    seen.add(sid);
    const to = typeof message?.to === 'string' ? message.to : null;
    rows.push({
      sid,
      at: new Date(t).toISOString(),
      to,
      body: typeof message?.body === 'string' ? message.body : '',
    });
  }
  return rows;
}

export function collectionFromNumbers(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const set = new Set<string>();
  for (const raw of [COLLECTIONS_E164, env.TWILIO_FROM_NUMBER]) {
    const d = digits10(raw);
    if (d) set.add(d);
  }
  return set;
}

export async function fetchTwilioCollectionMessages(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ texts: TwilioText[]; ok: boolean; note: string | null }> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return { texts: [], ok: false, note: 'Twilio message list unavailable.' };
  const fromNumbers = collectionFromNumbers(env);
  if (!fromNumbers.size) return { texts: [], ok: false, note: 'Twilio message list unavailable.' };
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const day = new Date(Date.now() - 200 * 86400_000).toISOString().slice(0, 10);
  const texts: TwilioText[] = [];
  try {
    for (const from of fromNumbers) {
      const e164 = `+${from.length === 10 ? `1${from}` : from}`;
      let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json?PageSize=200&From=${encodeURIComponent(e164)}&${encodeURIComponent('DateSent>')}=${day}`;
      for (let page = 0; page < 8 && url; page += 1) {
        const response = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Twilio messages failed (${response.status})`);
        const body = await response.json() as { messages?: unknown[]; next_page_uri?: string | null };
        texts.push(...parseTwilioCollectionMessages(body, fromNumbers));
        url = body.next_page_uri ? `https://api.twilio.com${body.next_page_uri}` : null;
      }
    }
  } catch (error) {
    return { texts: [], ok: false, note: `Twilio message list unavailable${error instanceof Error ? `: ${error.message}` : ''}.` };
  }
  return { texts, ok: true, note: null };
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
