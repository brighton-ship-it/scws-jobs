/**
 * Direct mail test 1 (DM1): 2,500 postcards, $99 Well & Pump Checkup, code DM1, expires Dec 31 2026.
 * Pure helpers (no I/O) for the ops dashboard Direct mail card and the address match-back.
 *
 * Config (Vercel env, all optional):
 *   DM1_COST        total spend in USD once the Click2Mail order is placed (placeholder until then)
 *   DM1_PIECES      cards mailed (default 2500)
 *   DM1_MAIL_DATE   ISO date the cards went out (default 2026-10-26, Click2Mail estimate)
 * Match-back uses salted SHA-256 address keys (house number | first street word | ZIP5) of the
 * mailing list, so the repo holds no names or plain addresses.
 */
import { createHash } from 'node:crypto';
import KEYS from './dm1-address-keys.json' with { type: 'json' };

export const DM1 = { code: 'DM1', offer: '$99 Well & Pump Checkup', expires: '2026-12-31', number: '(760) 823-8910', landing: 'https://scwellservice.com/checkup' };
export const DM1_PLACEHOLDER_COST = 3275; // Click2Mail 6x9 First Class quote, 2026-10-19 (4.25x6 = 1950)
const KEYSET = new Set<string>(KEYS as string[]);

export function dm1Config(env: NodeJS.ProcessEnv = process.env) {
  const n = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
  const cost = n(env.DM1_COST);
  const mail = (env.DM1_MAIL_DATE || '2026-10-26').trim();
  return {
    pieces: n(env.DM1_PIECES) ?? 2500,
    spend: cost ?? DM1_PLACEHOLDER_COST,
    spendIsPlaceholder: cost == null,
    mailDate: mail,
    mailMs: Date.parse(`${mail}T00:00:00-07:00`),
  };
}

/** "12345 Old Wagon Rd" + "92065" -> "12345|OLD|92065" (same rule as the list build). */
export function addressKey(street: unknown, zip: unknown): string | null {
  const s = String(street ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d+)\s+(\S+)/);
  const z = String(zip ?? '').replace(/\D/g, '').slice(0, 5);
  return m && z.length === 5 ? `${m[1]}|${m[2]}|${z}` : null;
}
export const hashKey = (k: string) => createHash('sha256').update(`dm1:${k}`).digest('hex').slice(0, 20);
export function isMailedAddress(street: unknown, zip: unknown, keys: Set<string> = KEYSET): boolean {
  const k = addressKey(street, zip);
  return !!k && keys.has(hashKey(k));
}
export const mailedKeyCount = () => KEYSET.size;

export interface MatchClient { id: string; name: string | null; createdAt: string; addresses: Array<{ street1?: string | null; postalCode?: string | null }>; phones: string[] }
/** New Jobber clients (created on/after mail date, within 90 days) whose billing or property address was on the list. */
export function matchByAddress(clients: MatchClient[], mailMs: number, nowMs = Date.now(), keys: Set<string> = KEYSET) {
  const end = mailMs + 90 * 86400_000;
  return clients.filter((c) => {
    const t = Date.parse(c.createdAt);
    return Number.isFinite(t) && t >= mailMs && t <= Math.min(end, nowMs) && c.addresses.some((a) => isMailedAddress(a.street1, a.postalCode, keys));
  });
}

export interface DmSummaryInput {
  calls: number; callers: number; forms: number; booked: number; matched: number; matchedNotTracked: number;
  invoiced: number; pieces: number; spend: number; spendIsPlaceholder: boolean;
}
export function dmSummary(x: DmSummaryInput) {
  const responses = x.callers + x.forms + x.matchedNotTracked;
  const pct = (n: number) => (x.pieces ? Math.round((n / x.pieces) * 10000) / 100 : null);
  return {
    ...x,
    responses,
    responseRatePct: pct(responses),
    trackedResponseRatePct: pct(x.callers + x.forms),
    costPerResponse: responses ? Math.round((x.spend / responses) * 100) / 100 : null,
    costPerBooking: x.booked ? Math.round((x.spend / x.booked) * 100) / 100 : null,
    roas: x.spend ? Math.round((x.invoiced / x.spend) * 100) / 100 : null,
  };
}
