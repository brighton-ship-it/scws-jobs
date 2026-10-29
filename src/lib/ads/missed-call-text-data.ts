/**
 * Load missed-call auto-texts for the office dashboard.
 * Delivery refresh is a Twilio GET. This file never creates or sends a message.
 */
import { digits10 } from './call-dashboard.ts';
import { buildMissedCallTextView, type InboundSms, type MissedCallTextView, type TextJobMatch, type TextLogRow } from './missed-call-text-feed.ts';

const COLS = 'id, caller_phone, called_number, customer_name, missed_at, sent_at, outcome, body, thread_status, thread, twilio_message_sid, delivery_status, delivery_error, delivery_updated_at';
const COLS_BASE = 'id, caller_phone, called_number, customer_name, missed_at, sent_at, outcome, body, thread_status, thread, twilio_message_sid';
const TERMINAL = new Set(['delivered', 'undelivered', 'failed', 'read']);
const REFRESH_MIN_MS = 2 * 60_000;
const REFRESH_CAP = 6;
const LOOKBACK_MS = 2 * 86400_000;

let deliveryColumnMissing = false;

/** Tests only. The dashboard remembers a missing delivery column so it does not re-read Twilio on every refresh. */
export function resetDeliveryColumnCache(): void {
  deliveryColumnMissing = false;
}

export interface LoadedMissedTexts {
  view: MissedCallTextView;
  note: string | null;
}

function emptyView(): MissedCallTextView {
  return { sent: 0, replied: 0, replyRate: null, booked: 0, failed: 0, rows: [], hidden: 0 };
}

async function selectTexts(db: any, sinceIso: string): Promise<{ rows: TextLogRow[]; note: string | null }> {
  const widen = new Date(Date.parse(sinceIso) - LOOKBACK_MS).toISOString();
  const run = async (cols: string) => db.from('missed_call_texts').select(cols).in('outcome', ['sent', 'failed', 'sending']).gte('missed_at', widen).order('missed_at', { ascending: false }).limit(500);
  let result = await run(deliveryColumnMissing ? COLS_BASE : COLS);
  const message = String(result?.error?.message || '');
  if (result?.error && /delivery_status|delivery_error|delivery_updated_at/i.test(message)) {
    deliveryColumnMissing = true;
    result = await run(COLS_BASE);
  }
  if (result?.error) {
    if (/missed_call_texts|does not exist|schema cache/i.test(String(result.error.message))) {
      return { rows: [], note: 'missed-call texts: table is not in this database yet' };
    }
    return { rows: [], note: `missed-call texts: ${result.error.message}` };
  }
  return { rows: (result.data ?? []) as TextLogRow[], note: null };
}

function needsRefresh(row: TextLogRow & { delivery_updated_at?: string | null }, now: number): boolean {
  if (row.outcome !== 'sent' || !row.twilio_message_sid) return false;
  if (TERMINAL.has((row.delivery_status || '').toLowerCase())) return false;
  const at = Date.parse(row.delivery_updated_at || '');
  return !Number.isFinite(at) || now - at >= REFRESH_MIN_MS;
}

