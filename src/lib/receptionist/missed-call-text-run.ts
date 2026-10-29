/**
 * Missed-call text follow-up: load calls, decide, send at most one text per caller per 24h,
 * and run the AI text conversation for replies. I/O lives here; rules live in missed-call-text.ts.
 * Flag off (MISSED_CALL_TEXT_ENABLED unset and no MISSED_CALL_TEXT_TEST_NUMBERS) = nothing runs.
 *
 * Candidates come from Twilio inbound parent calls on every SCWS number, plus the callback
 * snapshot for anything that list missed. A shop leg counts only when it lasted ~20s.
 */
import { digits10 } from '../ads/call-dashboard.ts';
import { flags } from '../ads/callbacks.ts';
import { isOwnNumber } from '../ads/real-leads.ts';
import { AI_RECEPTIONIST } from '../phone-calls/config.ts';
import { loadCallbackSnapshot } from './mike-callback-run.ts';
import {
  callerTurns,
  classifyInboundParents,
  decideText,
  newestPerPhone,
  parseTwilioLegs,
  sameTextEpisode,
  staffPhoneSet,
  textAllowedFor,
  textConfig,
  trackingNumberForCaller,
  STOP_WORDS,
  START_WORDS,
  HELP_WORDS,
  THREAD_OPEN_MS,
  type BookingRow,
  type TextCandidate,
  type TextConfig,
  type TextContext,
  type TextDecision,
  type TwilioLeg,
} from './missed-call-text.ts';
import { runTextAgent, type ChatModel, type TextAgentTools, type ThreadMessage } from './text-agent.ts';

export class TextNotAllowedError extends Error {
  constructor(to: string) {
    super(`missed-call text not allowed to ***${digits10(to)?.slice(-4) ?? ''}`);
  }
}

export interface TextRunSummary {
  mode: TextConfig['mode'];
  sent: number;
  queued: number;
  skipped: number;
  errors: string[];
  notes: string[];
}

function twilioAuth(env: NodeJS.ProcessEnv): string | null {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return null;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

/** Twilio Lookup v2 line type ("mobile", "landline", "nonFixedVoip", ...). Null on failure. */
export async function lookupLineType(e164: string, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const auth = twilioAuth(env);
  if (!auth) return null;
  try {
    const res = await fetchImpl(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}?Fields=line_type_intelligence`, { headers: { Authorization: auth } });
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const t = data?.line_type_intelligence?.type;
    return typeof t === 'string' && t ? t : 'unknown';
  } catch {
    return null;
  }
}

function mikeNumberSet(env: NodeJS.ProcessEnv): Set<string> {
  const set = new Set<string>();
  for (const raw of [AI_RECEPTIONIST, env.PHONE_CALL_AI_NUMBER]) {
    const d = digits10(raw);
    if (d) set.add(d);
  }
  return set;
}

function phonesOf(client: { phones_digits?: string[] | null; phones?: unknown } | null | undefined): string[] {
  if (!client) return [];
  const raw = client.phones_digits ?? client.phones ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => digits10(typeof item === 'string' ? item : (item as { number?: string })?.number)).filter((d): d is string => !!d);
}

function missingTable(message: string): boolean {
  if (/column/i.test(message)) return false;
  return /relation ["']?[\w.]*jobber_requests["']? does not exist|could not find the table|PGRST205/i.test(message);
}

/** Twilio Calls.json pages for the lookback day. Parents and child legs. Empty note means the list loaded. */
export async function fetchTwilioCallLegs(
  sinceIso: string,
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ legs: TwilioLeg[]; note: string | null }> {
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  const token = env.TWILIO_AUTH_TOKEN?.trim();
  if (!sid || !token) return { legs: [], note: 'twilio calls: not_configured' };
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');
  const day = new Date(sinceIso).toISOString().slice(0, 10);
  let url: string | null = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json?PageSize=200&${encodeURIComponent('StartTime>')}=${day}`;
  const legs: TwilioLeg[] = [];
  try {
    for (let page = 0; page < 10 && url; page += 1) {
      const response = await fetchImpl(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Twilio calls failed (${response.status})`);
      const body = await response.json() as { calls?: unknown[]; next_page_uri?: string | null };
      legs.push(...parseTwilioLegs(body));
      url = body.next_page_uri ? `https://api.twilio.com${body.next_page_uri}` : null;
    }
  } catch (error) {
    return { legs: [], note: `twilio calls: ${error instanceof Error ? error.message : 'error'}` };
  }
  return { legs, note: null };
}

/** The only place a missed-call text or AI reply leaves the app. Re-checks the flag every time. */
export async function sendTextMessage(
  input: { to: string; body: string },
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sid: string }> {
  const config = textConfig(env);
  if (!textAllowedFor(input.to, config)) throw new TextNotAllowedError(input.to);
  const auth = twilioAuth(env);
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  if (!auth || !sid) throw new Error('twilio_not_configured');
  const form = new URLSearchParams({ To: input.to, Body: input.body, MessagingServiceSid: config.messagingServiceSid });
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !data?.sid) throw new Error(`twilio_${data?.code ?? res.status}`);
  return { sid: data.sid };
}

/** Office SMS (Liz by default, same targets as inbound-text forwarding). Not gated: it goes to staff only. */
export async function sendOfficeText(body: string, env: NodeJS.ProcessEnv, fetchImpl: typeof fetch = fetch): Promise<void> {
  const { forwardTargets, forwardMessagingServiceSid } = await import('../sms-forward/forward.ts');
  const auth = twilioAuth(env);
  const sid = env.TWILIO_ACCOUNT_SID?.trim();
  if (!auth || !sid) return;
  for (const to of forwardTargets(env)) {
    const form = new URLSearchParams({ To: to, Body: body.slice(0, 1500), MessagingServiceSid: forwardMessagingServiceSid(env) });
    await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    }).catch(() => undefined);
  }
}

