/**
 * Load missed calls, decide, and place at most one Twilio callback per call.
 * The dialer is injected. Flag off and numbers outside the test allowlist never reach it.
 */
import { callbackCandidates, requestResolvesCallback, voiceAttempts, indexWorkTimes, type CallbackCandidate } from '../ads/callbacks.ts';
import { isOwnNumber } from '../ads/real-leads.ts';
import { digits10 } from '../ads/call-dashboard.ts';
import {
  callbackConfig,
  callbackPublicBase,
  isEphemeralSkip,
  isUnpaidStatus,
  matchInFlightCallback,
  planMikeCallbacks,
  toStoredAttempt,
  visitCreatedInstants,
  DIAL_OUTCOMES,
  IN_FLIGHT_MS,
  type CallbackAction,
  type CallbackConfig,
  type CallbackContext,
  type PlannedCallback,
  type StoredAttempt,
} from './mike-callback.ts';
import { placeTwilioCallback, twilioConfigured, DialNotAllowedError } from './mike-callback-dial.ts';

export interface ExecuteDeps {
  now: Date;
  env: NodeJS.ProcessEnv;
  save(input: PersistAttempt): Promise<void>;
  claim(input: PersistAttempt): Promise<{ id: string } | null>;
  mark(id: string, patch: { outcome: string; reason?: string | null; twilioCallSid?: string | null }): Promise<void>;
  place(input: { to: string; from: string; voiceUrl: string; statusUrl: string }): Promise<{ sid: string }>;
}

export interface PersistAttempt {
  missedCallKey: string;
  phone: string;
  fromNumber: string | null;
  missedAt: string;
  name: string | null;
  outcome: string;
  reason: string | null;
  scheduledFor: string | null;
  attemptedAt: string | null;
}

export interface ExecuteSummary {
  mode: CallbackConfig['mode'];
  dialed: number;
  queued: number;
  skipped: number;
  held: number;
  errors: string[];
}

function baseUrls(attemptKey: string, env: NodeJS.ProcessEnv): { voice: string; status: string } | null {
  const base = callbackPublicBase(env);
  if (!base) return null;
  const key = encodeURIComponent(attemptKey);
  return {
    voice: `${base}/api/calls/mike-callback/voice?attempt=${key}`,
    status: `${base}/api/calls/mike-callback/status?attempt=${key}`,
  };
}

export async function executeMikeCallbacks(plans: PlannedCallback[], deps: ExecuteDeps): Promise<ExecuteSummary> {
  const config = callbackConfig(deps.env);
  const summary: ExecuteSummary = { mode: config.mode, dialed: 0, queued: 0, skipped: 0, held: 0, errors: [] };
  if (config.mode === 'off') return summary;

  const dials: PlannedCallback[] = [];
  for (const plan of plans) {
    if (config.mode === 'test' && !config.testNumbers.has(digits10(plan.call.phone) || '')) continue;
    const decision = plan.decision;
    if (decision.action === 'skip') {
      if (isEphemeralSkip(decision.reason)) continue;
      summary.skipped += 1;
      await deps.save(persistFrom(plan.call, decision, deps.now));
      continue;
    }
    if (decision.action === 'queue') {
      summary.queued += 1;
      await deps.save(persistFrom(plan.call, decision, deps.now));
      continue;
    }
    dials.push(plan);
  }

  const ready = dials.sort((a, b) => Date.parse(a.call.at) - Date.parse(b.call.at)).slice(0, config.maxPerRun);
  summary.held += dials.length - ready.length;
  if (!ready.length) return summary;
  if (!callbackPublicBase(deps.env)) {
    summary.held += ready.length;
    summary.errors.push('public_url_missing');
    return summary;
  }
  if (!twilioConfigured(deps.env)) {
    summary.held += ready.length;
    summary.errors.push('dialer_not_configured');
    return summary;
  }

  for (const plan of ready) {
    const decision = plan.decision;
    if (decision.action !== 'dial') continue;
    const urls = baseUrls(plan.call.key, deps.env);
    if (!urls) {
      summary.held += 1;
      continue;
    }
    const claimed = await deps.claim({
      ...persistFrom(plan.call, decision, deps.now),
      outcome: 'dialing',
      reason: null,
      scheduledFor: null,
      attemptedAt: deps.now.toISOString(),
    });
    if (!claimed) continue;
    try {
      const placed = await deps.place({ to: decision.to, from: decision.from, voiceUrl: urls.voice, statusUrl: urls.status });
      await deps.mark(claimed.id, { outcome: 'dialing', twilioCallSid: placed.sid });
      summary.dialed += 1;
    } catch (error) {
      if (error instanceof DialNotAllowedError) {
        await deps.mark(claimed.id, { outcome: 'skipped', reason: 'flag_off' });
        summary.errors.push('dial_not_allowed');
        continue;
      }
      const message = error instanceof Error ? error.message : 'twilio_error';
      await deps.mark(claimed.id, { outcome: 'failed', reason: message.slice(0, 180) });
      summary.errors.push(message.slice(0, 180));
    }
  }
  return summary;
}

