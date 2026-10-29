/**
 * Office view of missed-call auto-texts: one card per text, replies, and whether
 * the text thread booked a Jobber job. No network and no env.
 */
import { digits10 } from './call-dashboard.ts';
import { lineLabel } from '../phone-calls/missed-alert.ts';
import { jobberJobUrl } from '../receptionist/call-email.ts';

const PT = 'America/Los_Angeles';
const SHOW_OUTCOMES = new Set(['sent', 'failed', 'sending']);
const JOB_SKEW_MS = 2 * 60_000;
const JOB_WINDOW_MS = 7 * 86400_000;
export const MISSED_TEXT_LIST_CAP = 80;

export interface TextLogRow {
  id: string;
  caller_phone: string | null;
  called_number: string | null;
  customer_name: string | null;
  missed_at: string | null;
  sent_at: string | null;
  outcome: string | null;
  body: string | null;
  thread_status: string | null;
  thread: unknown;
  twilio_message_sid?: string | null;
  delivery_status?: string | null;
  delivery_error?: string | null;
}

export interface InboundSms {
  phone: string | null;
  at: string;
  body: string;
  sid?: string | null;
}

export interface TextJobMatch {
  phone: string | null;
  id: string;
  jobNumber: number | string | null;
  createdAt: string | null;
}

export interface MissedCallTextReply {
  at: string;
  timeLabel: string;
  body: string;
}

export interface MissedCallTextRow {
  id: string;
  at: string;
  timeLabel: string;
  line: string;
  phone: string;
  phoneDisplay: string;
  name: string | null;
  body: string;
  delivery: string;
  deliveryTone: 'ok' | 'wait' | 'bad';
  replies: MissedCallTextReply[];
  booked: boolean;
  jobUrl: string | null;
  jobLabel: string | null;
}

export interface MissedCallTextView {
  sent: number;
  replied: number;
  /** Share of sent texts that got at least one inbound reply. Null when none were sent. */
  replyRate: number | null;
  booked: number;
  failed: number;
  rows: MissedCallTextRow[];
  hidden: number;
}