const ROW_COLUMNS = 'id, missed_call_key, caller_phone, outcome, sent_at, thread_status, thread, customer_name, last_inbound_at';

export async function loadTextSnapshot(db: any, env: NodeJS.ProcessEnv, now: Date, fetchImpl: typeof fetch = fetch): Promise<{ calls: TextCandidate[]; ctx: TextContext; notes: string[] }> {
  const config = textConfig(env);
  const base = await loadCallbackSnapshot(db, env, now);
  const notes = [...base.notes];
  const since = new Date(now.getTime() - config.lookbackMs).toISOString();
  const sinceWide = new Date(now.getTime() - config.lookbackMs - 3600_000).toISOString();
  const read = async (label: string, q: PromiseLike<{ data: any[] | null; error: { message: string } | null }>) => {
    try {
      const r = await q;
      if (r.error) { notes.push(`${label}: ${r.error.message}`); return [] as any[]; }
      return r.data ?? [];
    } catch (e) { notes.push(`${label}: ${e instanceof Error ? e.message : 'error'}`); return [] as any[]; }
  };
  const readRequests = async () => {
    try {
      const r = await db.from('jobber_requests').select('id, client_id, created_at').gte('created_at', sinceWide).limit(2000);
      if (r.error) {
        const blob = `${r.error.code ?? ''} ${r.error.message ?? ''}`;
        if (!missingTable(blob)) notes.push(`jobber requests: ${r.error.message}`);
        return [] as any[];
      }
      return r.data ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'error';
      if (!missingTable(msg)) notes.push(`jobber requests: ${msg}`);
      return [] as any[];
    }
  };
  const [mike, office, texts, inboundLines, jobs, jobberRequests, twilio] = await Promise.all([
    read('mike calls', db.from('receptionist_calls').select('vapi_call_id, phone, customer_name, summary, transcript, duration_sec, called_at').gte('called_at', since).limit(500)),
    read('office requests', db.from('booking_requests').select('vapi_call_id, phone, service_type, created_at').gte('created_at', sinceWide).limit(1000)),
    read('texts', db.from('missed_call_texts').select('missed_call_key, caller_phone, outcome, sent_at').gte('missed_at', new Date(now.getTime() - 3 * 86400_000).toISOString()).limit(2000)),
    // Mike rows have no called number. Match the inbound recording so a hang-up on Main
    // is the same line as a ring hang-up. A miss here must not block texts that already know the line.
    read('inbound lines', db.from('inbound_call_recordings').select('call_sid, caller_number, tracking_number, started_at, caller_name, summary, outcome').gte('started_at', new Date(now.getTime() - config.lookbackMs - 10 * 60_000).toISOString()).limit(500)),
    read('jobber jobs', db.from('jobber_jobs').select('id, client_id, created_at').gte('created_at', sinceWide).limit(2000)),
    readRequests(),
    fetchTwilioCallLegs(since, env, fetchImpl),
  ]);
  if (twilio.note) notes.push(twilio.note);

  const clientIds = Array.from(new Set([...jobs, ...jobberRequests].map((r) => r.client_id).filter(Boolean)));
  const clients: any[] = [];
  for (let i = 0; i < clientIds.length; i += 150) {
    const chunk = await read('jobber clients', db.from('jobber_clients').select('id, phones_digits').in('id', clientIds.slice(i, i + 150)));
    clients.push(...chunk);
  }
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const bookings: BookingRow[] = office.map((r) => ({
    vapiCallId: r.vapi_call_id ?? null,
    phone: r.phone ?? null,
    at: r.created_at,
    serviceType: r.service_type ?? null,
    kind: 'booking_request' as const,
  }));
  const pushJobber = (rows: any[], kind: 'jobber_job' | 'jobber_request') => {
    for (const row of rows) {
      if (!row.created_at) continue;
      for (const phone of phonesOf(clientById.get(row.client_id))) {
        bookings.push({ vapiCallId: null, phone, at: row.created_at, serviceType: null, kind });
      }
    }
  };
  pushJobber(jobs, 'jobber_job');
  pushJobber(jobberRequests, 'jobber_request');

  const calls: TextCandidate[] = [];
  for (const c of base.calls) {
    if (c.outcome === 'forwarded_ai') continue; // Mike took it; judged from receptionist_calls below
    calls.push({
      key: c.key, at: c.at, phone: c.phone, calledNumber: c.calledNumber,
      trigger: c.outcome === 'voicemail' ? 'voicemail' : 'ring_hangup',
      name: c.name, summary: c.summary, spam: c.spam, vendor: c.vendor,
    });
  }
  const lineRows = inboundLines.map((row) => ({ phone: row.caller_number ?? null, at: row.started_at, calledNumber: row.tracking_number ?? null }));
  const recordingBySid = new Map<string, any>(inboundLines.filter((row) => row.call_sid).map((row) => [row.call_sid, row]));
  const classified = classifyInboundParents({
    legs: twilio.legs,
    lines: config.lines,
    mikeNumbers: mikeNumberSet(env),
    sinceMs: now.getTime() - config.lookbackMs,
  });
  const shopAnswered = classified.filter((row) => row.shopAnswered);
  const twilioCandidates = classified.flatMap((row) => {
    if (!row.candidate) return [];
    const recording = recordingBySid.get(row.sid);
    const mikeRow = mike.find((r) => r.called_at && sameTextEpisode({ phone: r.phone, at: r.called_at }, row.candidate!));
    const name = (mikeRow?.customer_name && !/^caller:/i.test(mikeRow.customer_name) ? mikeRow.customer_name : null)
      ?? recording?.caller_name ?? null;
    const summary = mikeRow?.summary ?? recording?.summary ?? null;
    const f = flags(name, summary, row.candidate.phone, recording?.outcome ?? null);
    return [{
      ...row.candidate,
      trigger: mikeRow ? 'mike_unfinished' as const : row.candidate.trigger,
      vapiCallId: mikeRow?.vapi_call_id ?? null,
      name,
      summary,
      spam: f.spam,
      vendor: f.vendor,
    }];
  });
  const covered = (call: { phone: string | null; at: string }) => shopAnswered.some((row) => sameTextEpisode(call, row))
    || twilioCandidates.some((row) => sameTextEpisode(call, row));
  const kept = calls.filter((call) => !covered(call));
  kept.push(...twilioCandidates);
  for (const r of mike) {
    if (!r.called_at || isOwnNumber(r.phone)) continue;
    const at = r.called_at;
    const phone = r.phone ? `+${String(r.phone).replace(/\D/g, '').replace(/^(?!1)(\d{10})$/, '1$1')}` : null;
    if (covered({ phone, at })) continue;
    const f = flags(r.customer_name ?? null, r.summary ?? null, r.phone ?? null, null);
    const turns = callerTurns(r.transcript);
    kept.push({
      key: `vapi:${r.vapi_call_id || `${r.called_at}:${r.phone}`}`,
      at,
      phone,
      calledNumber: trackingNumberForCaller(r.phone, r.called_at, lineRows),
      trigger: turns === 0 || (Number(r.duration_sec) || 0) < 20 ? 'mike_hangup' : 'mike_unfinished',
      vapiCallId: r.vapi_call_id ?? null,
      name: r.customer_name && !/^caller:/i.test(r.customer_name) ? r.customer_name : null,
      summary: r.summary ?? null,
      spam: f.spam,
      vendor: f.vendor,
    });
  }
  const ctx: TextContext = {
    laterInbound: base.ctx.laterInbound.concat(mike.map((r) => ({ phone: r.phone, at: r.called_at }))),
    voiceAttempts: base.ctx.voiceAttempts,
    work: base.ctx.work,
    activeJobPhones: new Set(),
    unpaidPhones: base.ctx.unpaidPhones,
    holdPhones: base.ctx.holdPhones,
    holdNotes: base.ctx.holdNotes,
    dncPhones: base.ctx.dncPhones,
    texts: texts.map((t) => ({ key: t.missed_call_key, phone: t.caller_phone, outcome: t.outcome, sentAt: t.sent_at })),
    staffPhones: staffPhoneSet(env),
    bookings,
  };
  return { calls: newestPerPhone(kept), ctx, notes };
}

