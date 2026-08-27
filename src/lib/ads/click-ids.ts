/**
 * Google Ads / GA4 identifiers posted by the marketing site.
 * Accept when present; never invent values.
 */

export interface AdsClickIds {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  ga_client_id: string | null;
  ga_session_id: string | null;
}

const MAX_LEN = 256;
const SAFE_ID = /^[\w.-]+$/;

function cleanId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_LEN) return null;
  if (!SAFE_ID.test(trimmed)) return null;
  return trimmed;
}

function firstPresent(body: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const cleaned = cleanId(body[key]);
    if (cleaned) return cleaned;
  }
  return null;
}

export function extractAdsClickIds(body: unknown): AdsClickIds {
  const record =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  return {
    gclid: firstPresent(record, ['gclid']),
    gbraid: firstPresent(record, ['gbraid']),
    wbraid: firstPresent(record, ['wbraid']),
    ga_client_id: firstPresent(record, ['ga_client_id', 'gaClientId']),
    ga_session_id: firstPresent(record, ['ga_session_id', 'gaSessionId']),
  };
}

export function hasAnyClickId(ids: AdsClickIds): boolean {
  return Boolean(
    ids.gclid || ids.gbraid || ids.wbraid || ids.ga_client_id || ids.ga_session_id
  );
}
