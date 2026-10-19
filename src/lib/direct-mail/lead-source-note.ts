/**
 * Going-forward Jobber lead source for DM1. Jobber's public API has no client lead-source field
 * (ClientEditInput: no leadSource; schema 2025-04-16), so a client note is written instead:
 *   "Lead source: Direct mail - DM1 (...)"
 * Attribution: caller to (760) 823-8910 (inbound_call_recordings.source=direct_mail), or a website
 * form with lead_source=direct_mail, or a booking whose notes carry code DM1, AND that client has a
 * Jobber job created from 1 h before to 90 days after first contact. Contacts before DM1_NOTE_FROM
 * (default 2026-10-20 00:00 UTC, when this shipped) are ignored: no backfill. One note per client,
 * tracked in jobber_sync_state key "dm1-lead-source". Notes do not email or text anyone.
 */
import { createNote } from '../jobber/mcp-notes.ts';

export const DM1_NOTE = 'Lead source: Direct mail - DM1';
const DAY = 86400_000;
const d10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length === 10 ? d : null; };

export interface Contact { at: string; phone: string | null; via: 'call' | 'form' | 'code' }
export interface ClientRow { id: string; phones: string[] }
export interface JobRow { client_id: string; created_at: string }

/** Pure: which clients should get the note now. */
export function clientsToTag(input: { contacts: Contact[]; clients: ClientRow[]; jobs: JobRow[]; done: Set<string>; fromMs: number }) {
  const first = new Map<string, { t: number; via: Contact['via'] }>();
  for (const c of input.contacts) {
    const p = d10(c.phone); const t = Date.parse(c.at);
    if (!p || !Number.isFinite(t) || t < input.fromMs) continue;
    const cur = first.get(p); if (!cur || t < cur.t) first.set(p, { t, via: c.via });
  }
  const out: Array<{ clientId: string; via: Contact['via']; firstContact: string }> = [];
  for (const cl of input.clients) {
    if (input.done.has(cl.id)) continue;
    const hits = cl.phones.map((p) => first.get(p)).filter(Boolean) as Array<{ t: number; via: Contact['via'] }>;
    if (!hits.length) continue;
    const f = hits.sort((a, b) => a.t - b.t)[0];
    const booked = input.jobs.some((j) => j.client_id === cl.id && Date.parse(j.created_at) >= f.t - 3600_000 && Date.parse(j.created_at) <= f.t + 90 * DAY);
    if (booked) out.push({ clientId: cl.id, via: f.via, firstContact: new Date(f.t).toISOString() });
  }
  return out;
}

const VIA: Record<Contact['via'], string> = { call: 'called (760) 823-8910', form: 'postcard page form', code: 'mentioned code DM1' };

export async function runDm1LeadSource(db: any, env: NodeJS.ProcessEnv = process.env, dryRun = false) {
  const fromMs = Date.parse(env.DM1_NOTE_FROM || '2026-10-20T00:00:00Z');
  const fromIso = new Date(fromMs).toISOString();
  const [recs, forms, coded, state] = await Promise.all([
    db.from('inbound_call_recordings').select('started_at, caller_number').eq('source', 'direct_mail').gte('started_at', fromIso).limit(5000),
    db.from('booking_requests').select('created_at, phone').eq('lead_source', 'direct_mail').gte('created_at', fromIso).limit(5000),
    db.from('booking_requests').select('created_at, phone, lead_source').ilike('notes', '%DM1%').gte('created_at', fromIso).limit(5000),
    db.from('jobber_sync_state').select('meta').eq('key', 'dm1-lead-source').maybeSingle(),
  ]);
  for (const r of [recs, forms, coded]) if (r.error) throw new Error(r.error.message);
  const contacts: Contact[] = [
    ...(recs.data ?? []).map((r: any) => ({ at: r.started_at, phone: r.caller_number, via: 'call' as const })),
    ...(forms.data ?? []).map((r: any) => ({ at: r.created_at, phone: r.phone, via: 'form' as const })),
    ...(coded.data ?? []).filter((r: any) => r.lead_source !== 'test' && r.lead_source !== 'direct_mail').map((r: any) => ({ at: r.created_at, phone: r.phone, via: 'code' as const })),
  ];
  const phones = Array.from(new Set(contacts.map((c) => d10(c.phone)).filter(Boolean))) as string[];
  const done = new Set<string>((state.data?.meta?.done as string[]) ?? []);
  if (!phones.length) return { contacts: 0, tagged: [], dryRun };
  const clients: ClientRow[] = []; const jobs: JobRow[] = [];
  for (let i = 0; i < phones.length; i += 100) {
    const c = await db.from('jobber_clients').select('id, phones_digits').overlaps('phones_digits', phones.slice(i, i + 100));
    if (c.error) throw new Error(c.error.message);
    for (const r of c.data ?? []) clients.push({ id: r.id, phones: r.phones_digits ?? [] });
  }
  const ids = clients.map((c) => c.id);
  for (let i = 0; i < ids.length; i += 100) {
    const j = await db.from('jobber_jobs').select('client_id, created_at').in('client_id', ids.slice(i, i + 100));
    if (j.error) throw new Error(j.error.message);
    jobs.push(...(j.data ?? []));
  }
  const todo = clientsToTag({ contacts, clients, jobs, done, fromMs });
  const tagged: string[] = []; const errors: string[] = [];
  for (const t of todo.slice(0, 10)) {
    if (dryRun) { tagged.push(t.clientId); continue; }
    try {
      await createNote({ target: 'client', id: t.clientId, message: `${DM1_NOTE} (${VIA[t.via]}, first contact ${t.firstContact.slice(0, 10)}). Added automatically.` });
      tagged.push(t.clientId); done.add(t.clientId);
    } catch (e) { errors.push(`${t.clientId}: ${e instanceof Error ? e.message : e}`); }
  }
  if (!dryRun && tagged.length) {
    const up = await db.from('jobber_sync_state').upsert({ key: 'dm1-lead-source', meta: { done: Array.from(done) }, updated_at: new Date().toISOString() });
    if (up.error) errors.push(`state: ${up.error.message}`);
  }
  return { contacts: contacts.length, candidates: todo.length, tagged, errors, dryRun };
}
