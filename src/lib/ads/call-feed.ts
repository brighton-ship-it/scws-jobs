/** Unified, legible call feed for the ops dashboard (main "Recent calls" table + TV Activity). Pure. */
import { digits10 } from './call-dashboard.ts';

export type FeedOutcome = 'Booked' | 'Answered' | 'Missed' | 'Voicemail' | 'Mike (AI)';
export interface FeedRow {
  at: string; name: string | null; phone: string; line: string; outcome: FeedOutcome;
  answeredBy: string | null; durationSeconds: number | null; summary: string | null;
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
  '7603312502': 'Ads', '7604630493': 'Website', '7604937719': 'Direct',
};
const LINE_BY_SOURCE: Record<string, string> = { gbp_anza: 'GBP Anza', gbp_ramona: 'GBP Ramona', gmb: 'GBP', google_ads: 'Ads', ads: 'Ads', seo: 'Website', direct: 'Direct', main_line: 'Main', ransom_line: 'Ransom' };
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

/** All calls merged and de-duplicated (no limit), newest first. */
export function mergeCallFeed(input: {
  log: Array<Record<string, any>>; recordings: Array<Record<string, any>>; mike: Array<Record<string, any>>;
  bookedMike?: Set<string>;
}): FeedRow[] {
  const mikeById = new Map(input.mike.map((m) => [m.vapi_call_id ?? m.id, m]));
  const rows: Array<FeedRow & { _d: string | null; _t: number }> = [];
  for (const r of input.recordings) {
    const t = Date.parse(r.started_at); if (!Number.isFinite(t)) continue;
    const answered = r.answered !== false && r.dial_status !== 'no-answer' && r.dial_status !== 'busy';
    const o = r.outcome === 'booked' ? 'Booked' : !answered ? 'Missed' : r.outcome === 'voicemail_or_no_answer' && (r.duration_seconds ?? 0) < 20 ? 'Voicemail' : 'Answered';
    rows.push({ at: r.started_at, name: r.caller_name ?? null, phone: formatPhone(r.caller_number), line: LINE_BY_SOURCE[r.source] ?? LINE_BY_NUMBER[digits10(r.tracking_number) ?? ''] ?? 'Tracking line',
      outcome: o, answeredBy: null, durationSeconds: r.duration_seconds ?? null, summary: firstLine(r.summary), _d: digits10(r.caller_number), _t: t });
  }
  for (const r of input.log) {
    const t = Date.parse(r.started_at); if (!Number.isFinite(t)) continue;
    const d = digits10(r.caller_phone);
    if (rows.some((x) => x._d && x._d === d && Math.abs(x._t - t) < 3 * 60_000)) continue; // same call already shown from the recording
    const m = r.receptionist_call_id ? mikeById.get(r.receptionist_call_id) : null;
    const booked = !!(r.receptionist_call_id && input.bookedMike?.has(r.receptionist_call_id));
    const o: FeedOutcome = booked ? 'Booked' : r.outcome === 'missed' ? 'Missed' : r.outcome === 'voicemail' ? 'Voicemail' : r.outcome === 'forwarded_ai' ? 'Mike (AI)' : 'Answered';
    const line = r.receptionist_call_id && r.outcome === 'forwarded_ai' ? `Mike · ${LINE_BY_NUMBER[digits10(r.called_number) ?? ''] ?? 'Main'}`
      : r.campaign_name ? 'Ads' : LINE_BY_NUMBER[digits10(r.called_number) ?? ''] ?? 'Main';
    rows.push({ at: r.started_at, name: r.client_name ?? m?.customer_name ?? null, phone: formatPhone(r.caller_phone), line, outcome: o,
      answeredBy: r.answered_by ? String(r.answered_by).split('@')[0] : null, durationSeconds: r.duration_seconds ?? null,
      summary: firstLine(m?.summary), _d: d, _t: t });
  }
  // Mike calls that never reached the Voice log (e.g. direct to the AI line)
  for (const m of input.mike) {
    const t = Date.parse(m.called_at); const d = digits10(m.phone);
    if (!Number.isFinite(t) || rows.some((x) => x._d && x._d === d && Math.abs(x._t - t) < 5 * 60_000)) continue;
    rows.push({ at: m.called_at, name: m.customer_name ?? null, phone: formatPhone(m.phone), line: 'Mike',
      outcome: input.bookedMike?.has(m.vapi_call_id) ? 'Booked' : 'Mike (AI)', answeredBy: null, durationSeconds: m.duration_sec ?? null, summary: firstLine(m.summary), _d: d, _t: t });
  }
  return rows.sort((a, b) => b._t - a._t).map(({ _d, _t, ...r }) => r);
}
