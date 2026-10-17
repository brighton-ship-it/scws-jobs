/**
 * Reversible "dismissed" marks for the Needs-callback / Going-cold lead card. Stored as one JSON value in
 * public.settings (key LEAD_DISMISSALS_KEY), so no migration and no call records are touched.
 * A dismissal hides that caller's calls up to and including `through`; a NEW call after it shows again.
 */
import { digits10 } from './call-dashboard.ts';

export const LEAD_DISMISSALS_KEY = 'lead_callback_dismissals';
export type LeadDismissal = { phone: string; through: string; dismissedAt: string; reason: string | null; by: string | null };

/** Read the stored value defensively; bad entries are dropped. */
export function parseDismissals(value: unknown): LeadDismissal[] {
  const items = (value && typeof value === 'object' && Array.isArray((value as any).items)) ? (value as any).items : [];
  const out: LeadDismissal[] = [];
  for (const it of items) {
    const phone = digits10(it?.phone);
    const t = Date.parse(it?.through ?? '');
    if (!phone || !Number.isFinite(t)) continue;
    out.push({ phone, through: new Date(t).toISOString(), dismissedAt: String(it?.dismissedAt ?? ''), reason: it?.reason ?? null, by: it?.by ?? null });
  }
  return out;
}

const SLACK_MS = 60_000; // call timestamps differ slightly between sources

export function isDismissed(phone: string | null | undefined, at: string, list: LeadDismissal[]): boolean {
  const p = digits10(phone);
  const t = Date.parse(at);
  if (!p || !Number.isFinite(t)) return false;
  return list.some((d) => d.phone === p && t <= Date.parse(d.through) + SLACK_MS);
}

export type DismissInput = { phone: string; at: string; reason?: string | null };

/** Add (or refresh) dismissals; returns the new list and how many inputs were valid. */
export function addDismissals(list: LeadDismissal[], inputs: DismissInput[], by: string | null, now = new Date()): { list: LeadDismissal[]; added: number; invalid: DismissInput[] } {
  const next = [...list];
  let added = 0;
  const invalid: DismissInput[] = [];
  for (const i of inputs) {
    const phone = digits10(i.phone);
    const t = Date.parse(i.at);
    if (!phone || !Number.isFinite(t)) { invalid.push(i); continue; }
    const through = new Date(t).toISOString();
    const idx = next.findIndex((d) => d.phone === phone);
    const entry = { phone, through, dismissedAt: now.toISOString(), reason: i.reason ?? null, by };
    if (idx >= 0) { if (Date.parse(next[idx].through) < t) next[idx] = entry; } else next.push(entry);
    added++;
  }
  return { list: next, added, invalid };
}

/** Undo: remove dismissals for these phones. */
export function removeDismissals(list: LeadDismissal[], phones: string[]): { list: LeadDismissal[]; removed: number } {
  const set = new Set(phones.map((p) => digits10(p)).filter((x): x is string => !!x));
  const next = list.filter((d) => !set.has(d.phone));
  return { list: next, removed: list.length - next.length };
}
