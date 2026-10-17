/** Unified, legible call feed for the ops dashboard (main "Recent calls" table + TV Activity). Pure. */
import { digits10 } from './call-dashboard.ts';

export type FeedOutcome = 'Booked' | 'Answered' | 'Missed' | 'Voicemail' | 'Mike (AI)';
export interface FeedRow {
  at: string; name: string | null; phone: string; line: string; outcome: FeedOutcome;
  answeredBy: string | null; durationSeconds: number | null; summary: string | null;
  /** Missed, voicemail, and Mike rows: "Called back …" or "No callback yet". */
  callback?: string | null;
  /** Shop Voice outbound attempts in the selected period, plus who placed the last one. */
  outreach?: string | null;
  goingCold?: boolean;
  /** Automated Mike callback for this call, e.g. "Mike tried 4:21 PM, voicemail". */
  mike?: string | null;
}

export function formatPhone(p: string | null | undefined): string {
  const d = digits10(p);
  return d ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || 'Unknown');
}
export function formatDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return m ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
}

// New Google Voice forward targets (after port) show under the line they serve.
const envLines = (k: string, label: string) => Object.fromEntries((process.env[k] ?? '').split(',').map((x) => x.replace(/\D/g, '').slice(-10)).filter((x) => x.length === 10).map((x) => [x, label]));
const LINE_BY_NUMBER: Record<string, string> = {
  ...envLines('PHONE_CALL_FORWARD_MAIN', 'Main'), ...envLines('PHONE_CALL_FORWARD_RANSOM', 'Ransom'),
  '7604408520': 'Main', '7607895955': 'Ransom', '9516510957': 'GBP Anza', '7602791262': 'GBP Ramona',
  '7603312502': 'Ads', '7604630493': 'Website', '7604937719': 'Direct', '7608914264': 'Yelp', '7604540365': 'Apple Maps', '8773863995': 'Toll-free', '7608237963': 'Line 823-7963',
};
const LINE_BY_SOURCE: Record<string, string> = { gbp_anza: 'GBP Anza', gbp_ramona: 'GBP Ramona', gmb: 'GBP', google_ads: 'Ads', ads: 'Ads', seo: 'Website', yelp: 'Yelp', apple_maps: 'Apple Maps', direct: 'Direct', main_line: 'Main', ransom_line: 'Ransom' };
const firstLine = (s: string | null | undefined) => { const l = (s ?? '').split('\n')[0].trim(); return l ? (l.length > 180 ? `${l.slice(0, 177)}…` : l) : null; };

export function buildCallFeed(input: Parameters<typeof mergeCallFeed>[0] & { limit?: number }): FeedRow[] {
  return mergeCallFeed(input).slice(0, input.limit ?? 40);
}

/** Today's totals over EVERY line (Main, Ransom, GBP Anza/Ramona, Direct, ads tracking, Mike), one row per call. */
export function feedToday(rows: FeedRow[], todayStartMs: number) {
  const t = rows.filter((r) => Date.parse(r.at) >= todayStartMs);
  const mike = t.filter((r) => r.line.startsWith('Mike') || r.outcome === 'Mike (AI)').length;
  const missed = t.filter((r) => r.outcome === 'Missed' || r.outcome === 'Voicemail').length;
  return { total: t.length, answered: t.length - mike - missed, missed, forwardedAi: mike };
}

/** Mike legs start within this window of the office leg they followed (Twilio no-answer handoff or Voice roll-over). */
const MIKE_BEFORE_MS = 60_000;
const MIKE_AFTER_MS = 6 * 60_000;
/** Two Voice log rows for one caller this close together with the same outcome are the same call logged twice. */
const LOG_DUP_MS = 10_000;

/**
 * All calls merged, newest first (no limit). Only true duplicates are removed:
 * - a Voice log row for the same call already shown from a tracking-line recording, and
 * - the same call logged twice by Voice seconds apart.
 * Separate calls from a repeat caller each keep their own row (and their own Mike summary).
 * A call the office did not pick up that Mike then answered shows as Mike, with his summary.
 */
