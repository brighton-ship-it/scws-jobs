/**
 * Reject a town argument that is empty, the caller's surname, or not a real place.
 * checkServiceArea still passes unknown real places (Lancaster) through.
 * checkSchedule and book_job require a town we can put on a job.
 * This does not text, dial, or book.
 */

import {
  bookableTownName,
  isBookablePlace,
  isCountyPhrase,
  isKnownTown,
  matchedTownName,
  normalizeServicePlace,
  serviceAreaLocationFromParams,
} from './service-area.ts';

export const TOWN_GUARD_MESSAGE =
  "That doesn't look like a town. Ask the caller: 'What town is the well in?' and call again with that town.";

export type TownContext = {
  callerName?: string | null;
  customerName?: string | null;
  addressOnFile?: { city: string | null } | null;
};

export type TownCheck =
  | { ok: true; town: string }
  | { ok: false; reason: 'empty' | 'matches_caller_name' | 'unknown_place'; message: string };

const AREA_TOOLS = new Set(['checkServiceArea']);
const SCHEDULE_TOOLS = new Set(['checkSchedule']);
const BOOK_TOOLS = new Set(['bookJob', 'book_job', 'bookServiceCall']);

function nameTokens(name: string | null | undefined): string[] {
  return normalizeServicePlace(name || '')
    .split(' ')
    .filter((token) => token.length >= 2);
}

function isZip(value: string): boolean {
  const raw = value.trim();
  if (!/^[\d\s-]+$/.test(raw)) return false;
  return /^\d{5}(?:\d{4})?$/.test(raw.replace(/\D/g, ''));
}

export function validateTownArg(town: string | undefined, ctx: TownContext = {}): TownCheck {
  const raw = String(town || '').trim();
  const place = normalizeServicePlace(raw);
  if (!place) return { ok: false, reason: 'empty', message: TOWN_GUARD_MESSAGE };
  if (isZip(raw)) return { ok: true, town: raw.replace(/\D/g, '').slice(0, 5) };

  const tokens = new Set<string>([...nameTokens(ctx.callerName), ...nameTokens(ctx.customerName)]);
  if (tokens.has(place) && !isKnownTown(raw) && !isBookablePlace(raw)) {
    return { ok: false, reason: 'matches_caller_name', message: TOWN_GUARD_MESSAGE };
  }

  if (isKnownTown(raw)) return { ok: true, town: matchedTownName(raw) || raw };
  if (isCountyPhrase(raw)) return { ok: true, town: raw };
  if (isBookablePlace(raw)) return { ok: true, town: bookableTownName(raw) || matchedTownName(raw) || raw };

  const contained = matchedTownName(raw);
  if (contained && !tokens.has(place)) return { ok: true, town: contained };

  const fileCity = normalizeServicePlace(ctx.addressOnFile?.city || '');
  if (fileCity && fileCity === place) return { ok: true, town: ctx.addressOnFile?.city || raw };

  return { ok: false, reason: 'unknown_place', message: TOWN_GUARD_MESSAGE };
}

export function townArgForTool(name: string, params: Record<string, unknown>): string {
  if (AREA_TOOLS.has(name)) return serviceAreaLocationFromParams(params);
  const city = params.city ?? params.town ?? params.location;
  return typeof city === 'string' ? city : '';
}

/**
 * null means the tool may run. checkServiceArea only blocks an empty value or the
 * caller's name. Unknown places such as Lancaster stay on the existing "office will confirm" path.
 */
export function townGuardResult(
  name: string,
  params: Record<string, unknown>,
  ctx: TownContext = {},
): { result: { error: 'invalid_town'; message: string } } | null {
  if (!AREA_TOOLS.has(name) && !SCHEDULE_TOOLS.has(name) && !BOOK_TOOLS.has(name)) return null;
  const check = validateTownArg(townArgForTool(name, params), ctx);
  if (check.ok) return null;
  if (check.reason === 'unknown_place' && AREA_TOOLS.has(name)) return null;
  return { result: { error: 'invalid_town', message: check.message } };
}

export function withTownGuard<T>(
  name: string,
  params: Record<string, unknown>,
  ctx: TownContext,
  run: () => T,
): T | { result: { error: 'invalid_town'; message: string } } {
  const blocked = townGuardResult(name, params, ctx);
  if (blocked) return blocked;
  return run();
}

type CachedCaller = { name: string | null; city: string | null; at: number };
const callers = new Map<string, CachedCaller>();
const CALLER_TTL_MS = 60 * 60 * 1000;

function pruneCallers(now: number) {
  const stale: string[] = [];
  callers.forEach((row, id) => {
    if (now - row.at > CALLER_TTL_MS) stale.push(id);
  });
  for (let i = 0; i < stale.length; i++) callers.delete(stale[i]);
  while (callers.size > 500) {
    const oldest = callers.keys().next().value;
    if (!oldest) break;
    callers.delete(oldest);
  }
}

/** Remember lookupCustomer's name and property town for later tools on this call. */
export function rememberLookupCaller(
  callId: string | null | undefined,
  lookup: { customerName?: string | null; city?: string | null } | null | undefined,
) {
  if (!callId || !lookup) return;
  const now = Date.now();
  pruneCallers(now);
  const prev = callers.get(callId);
  callers.set(callId, {
    name: lookup.customerName || prev?.name || null,
    city: lookup.city ?? prev?.city ?? null,
    at: now,
  });
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function callerTownContext(callId: string | null | undefined, params: Record<string, unknown>): TownContext {
  pruneCallers(Date.now());
  const cached = callId ? callers.get(callId) : undefined;
  const address = params.addressOnFile;
  const addressCity =
    address && typeof address === 'object' && !Array.isArray(address)
      ? str((address as { city?: unknown }).city)
      : '';
  return {
    callerName: str(params.callerName) || cached?.name || null,
    customerName: str(params.customerName) || str(params.name) || cached?.name || null,
    addressOnFile: addressCity
      ? { city: addressCity }
      : cached?.city
        ? { city: cached.city }
        : null,
  };
}