function persistFrom(call: CallbackCandidate, decision: CallbackAction, now: Date): PersistAttempt {
  const queued = decision.action === 'queue';
  const dial = decision.action === 'dial';
  return {
    missedCallKey: call.key,
    phone: decision.action === 'skip' ? (call.phone || '') : decision.to,
    fromNumber: decision.action === 'skip' ? null : decision.from,
    missedAt: call.at,
    name: call.name,
    outcome: dial ? 'dialing' : queued ? 'queued' : 'skipped',
    reason: decision.action === 'dial' ? null : decision.reason,
    scheduledFor: queued ? decision.notBefore : null,
    attemptedAt: dial ? now.toISOString() : null,
  };
}

export interface CallbackSnapshot {
  calls: CallbackCandidate[];
  ctx: CallbackContext;
  notes: string[];
}

function phonesOf(client: { phones_digits?: string[] | null; phones?: unknown } | null | undefined): string[] {
  if (!client) return [];
  const raw = client.phones_digits ?? client.phones ?? [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => digits10(typeof item === 'string' ? item : (item as { number?: string })?.number)).filter((d): d is string => !!d);
}

/** Read the tables the callback list already uses, plus holds, opt-outs, and unpaid invoices. */
export async function loadCallbackSnapshot(db: any, env: NodeJS.ProcessEnv, now: Date): Promise<CallbackSnapshot> {
  const config = callbackConfig(env);
  const since = new Date(now.getTime() - config.lookbackMs).toISOString();
  const week = new Date(now.getTime() - 8 * 86400_000).toISOString();
  const notes: string[] = [];
  const read = async (label: string, query: PromiseLike<{ data: any[] | null; error: { message: string } | null }>) => {
    try {
      const result = await query;
      if (result.error) {
        notes.push(`${label}: ${result.error.message}`);
        return [] as any[];
      }
      return result.data ?? [];
    } catch (error) {
      notes.push(`${label}: ${error instanceof Error ? error.message : 'error'}`);
      return [] as any[];
    }
  };

  const [log, recordings, attempts, requests, jobsNew, jobsUpdated, quotes, invoicesOpen, invoicesRecent, holds, dnc] = await Promise.all([
    read('call log', db.from('phone_call_log').select('voice_call_key, started_at, direction, caller_phone, called_number, ring_group, outcome, answered_by, duration_seconds, ring_seconds, client_name, receptionist_call_id').gte('started_at', since).limit(5000)),
    read('recordings', db.from('inbound_call_recordings').select('call_sid, started_at, caller_number, tracking_number, source, dial_status, answered, duration_seconds, summary, outcome, caller_name').gte('started_at', since).neq('source', 'test').limit(2000)),
    read('attempts', db.from('mike_callback_attempts').select('id, missed_call_key, caller_phone, from_number, missed_at, attempted_at, outcome, reason, twilio_call_sid, vapi_call_id').gte('missed_at', week).limit(2000)),
    read('requests', db.from('booking_requests').select('phone, created_at, vapi_call_id, source').gte('created_at', since).limit(2000)),
    read('jobs', db.from('jobber_jobs').select('id, client_id, created_at, data').gte('created_at', since).limit(2000)),
    read('jobs-updated', db.from('jobber_jobs').select('id, client_id, created_at, data').gte('jobber_updated_at', since).limit(2000)),
    read('quotes', db.from('jobber_quotes').select('created_at, data').gte('created_at', since).limit(2000)),
    read('invoices', db.from('jobber_invoices').select('id, client_id, invoice_status, issued_date, data').in('invoice_status', ['awaiting_payment', 'past_due', 'bad_debt']).limit(2000)),
    read('invoices-recent', db.from('jobber_invoices').select('id, client_id, invoice_status, issued_date, data').gte('issued_date', since).limit(2000)),
    read('holds', db.from('collection_holds').select('client_id, phone, reason').limit(1000)),
    read('opt-outs', db.from('sms_do_not_text').select('phone_e164').limit(2000)),
  ]);
  const jobs = dedupeRows([...jobsNew, ...jobsUpdated]);
  const invoices = dedupeRows([...invoicesOpen, ...invoicesRecent]);

  const clientIds = Array.from(new Set([
    ...jobs.map((row) => row.client_id),
    ...invoices.map((row) => row.client_id),
    ...holds.map((row) => row.client_id),
    ...quotes.map((row) => row.data?.client?.id),
  ].filter(Boolean)));
  const clients: any[] = [];
  for (let i = 0; i < clientIds.length; i += 150) {
    const chunk = await read('clients', db.from('jobber_clients').select('id, name, phones_digits').in('id', clientIds.slice(i, i + 150)));
    clients.push(...chunk);
  }
  const clientById = new Map(clients.map((client) => [client.id, client]));
  const bookedMike = new Set<string>(requests.filter((row) => row.vapi_call_id && requestResolvesCallback(row.source)).map((row) => row.vapi_call_id));
  const calls = callbackCandidates({
    log: log.filter((row) => row.direction !== 'outbound' && !isOwnNumber(row.caller_phone)),
    recordings: recordings.filter((row) => !isOwnNumber(row.caller_number)),
    mike: [],
    bookedMike,
  });
  const workRows: Array<{ phone: string | null; at: string }> = [];
  for (const row of requests) if (row.created_at && requestResolvesCallback(row.source) && !isOwnNumber(row.phone)) workRows.push({ phone: row.phone, at: row.created_at });
  for (const row of jobs) {
    const phones = phonesOf(clientById.get(row.client_id));
    if (row.created_at) for (const phone of phones) workRows.push({ phone, at: row.created_at });
    for (const at of visitCreatedInstants(row.data)) for (const phone of phones) workRows.push({ phone, at });
  }
  for (const row of quotes) {
    const phones = Array.from(new Set([...phonesOf(row.data?.client), ...phonesOf(clientById.get(row.data?.client?.id))]));
    if (row.created_at) for (const phone of phones) workRows.push({ phone, at: row.created_at });
  }
  for (const row of invoices) {
    if (!row.issued_date) continue;
    for (const phone of phonesOf(clientById.get(row.client_id))) workRows.push({ phone, at: row.issued_date });
  }

  const unpaidPhones = new Set<string>();
  for (const row of invoices) {
    const balance = typeof row.data?.balance === 'number' ? row.data.balance : typeof row.data?.amounts?.balance === 'number' ? row.data.amounts.balance : null;
    if (!isUnpaidStatus(row.invoice_status, balance)) continue;
    for (const phone of phonesOf(clientById.get(row.client_id))) unpaidPhones.add(phone);
  }
  const holdPhones = new Set<string>();
  const holdNotes: Array<{ phone: string | null; text: string }> = [];
  for (const row of holds) {
    const phone = digits10(row.phone);
    if (phone) holdPhones.add(phone);
    const client = row.client_id ? clientById.get(row.client_id) : null;
    const text = [client?.name, row.reason].filter(Boolean).join(' ');
    if (text) holdNotes.push({ phone: phone || null, text });
    for (const clientPhone of phonesOf(client)) {
      holdPhones.add(clientPhone);
      if (text) holdNotes.push({ phone: clientPhone, text });
    }
  }
  const dncPhones = new Set<string>();
  for (const row of dnc) {
    const phone = digits10(row.phone_e164);
    if (phone) dncPhones.add(phone);
  }
  const stored = attempts.map(toStoredAttempt).filter((row): row is StoredAttempt => !!row);
  const ctx: CallbackContext = {
    laterInbound: [
      ...log.filter((row) => row.direction !== 'outbound').map((row) => ({ phone: row.caller_phone, at: row.started_at })),
      ...recordings.map((row) => ({ phone: row.caller_number, at: row.started_at })),
    ],
    voiceAttempts: voiceAttempts(log),
    work: indexWorkTimes(workRows),
    attempts: stored,
    unpaidPhones,
    holdPhones,
    holdNotes,
    dncPhones,
  };
  return { calls, ctx, notes };
}