/** GET Twilio message status for texts still waiting on a carrier result. Never POSTs. */
export async function refreshDeliveries(
  rows: Array<TextLogRow & { delivery_updated_at?: string | null }>,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch,
  db: any,
  now = Date.now(),
): Promise<Record<string, { status: string | null; error: string | null }>> {
  const out: Record<string, { status: string | null; error: string | null }> = {};
  if (deliveryColumnMissing) return out;
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return out;
  const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
  const pending = rows.filter((row) => needsRefresh(row, now))
    .sort((a, b) => Date.parse(a.sent_at || a.missed_at || '') - Date.parse(b.sent_at || b.missed_at || ''))
    .slice(0, REFRESH_CAP);
  await Promise.all(pending.map(async (row) => {
    const messageSid = row.twilio_message_sid;
    if (!messageSid) return;
    try {
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages/${encodeURIComponent(messageSid)}.json`, {
        method: 'GET',
        headers: { Authorization: auth },
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return;
      const data = await res.json() as { status?: unknown; error_code?: unknown };
      const status = typeof data.status === 'string' ? data.status.toLowerCase() : '';
      if (!status) return;
      const error = data.error_code != null && data.error_code !== 0 ? String(data.error_code) : null;
      out[row.id] = { status, error };
      const saved = await db.from('missed_call_texts').update({
        delivery_status: status,
        delivery_error: error,
        delivery_updated_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      }).eq('id', row.id);
      if (saved?.error && /delivery_status|delivery_error|delivery_updated_at/i.test(String(saved.error.message || ''))) deliveryColumnMissing = true;
    } catch { /* dashboard still shows the status stored on the row */ }
  }));
  return out;
}

function smsReplies(rows: Array<{ phone_number?: string | null; messages?: unknown }>): InboundSms[] {
  const out: InboundSms[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.messages)) continue;
    for (const message of row.messages) {
      if (!message || typeof message !== 'object') continue;
      const m = message as { role?: string; content?: string; timestamp?: string; at?: string; sid?: string | null };
      if (m.role && m.role !== 'user') continue;
      const at = m.timestamp || m.at || '';
      if (!at || !(m.content || '').trim()) continue;
      out.push({ phone: row.phone_number ?? null, at, body: m.content || '', sid: m.sid ?? null });
    }
  }
  return out;
}

async function loadExtraReplies(db: any, texts: TextLogRow[]): Promise<InboundSms[]> {
  const phones = new Set<string>();
  for (const row of texts) {
    const d = digits10(row.caller_phone);
    if (!d) continue;
    phones.add(`+1${d}`);
    phones.add(d);
    phones.add(`1${d}`);
  }
  const list: string[] = [];
  phones.forEach((phone) => list.push(phone));
  if (!list.length) return [];
  try {
    const result = await db.from('sms_conversations').select('phone_number, messages').in('phone_number', list.slice(0, 300));
    if (result?.error) return [];
    return smsReplies(result.data ?? []);
  } catch {
    return [];
  }
}

async function loadJobs(db: any, texts: TextLogRow[]): Promise<TextJobMatch[]> {
  const phones: string[] = [];
  const seen = new Set<string>();
  for (const row of texts) {
    const d = digits10(row.caller_phone);
    if (!d || seen.has(d)) continue;
    seen.add(d);
    phones.push(d);
  }
  if (!phones.length) return [];
  try {
    const clients = await db.from('jobber_clients').select('id, phones_digits').overlaps('phones_digits', phones);
    if (clients?.error) return [];
    const phoneByClient = new Map<string, string[]>();
    const ids: string[] = [];
    for (const client of clients.data ?? []) {
      if (!client?.id) continue;
      ids.push(client.id);
      phoneByClient.set(client.id, (client.phones_digits ?? []).map((p: string) => digits10(p)).filter(Boolean));
    }
    if (!ids.length) return [];
    const earliest = texts.reduce((min, row) => {
      const t = Date.parse(row.sent_at || row.missed_at || '');
      return Number.isFinite(t) ? Math.min(min, t) : min;
    }, Date.now());
    const jobs = await db.from('jobber_jobs').select('id, job_number, client_id, created_at').in('client_id', ids.slice(0, 200)).gte('created_at', new Date(earliest - 5 * 60_000).toISOString());
    if (jobs?.error) return [];
    const out: TextJobMatch[] = [];
    for (const job of jobs.data ?? []) {
      for (const phone of phoneByClient.get(job.client_id) ?? []) {
        out.push({ phone, id: job.id, jobNumber: job.job_number ?? null, createdAt: job.created_at ?? null });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadMissedCallTextView(
  db: any,
  sinceIso: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<LoadedMissedTexts> {
  const loaded = await selectTexts(db, sinceIso);
  if (loaded.note) return { view: emptyView(), note: loaded.note };
  const sinceMs = Date.parse(sinceIso);
  const delivery = await refreshDeliveries(loaded.rows, env, fetchImpl, db);
  const [extraReplies, jobs] = await Promise.all([
    loadExtraReplies(db, loaded.rows),
    loadJobs(db, loaded.rows.filter((row) => row.thread_status === 'booked' || /"booked"\s*:\s*true/.test(JSON.stringify(row.thread ?? '')))),
  ]);
  return {
    view: buildMissedCallTextView({
      rows: loaded.rows,
      sinceMs: Number.isFinite(sinceMs) ? sinceMs : 0,
      extraReplies,
      jobs,
      delivery,
    }),
    note: loaded.note,
  };
}