export function ptStamp(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '—';
  const text = new Date(t).toLocaleString('en-US', {
    timeZone: PT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  return `${text} PT`;
}

export function phoneDisplay(phone: string | null | undefined): string {
  const d = digits10(phone);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (phone?.trim() || 'Unknown number');
}

function calledE164(raw: string | null | undefined): string | null {
  const d = digits10(raw);
  if (d) return `+1${d}`;
  const t = (raw || '').trim();
  return t || null;
}

export function deliveryLabel(outcome: string | null | undefined, status: string | null | undefined, error: string | null | undefined): { label: string; tone: 'ok' | 'wait' | 'bad' } {
  const s = (status || '').trim().toLowerCase();
  const code = (error || '').trim();
  const withCode = (label: string) => (code ? `${label} · ${code}` : label);
  if (s === 'delivered' || s === 'read') return { label: withCode('Delivered'), tone: 'ok' };
  if (s === 'undelivered') return { label: withCode('Undelivered'), tone: 'bad' };
  if (s === 'failed') return { label: withCode('Failed'), tone: 'bad' };
  if (outcome === 'failed') return { label: withCode('Not sent'), tone: 'bad' };
  if (s === 'sent') return { label: 'Sent', tone: 'wait' };
  if (s === 'queued' || s === 'accepted' || s === 'sending' || outcome === 'sending') return { label: 'Queued', tone: 'wait' };
  if (outcome === 'sent') return { label: 'Sent', tone: 'wait' };
  if (s) return { label: s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), tone: 'wait' };
  return { label: 'Unknown', tone: 'wait' };
}

function threadMessages(thread: unknown): Array<{ role?: string; content?: string; at?: string; sid?: string; name?: string }> {
  if (!Array.isArray(thread)) return [];
  return thread.filter((m) => m && typeof m === 'object') as Array<{ role?: string; content?: string; at?: string; sid?: string; name?: string }>;
}

function parseBooked(thread: unknown, status: string | null): { booked: boolean; jobId: string | null; jobNumber: string | null } {
  let booked = status === 'booked';
  let jobId: string | null = null;
  let jobNumber: string | null = null;
  for (const m of threadMessages(thread)) {
    if (m.role !== 'tool' || m.name !== 'book_job' || !m.content) continue;
    try {
      const r = JSON.parse(m.content);
      if (r?.booked === true) booked = true;
      const id = r?.visit?.jobId || r?.jobId || r?.job?.id || null;
      const num = r?.visit?.jobNumber ?? r?.jobNumber ?? r?.job?.jobNumber ?? null;
      if (id) jobId = String(id);
      if (num != null && String(num).trim()) jobNumber = String(num).trim();
    } catch { /* tool payload is not JSON */ }
  }
  return { booked, jobId, jobNumber };
}

function jobLink(jobId: string | null, jobNumber: string | null): { url: string | null; label: string | null } {
  const url = jobId ? jobberJobUrl(jobId) : '';
  if (url) return { url, label: jobNumber ? `Job #${jobNumber}` : 'Jobber job' };
  if (jobNumber && /^\d+$/.test(jobNumber)) return { url: `https://secure.getjobber.com/jobs/${jobNumber}`, label: `Job #${jobNumber}` };
  return { url: null, label: jobNumber ? `Job #${jobNumber}` : null };
}

function whenMs(row: TextLogRow): number {
  const t = Date.parse(row.sent_at || row.missed_at || '');
  return Number.isFinite(t) ? t : 0;
}

function outboundBody(row: TextLogRow): string {
  const direct = (row.body || '').trim();
  if (direct) return direct;
  const first = threadMessages(row.thread).find((m) => m.role === 'assistant' && (m.content || '').trim());
  return first?.content?.trim() || '(text not stored)';
}

interface ReplyDraft { at: string; body: string; sid: string | null }

function pushReply(list: ReplyDraft[], body: string, at: string, sid: string | null) {
  const text = body.trim();
  if (!text || !Number.isFinite(Date.parse(at))) return;
  if (sid && list.some((r) => r.sid === sid)) return;
  const t = Date.parse(at);
  if (list.some((r) => r.body === text && Math.abs(Date.parse(r.at) - t) < 3 * 60_000)) return;
  list.push({ at, body: text, sid });
}

export function buildMissedCallTextView(input: {
  rows: TextLogRow[];
  sinceMs: number;
  extraReplies?: InboundSms[];
  jobs?: TextJobMatch[];
  delivery?: Record<string, { status: string | null; error?: string | null }>;
}): MissedCallTextView {
  const inRange = input.rows.filter((row) => SHOW_OUTCOMES.has(row.outcome || '') && whenMs(row) >= input.sinceMs);
  const repliesById = new Map<string, ReplyDraft[]>();
  for (const row of inRange) {
    const list: ReplyDraft[] = [];
    for (const m of threadMessages(row.thread)) {
      if (m.role !== 'user') continue;
      pushReply(list, m.content || '', m.at || '', m.sid || null);
    }
    repliesById.set(row.id, list);
  }
  for (const extra of input.extraReplies ?? []) {
    const phone = digits10(extra.phone);
    const t = Date.parse(extra.at);
    if (!phone || !Number.isFinite(t)) continue;
    const candidates = inRange.filter((row) => row.outcome === 'sent' && digits10(row.caller_phone) === phone && whenMs(row) <= t + 60_000);
    const row = candidates.sort((a, b) => whenMs(b) - whenMs(a))[0];
    if (!row) continue;
    pushReply(repliesById.get(row.id) ?? [], extra.body, extra.at, extra.sid ?? null);
  }

  const jobsByPhone = new Map<string, TextJobMatch[]>();
  for (const job of input.jobs ?? []) {
    const phone = digits10(job.phone);
    if (!phone) continue;
    const list = jobsByPhone.get(phone) ?? [];
    list.push(job);
    jobsByPhone.set(phone, list);
  }

  const built: MissedCallTextRow[] = inRange.map((row) => {
    const at = row.sent_at || row.missed_at || '';
    const override = input.delivery?.[row.id];
    const delivery = deliveryLabel(row.outcome, override?.status ?? row.delivery_status ?? null, override?.error ?? row.delivery_error ?? null);
    const book = parseBooked(row.thread, row.thread_status);
    let link = jobLink(book.jobId, book.jobNumber);
    if (book.booked && !link.url) {
      const start = whenMs(row);
      const match = (jobsByPhone.get(digits10(row.caller_phone) || '') ?? [])
        .filter((job) => {
          const t = Date.parse(job.createdAt || '');
          return Number.isFinite(t) && t >= start - JOB_SKEW_MS && t <= start + JOB_WINDOW_MS;
        })
        .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''))[0];
      if (match) link = jobLink(match.id, match.jobNumber != null ? String(match.jobNumber) : null);
    }
    const replies = (repliesById.get(row.id) ?? []).slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const phone = digits10(row.caller_phone) || (row.caller_phone || '');
    return {
      id: row.id,
      at,
      timeLabel: ptStamp(at),
      line: lineLabel(calledE164(row.called_number), null),
      phone,
      phoneDisplay: phoneDisplay(row.caller_phone),
      name: (row.customer_name || '').trim() || null,
      body: outboundBody(row),
      delivery: delivery.label,
      deliveryTone: delivery.tone,
      replies: replies.map((r) => ({ at: r.at, timeLabel: ptStamp(r.at), body: r.body })),
      booked: book.booked,
      jobUrl: book.booked ? link.url : null,
      jobLabel: book.booked && link.url ? (link.label || 'Jobber job') : null,
    };
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));

  const outcomeById = new Map(inRange.map((row) => [row.id, row.outcome]));
  const sentRows = built.filter((row) => outcomeById.get(row.id) === 'sent');
  const sent = sentRows.length;
  const replied = sentRows.filter((row) => row.replies.length > 0).length;
  return {
    sent,
    replied,
    replyRate: sent ? replied / sent : null,
    booked: sentRows.filter((row) => row.booked).length,
    failed: inRange.filter((row) => row.outcome === 'failed').length,
    rows: built.slice(0, MISSED_TEXT_LIST_CAP),
    hidden: Math.max(0, built.length - MISSED_TEXT_LIST_CAP),
  };
}
