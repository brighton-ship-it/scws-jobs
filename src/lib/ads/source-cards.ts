/**
 * Non-ad lead sources for the ops dashboard: Google Business Profile, Website (SEO), Yelp, Apple Maps.
 * Kept apart from Google Ads. Pure (no I/O) so it is tested directly.
 *
 * Calls  = calls to that source's Twilio tracking number (inbound_call_recordings.source), test calls and SCWS's own numbers excluded.
 * Forms  = website form requests (booking_requests, source=website) whose lead channel is that source (booking_requests.lead_source,
 *          set by /api/booking from the visitor's first-touch referrer / UTM). Type: service "new_well" = drilling, everything else = pump.
 * Booked = distinct callers / form phones with a Jobber job created from 1 h before to 30 days after their first contact in the range
 *          (site walks excluded). Type follows that job's title (work-category rule; service calls count as pump).
 */
import { workCategory, isSiteVisit } from './work-category.ts';

export type SourceKey = 'gbp' | 'seo' | 'yelp' | 'apple_maps';
export const SOURCE_KEYS: SourceKey[] = ['gbp', 'seo', 'yelp', 'apple_maps'];
export const SOURCE_LABEL: Record<SourceKey, string> = { gbp: 'Google Business Profile', seo: 'Website (SEO)', yelp: 'Yelp', apple_maps: 'Apple Maps' };
/** Call-recording sources that roll into each card. */
export const CALL_SOURCES: Record<SourceKey, string[]> = { gbp: ['gbp_anza', 'gbp_ramona', 'gmb', 'gbp'], seo: ['seo'], yelp: ['yelp'], apple_maps: ['apple_maps'] };

export interface SrcCall { at: string; phone: string | null; source: string | null }
export interface SrcForm { at: string; phone: string | null; channel: string | null; serviceType: string | null }
export interface SrcJob { createdAt: string; phones: string[]; title: string | null }
export interface SplitCount { total: number; pump: number; drilling: number }
export interface SourceCard {
  key: SourceKey; label: string; calls: number; callers: number; forms: SplitCount; booked: SplitCount; numbers: string[]; note: string | null;
}

const d10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length === 10 ? d : null; };
const formCat = (t: string | null) => (/new[_\s-]?well|drill/i.test(t ?? '') ? 'drilling' : 'pump') as 'pump' | 'drilling';
const BOOK_BEFORE_MS = 3600_000, BOOK_AFTER_MS = 30 * 86400_000;

export function buildSourceCards(input: {
  calls: SrcCall[]; forms: SrcForm[]; jobs: SrcJob[]; startMs: number; nowMs: number;
  numbers?: Partial<Record<SourceKey, string[]>>; notes?: Partial<Record<SourceKey, string>>;
}): SourceCard[] {
  const jobsByPhone = new Map<string, Array<{ t: number; title: string | null }>>();
  for (const j of input.jobs) {
    const t = Date.parse(j.createdAt); if (!Number.isFinite(t) || isSiteVisit(j.title)) continue;
    for (const p of Array.from(new Set(j.phones.map(d10).filter(Boolean) as string[]))) (jobsByPhone.get(p) ?? jobsByPhone.set(p, []).get(p)!).push({ t, title: j.title });
  }
  const inWin = (iso: string) => { const t = Date.parse(iso); return Number.isFinite(t) && t >= input.startMs && t <= input.nowMs; };
  return SOURCE_KEYS.map((key) => {
    const calls = input.calls.filter((c) => inWin(c.at) && CALL_SOURCES[key].includes(String(c.source ?? '')));
    const forms = input.forms.filter((f) => inWin(f.at) && f.channel === key);
    const first = new Map<string, number>();
    for (const x of [...calls.map((c) => ({ at: c.at, phone: c.phone })), ...forms.map((f) => ({ at: f.at, phone: f.phone }))]) {
      const p = d10(x.phone); if (!p) continue; const t = Date.parse(x.at);
      if (!first.has(p) || t < first.get(p)!) first.set(p, t);
    }
    const booked: SplitCount = { total: 0, pump: 0, drilling: 0 };
    for (const [p, t] of Array.from(first.entries())) {
      const hit = (jobsByPhone.get(p) ?? []).filter((j) => j.t >= t - BOOK_BEFORE_MS && j.t <= t + BOOK_AFTER_MS).sort((a, b) => a.t - b.t)[0];
      if (!hit) continue;
      booked.total += 1; if (workCategory(hit.title) === 'drilling') booked.drilling += 1; else booked.pump += 1;
    }
    const fs: SplitCount = { total: forms.length, pump: forms.filter((f) => formCat(f.serviceType) === 'pump').length, drilling: forms.filter((f) => formCat(f.serviceType) === 'drilling').length };
    return { key, label: SOURCE_LABEL[key], calls: calls.length, callers: new Set(calls.map((c) => d10(c.phone)).filter(Boolean)).size, forms: fs, booked, numbers: input.numbers?.[key] ?? [], note: input.notes?.[key] ?? null };
  });
}