/** A failed exclusion read must not dial. Missing data is not an empty list. */
export function callbackPassBlocked(notes: string[]): string | null {
  return notes.find((note) => /^(attempts|opt-outs|holds|invoices|invoices-recent|jobs|jobs-updated|quotes|requests|clients|call log|recordings):/.test(note)) ?? null;
}

function dedupeRows(rows: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const row of rows) {
    const id = row && typeof row.id === 'string' ? row.id : '';
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(row);
  }
  return out;
}

export async function runMikeCallbackPass(
  db: any,
  env: NodeJS.ProcessEnv,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<ExecuteSummary & { notes: string[] }> {
  const config = callbackConfig(env);
  if (config.mode === 'off') return { mode: 'off', dialed: 0, queued: 0, skipped: 0, held: 0, errors: [], notes: [] };
  const snapshot = await loadCallbackSnapshot(db, env, now);
  const blocked = callbackPassBlocked(snapshot.notes);
  if (blocked) {
    return { mode: config.mode, dialed: 0, queued: 0, skipped: 0, held: 0, errors: [blocked], notes: snapshot.notes };
  }
  const plans = planMikeCallbacks(snapshot.calls, snapshot.ctx, config, now, env);
  const summary = await executeMikeCallbacks(plans, {
    now,
    env,
    save: (input) => upsertAttempt(db, input, false),
    claim: async (input) => {
      const id = await upsertAttempt(db, input, true);
      return id ? { id } : null;
    },
    mark: async (id, patch) => {
      const row: Record<string, unknown> = { outcome: patch.outcome, updated_at: new Date().toISOString() };
      if (patch.reason !== undefined) row.reason = patch.reason;
      if (patch.twilioCallSid) row.twilio_call_sid = patch.twilioCallSid;
      const { error } = await db.from('mike_callback_attempts').update(row).eq('id', id);
      if (error) throw new Error(error.message);
    },
    place: (input) => placeTwilioCallback(input, env, fetchImpl),
  });
  return { ...summary, notes: snapshot.notes };
}

/**
 * Insert or update the one row per missed call.
 * A claim refuses to overwrite a row that already has a real dial outcome.
 */
export async function upsertAttempt(db: any, input: PersistAttempt, claim: boolean): Promise<string | null> {
  const existing = await db.from('mike_callback_attempts').select('id, outcome').eq('missed_call_key', input.missedCallKey).maybeSingle();
  if (existing?.error && !/maybeSingle|multiple/i.test(existing.error.message)) {
    const fallback = await db.from('mike_callback_attempts').select('id, outcome').eq('missed_call_key', input.missedCallKey).limit(1);
    if (fallback.error) throw new Error(fallback.error.message);
    return writeAttempt(db, fallback.data?.[0], input, claim);
  }
  if (existing?.error) throw new Error(existing.error.message);
  return writeAttempt(db, existing?.data, input, claim);
}

async function writeAttempt(db: any, existing: { id: string; outcome: string } | null | undefined, input: PersistAttempt, claim: boolean): Promise<string | null> {
  if (existing && DIAL_OUTCOMES.has(existing.outcome)) return null;
  const row = {
    missed_call_key: input.missedCallKey,
    caller_phone: input.phone,
    from_number: input.fromNumber,
    customer_name: input.name,
    missed_at: input.missedAt,
    attempted_at: input.attemptedAt,
    scheduled_for: input.scheduledFor,
    outcome: input.outcome,
    reason: input.reason,
    updated_at: new Date().toISOString(),
  };
  if (!existing) {
    const inserted = await db.from('mike_callback_attempts').insert(row).select('id').single();
    if (inserted.error) {
      if (claim && /duplicate|unique/i.test(inserted.error.message)) return null;
      throw new Error(inserted.error.message);
    }
    return inserted.data?.id ?? null;
  }
  if (claim) {
    const updated = await db.from('mike_callback_attempts').update(row).eq('id', existing.id).in('outcome', ['queued', 'skipped']).select('id');
    if (updated.error) throw new Error(updated.error.message);
    return updated.data?.[0]?.id ?? null;
  }
  const updated = await db.from('mike_callback_attempts').update(row).eq('id', existing.id).select('id').single();
  if (updated.error) throw new Error(updated.error.message);
  return updated.data?.id ?? null;
}

export async function loadRecentAttempts(db: any, sinceIso: string): Promise<{ attempts: StoredAttempt[]; note: string | null }> {
  try {
    const result = await db.from('mike_callback_attempts')
      .select('id, missed_call_key, caller_phone, from_number, missed_at, attempted_at, outcome, reason, twilio_call_sid, vapi_call_id')
      .gte('missed_at', sinceIso)
      .limit(2000);
    if (result.error) return { attempts: [], note: `mike callbacks: ${result.error.message}` };
    return { attempts: (result.data ?? []).map(toStoredAttempt).filter((row: StoredAttempt | null): row is StoredAttempt => !!row), note: null };
  } catch (error) {
    return { attempts: [], note: `mike callbacks: ${error instanceof Error ? error.message : 'error'}` };
  }
}

export async function findAttemptBySid(db: any, sid: string): Promise<StoredAttempt | null> {
  if (!sid) return null;
  const result = await db.from('mike_callback_attempts').select('id, missed_call_key, caller_phone, from_number, missed_at, attempted_at, outcome, reason, twilio_call_sid, vapi_call_id').eq('twilio_call_sid', sid).limit(1);
  if (result.error) return null;
  return toStoredAttempt(result.data?.[0] ?? {}) ;
}

export async function findAttemptByKey(db: any, key: string): Promise<StoredAttempt | null> {
  if (!key) return null;
  const result = await db.from('mike_callback_attempts').select('id, missed_call_key, caller_phone, from_number, missed_at, attempted_at, outcome, reason, twilio_call_sid, vapi_call_id').eq('missed_call_key', key).limit(1);
  if (result.error) return null;
  return toStoredAttempt(result.data?.[0] ?? {});
}

export async function listInFlightAttempts(db: any, sinceIso: string): Promise<StoredAttempt[]> {
  const result = await db.from('mike_callback_attempts')
    .select('id, missed_call_key, caller_phone, from_number, missed_at, attempted_at, outcome, reason, twilio_call_sid, vapi_call_id')
    .in('outcome', ['dialing', 'reached'])
    .gte('attempted_at', sinceIso)
    .limit(50);
  if (result.error) return [];
  return (result.data ?? []).map(toStoredAttempt).filter((row: StoredAttempt | null): row is StoredAttempt => !!row);
}

export async function updateAttemptOutcome(
  db: any,
  id: string,
  outcome: string,
  reason: string | null,
  onlyFrom: string[],
): Promise<void> {
  const patch: Record<string, unknown> = { outcome, updated_at: new Date().toISOString() };
  if (reason !== undefined) patch.reason = reason;
  await db.from('mike_callback_attempts').update(patch).eq('id', id).in('outcome', onlyFrom);
}

export async function linkAttemptVapi(db: any, id: string, vapiCallId: string): Promise<void> {
  if (!id || !vapiCallId) return;
  await db.from('mike_callback_attempts').update({ vapi_call_id: vapiCallId, updated_at: new Date().toISOString() }).eq('id', id);
}

/** When Mike is bridged, Vapi sees our tracking number. Swap in the customer we actually dialed. */
export async function overrideCallbackCaller(
  db: any,
  presented: string,
  vapiCallId: string,
  now = new Date(),
): Promise<{ id: string; phone: string } | null> {
  const since = new Date(now.getTime() - IN_FLIGHT_MS).toISOString();
  const attempts = await listInFlightAttempts(db, since);
  const match = matchInFlightCallback(presented, attempts, now);
  if (!match?.id || !match.phone) return null;
  if (vapiCallId) await linkAttemptVapi(db, match.id, vapiCallId);
  return { id: match.id, phone: match.phone };
}