export function mergeCallFeed(input: {
  log: Array<Record<string, any>>; recordings: Array<Record<string, any>>; mike: Array<Record<string, any>>;
  bookedMike?: Set<string>;
}): FeedRow[] {
  const mikeById = new Map(input.mike.map((m) => [m.vapi_call_id ?? m.id, m]));
  const mikeCalls = input.mike
    .map((m) => ({ m, id: String(m.vapi_call_id ?? m.id ?? ''), d: digits10(m.phone), t: Date.parse(m.called_at) }))
    .filter((x) => Number.isFinite(x.t));
  const used = new Set<string>();
  // Explicit Voice-log links win over time matching.
  for (const r of input.log) if (r.receptionist_call_id && mikeById.has(r.receptionist_call_id)) used.add(String(r.receptionist_call_id));
  const takeMike = (d: string | null, t: number, before = MIKE_BEFORE_MS, after = MIKE_AFTER_MS) => {
    if (!d) return null;
    let best: (typeof mikeCalls)[number] | null = null;
    for (const x of mikeCalls) {
      if (x.d !== d || used.has(x.id) || x.t < t - before || x.t > t + after) continue;
      if (!best || Math.abs(x.t - t) < Math.abs(best.t - t)) best = x;
    }
    if (best) used.add(best.id);
    return best?.m ?? null;
  };
  const isBooked = (id: unknown) => !!(id && input.bookedMike?.has(String(id)));

  type Row = FeedRow & { _d: string | null; _t: number; _src: 'rec' | 'log' | 'mike'; _o?: string };
  const rows: Row[] = [];
  for (const r of input.recordings) {
    const t = Date.parse(r.started_at); if (!Number.isFinite(t)) continue;
    const d = digits10(r.caller_number);
    const answered = r.answered !== false && r.dial_status !== 'no-answer' && r.dial_status !== 'busy';
    const lineName = LINE_BY_SOURCE[r.source] ?? LINE_BY_NUMBER[digits10(r.tracking_number) ?? ''] ?? 'Tracking line';
    // Not picked up -> Twilio hands the caller to Mike. Answered -> only a Mike leg right at the start (Voice roll-over).
    const m = r.outcome === 'booked' ? null : answered ? takeMike(d, t, 30_000, 2 * 60_000) : takeMike(d, t);
    if (m) {
      rows.push({ at: r.started_at, name: r.caller_name ?? m.customer_name ?? null, phone: formatPhone(r.caller_number), line: `Mike · ${lineName}`,
        outcome: isBooked(m.vapi_call_id) ? 'Booked' : 'Mike (AI)', answeredBy: null, durationSeconds: m.duration_sec ?? r.duration_seconds ?? null,
        summary: firstLine(r.summary) ?? firstLine(m.summary), _d: d, _t: t, _src: 'rec' });
      continue;
    }
    const o = r.outcome === 'booked' ? 'Booked' : !answered ? 'Missed' : r.outcome === 'voicemail_or_no_answer' && (r.duration_seconds ?? 0) < 20 ? 'Voicemail' : 'Answered';
    rows.push({ at: r.started_at, name: r.caller_name ?? null, phone: formatPhone(r.caller_number), line: lineName,
      outcome: o, answeredBy: null, durationSeconds: r.duration_seconds ?? null, summary: firstLine(r.summary), _d: d, _t: t, _src: 'rec' });
  }
  const logSorted = [...input.log].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  for (const r of logSorted) {
    const t = Date.parse(r.started_at); if (!Number.isFinite(t)) continue;
    const d = digits10(r.caller_phone);
    // Same call already shown from the tracking-line recording (Twilio forwards into the Voice ring group).
    if (d && rows.some((x) => x._src === 'rec' && x._d === d && Math.abs(x._t - t) < 3 * 60_000)) continue;
    // Same call logged twice by Voice (seconds apart, same outcome).
    if (d && rows.some((x) => x._src === 'log' && x._d === d && x._o === r.outcome && Math.abs(x._t - t) < LOG_DUP_MS)) continue;
    let m = r.receptionist_call_id ? mikeById.get(r.receptionist_call_id) ?? null : null;
    // Unanswered or AI-forwarded with no Vapi link: the Mike leg that followed belongs to this call.
    if (!m && (r.outcome === 'missed' || r.outcome === 'forwarded_ai')) m = takeMike(d, t);
    const vapiId = r.receptionist_call_id ?? m?.vapi_call_id ?? null;
    const mikeHandled = !!m || r.outcome === 'forwarded_ai';
    const o: FeedOutcome = isBooked(vapiId) ? 'Booked' : mikeHandled && r.outcome !== 'answered' ? 'Mike (AI)'
      : r.outcome === 'missed' ? 'Missed' : r.outcome === 'voicemail' ? 'Voicemail' : 'Answered';
    const lineName = r.campaign_name ? 'Ads' : LINE_BY_NUMBER[digits10(r.called_number) ?? ''] ?? 'Main';
    const line = o === 'Mike (AI)' || (o === 'Booked' && mikeHandled) ? `Mike · ${LINE_BY_NUMBER[digits10(r.called_number) ?? ''] ?? 'Main'}` : lineName;
    const dur = o === 'Mike (AI)' && !r.duration_seconds && m?.duration_sec ? m.duration_sec : r.duration_seconds ?? null;
    rows.push({ at: r.started_at, name: r.client_name ?? m?.customer_name ?? null, phone: formatPhone(r.caller_phone), line, outcome: o,
      answeredBy: r.answered_by ? String(r.answered_by).split('@')[0] : null, durationSeconds: dur,
      summary: firstLine(m?.summary), _d: d, _t: t, _src: 'log', _o: r.outcome });
  }
  // Mike calls not tied to any row above (e.g. dialed straight to the AI line) keep their own row.
  for (const x of mikeCalls) {
    if (used.has(x.id)) continue;
    const m = x.m;
    rows.push({ at: m.called_at, name: m.customer_name ?? null, phone: formatPhone(m.phone), line: 'Mike',
      outcome: isBooked(m.vapi_call_id) ? 'Booked' : 'Mike (AI)', answeredBy: null, durationSeconds: m.duration_sec ?? null, summary: firstLine(m.summary), _d: x.d, _t: x.t, _src: 'mike' });
  }
  return rows.sort((a, b) => b._t - a._t).map(({ _d, _t, _src, _o, ...r }) => r);
}

