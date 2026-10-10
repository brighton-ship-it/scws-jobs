/** Fallback paging when a call's end-of-call report never arrives. */
export const FALLBACK_MARKER = '[office-alert-fallback-sent]';
/** Vapi sends the end-of-call report within seconds; wait this long before paging. */
export const FALLBACK_MIN_AGE_MS = 10 * 60 * 1000;
/** Do not page for rows older than this (avoids old backlog). */
export const FALLBACK_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export function isFallbackCandidate(
  row: { service_type?: string | null; notes?: string | null; vapi_call_id?: string | null; created_at?: string | null },
  nowMs: number,
): boolean {
  if (!row.vapi_call_id) return false;
  if (row.service_type !== 'Emergency' && row.service_type !== 'Callback') return false;
  if ((row.notes || '').includes(FALLBACK_MARKER)) return false;
  const created = row.created_at ? Date.parse(row.created_at) : NaN;
  if (!Number.isFinite(created)) return false;
  const age = nowMs - created;
  return age >= FALLBACK_MIN_AGE_MS && age <= FALLBACK_MAX_AGE_MS;
}