/** A failed exclusion read must not text anyone. Open invoices, holds, and active jobs are not exclusions. */
export function textPassBlocked(notes: string[]): string | null {
  return notes.find((n) => /^(mike calls|office requests|texts|opt-outs|jobber jobs|jobber clients|jobber requests):/.test(n)) ?? null;
}

export async function runMissedCallTextPass(db: any, env: NodeJS.ProcessEnv, now: Date, fetchImpl: typeof fetch = fetch): Promise<TextRunSummary> {
  const config = textConfig(env);
  const summary: TextRunSummary = { mode: config.mode, sent: 0, queued: 0, skipped: 0, errors: [], notes: [] };
  if (config.mode === 'off') return summary;
  const snap = await loadTextSnapshot(db, env, now, fetchImpl);
  summary.notes = snap.notes;
  const blocked = textPassBlocked(snap.notes);
  if (blocked) { summary.errors.push(blocked); return summary; }

  let budget = config.maxPerRun;
  for (const call of snap.calls) {
    let decision: TextDecision = decideText(call, snap.ctx, config, now, null);
    if (decision.action === 'skip') {
      if (!['flag_off', 'not_allowlisted', 'stale', 'already_handled', 'test_number', 'own_number', 'line_not_enabled'].includes(decision.reason)) {
        summary.skipped += 1;
        await saveRow(db, call, { outcome: 'skipped', reason: decision.reason });
      }
      continue;
    }
    if (decision.action === 'queue' && decision.reason !== 'too_soon') { summary.queued += 1; continue; }
    if (decision.action === 'queue' && Date.parse(decision.notBefore) > now.getTime()) { summary.queued += 1; continue; }
    if (budget <= 0) { summary.queued += 1; continue; }
    const to = decision.to;
    const lineType = await lookupLineType(to, env, fetchImpl);
    decision = decideText(call, snap.ctx, config, now, lineType ?? 'unknown');
    if (decision.action !== 'send') {
      if (decision.action === 'skip') { summary.skipped += 1; await saveRow(db, call, { outcome: 'skipped', reason: decision.reason, line_type: lineType }); }
      continue;
    }
    const claimed = await saveRow(db, call, { outcome: 'sending', body: decision.body, variant: config.option, line_type: lineType }, true);
    if (!claimed) continue;
    budget -= 1;
    try {
      const sent = await sendTextMessage({ to: decision.to, body: decision.body }, env, fetchImpl);
      await db.from('missed_call_texts').update({
        outcome: 'sent', sent_at: new Date().toISOString(), twilio_message_sid: sent.sid, thread_status: 'open',
        thread: [{ role: 'assistant', content: decision.body, at: new Date().toISOString() }], updated_at: new Date().toISOString(),
      }).eq('id', claimed);
      summary.sent += 1;
      snap.ctx.texts.push({ key: call.key, phone: decision.to, outcome: 'sent', sentAt: now.toISOString() });
    } catch (e) {
      const msg = e instanceof Error ? e.message.slice(0, 180) : 'send_failed';
      await db.from('missed_call_texts').update({ outcome: e instanceof TextNotAllowedError ? 'skipped' : 'failed', reason: msg, updated_at: new Date().toISOString() }).eq('id', claimed);
      summary.errors.push(msg);
    }
  }
  return summary;
}