/**
 * Voice log rows the office missed that Mike then picked up (Twilio no-answer handoff) are re-labelled
 * forwarded_ai with Mike's call id, for display only. Rows already linked to a Mike call are left alone.
 */
export function markMikeHandoffs<T extends Record<string, any>>(log: T[], mike: Array<Record<string, any>>): T[] {
  const linked = new Set(log.map((r) => r.receptionist_call_id).filter(Boolean).map(String));
  const free = mike.filter((m) => m.vapi_call_id && !linked.has(String(m.vapi_call_id)))
    .map((m) => ({ id: String(m.vapi_call_id), d: digits10(m.phone), t: Date.parse(m.called_at) }))
    .filter((x) => x.d && Number.isFinite(x.t));
  const used = new Set<string>();
  return [...log].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at)).map((r) => {
    if (r.outcome !== 'missed' || r.receptionist_call_id) return r;
    const d = digits10(r.caller_phone); const t = Date.parse(r.started_at);
    if (!d || !Number.isFinite(t)) return r;
    const hit = free.find((x) => !used.has(x.id) && x.d === d && x.t >= t - MIKE_BEFORE_MS && x.t <= t + MIKE_AFTER_MS);
    if (!hit) return r;
    used.add(hit.id);
    return { ...r, outcome: 'forwarded_ai', receptionist_call_id: hit.id };
  });
}