async function saveRow(db: any, call: TextCandidate, patch: Record<string, unknown>, claim = false): Promise<string | null> {
  const row = {
    missed_call_key: call.key,
    caller_phone: digits10(call.phone),
    called_number: call.calledNumber,
    trigger: call.trigger,
    customer_name: call.name,
    missed_at: call.at,
    updated_at: new Date().toISOString(),
    ...patch,
  };
  const ins = await db.from('missed_call_texts').insert(row).select('id').single();
  if (!ins.error) return ins.data?.id ?? null;
  if (/duplicate|unique/i.test(ins.error.message)) return null; // already handled (or another run claimed it)
  if (claim) throw new Error(ins.error.message);
  return null;
}

// ---------- replies ----------

export interface ReplyOutcome {
  handled: boolean;
  reason: string;
  reply?: string;
  label?: string;
}

/** Open thread for this texter (we texted them in the last 72h and nobody closed it). */
export async function findOpenThread(db: any, from: string, now: Date): Promise<any | null> {
  const phone = digits10(from);
  if (!phone) return null;
  const r = await db.from('missed_call_texts').select(ROW_COLUMNS).eq('caller_phone', phone).eq('outcome', 'sent')
    .gte('sent_at', new Date(now.getTime() - THREAD_OPEN_MS).toISOString()).order('sent_at', { ascending: false }).limit(1);
  if (r.error) return null;
  return r.data?.[0] ?? null;
}

export function openAiChatModel(env: NodeJS.ProcessEnv): ChatModel | null {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return null;
  const model = env.MISSED_CALL_TEXT_MODEL?.trim() || 'gpt-4.1';
  return {
    async complete({ messages, tools }) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools, temperature: 0.3, max_tokens: 300 }),
      });
      if (!res.ok) throw new Error(`openai_${res.status}`);
      const data = (await res.json()) as any;
      return data?.choices?.[0]?.message ?? {};
    },
  };
}

/**
 * Called from /api/sms/forward for every inbound text. Does nothing (handled=false) unless the
 * flag allows this number AND we have an open missed-call thread with them. The office forward
 * to Liz happens regardless, in the route.
 */
export async function handleTextReply(input: {
  db: any;
  from: string;
  body: string;
  env: NodeJS.ProcessEnv;
  now: Date;
  tools: TextAgentTools;
  model?: ChatModel | null;
}): Promise<ReplyOutcome> {
  const config = textConfig(input.env);
  if (!textAllowedFor(input.from, config)) return { handled: false, reason: config.mode === 'off' ? 'flag_off' : 'not_allowed' };
  const row = await findOpenThread(input.db, input.from, input.now);
  if (!row) return { handled: false, reason: 'no_open_thread' };
  const status = row.thread_status || 'open';
  const thread: ThreadMessage[] = Array.isArray(row.thread) ? row.thread : [];
  const stamp = { last_inbound_at: input.now.toISOString(), updated_at: input.now.toISOString() };

  if (STOP_WORDS.test(input.body)) {
    await input.db.from('missed_call_texts').update({ ...stamp, thread_status: 'opted_out', thread: [...thread, { role: 'user', content: input.body, at: input.now.toISOString() }] }).eq('id', row.id);
    try { await input.db.from('sms_do_not_text').insert({ phone_e164: `+1${digits10(input.from)}` }); } catch { /* unique / missing table: Twilio still blocks */ }
    // Twilio's Advanced Opt-Out sends the carrier STOP confirmation. We send nothing.
    return { handled: true, reason: 'opted_out', label: 'texter replied STOP; no more texts' };
  }
  if (status === 'opted_out' && !START_WORDS.test(input.body)) return { handled: false, reason: 'opted_out' };
  if (HELP_WORDS.test(input.body)) return { handled: false, reason: 'help_keyword' };
  if (status !== 'open') return { handled: false, reason: `thread_${status}` };

  const model = input.model === undefined ? openAiChatModel(input.env) : input.model;
  if (!model) return { handled: false, reason: 'no_model' };
  const result = await runTextAgent({ phone: `+1${digits10(input.from)}`, inbound: input.body, thread, now: input.now, model, tools: input.tools });
  let sentSid: string | null = null;
  try {
    sentSid = (await sendTextMessage({ to: `+1${digits10(input.from)}`, body: result.reply }, input.env)).sid;
  } catch (e) {
    console.error('[missed-call-text] reply send failed', e instanceof Error ? e.message : e);
  }
  const nextStatus = result.booked ? 'booked' : result.handedOff ? 'handed_off' : 'open';
  await input.db.from('missed_call_texts').update({ ...stamp, thread: result.thread, thread_status: nextStatus }).eq('id', row.id);
  return {
    handled: true,
    reason: nextStatus,
    reply: result.reply,
    label: sentSid ? `AI replied${result.booked ? ' and booked' : result.handedOff ? ', handed to office' : ''}` : 'AI reply failed to send',
  };
}
