/**
 * Vapi end-of-call-report sends durationSeconds as a fractional number
 * (for example 118.54). receptionist_calls.duration_sec is an integer
 * column, and Postgres rejects the fractional value.
 */

function asNonNegativeSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed);
  }
  return null;
}

function firstSeconds(values: unknown[]): number | null {
  for (const value of values) {
    const seconds = asNonNegativeSeconds(value);
    if (seconds != null) return seconds;
  }
  return null;
}

function firstMilliseconds(values: unknown[]): number | null {
  for (const value of values) {
    const ms = asNonNegativeSeconds(value);
    if (ms != null) return Math.round(ms / 1000);
  }
  return null;
}

/**
 * Integer seconds for receptionist_calls.duration_sec and the office email.
 * Prefers Vapi's durationSeconds (number or numeric string), then durationMs,
 * then startedAt/endedAt.
 */
export function resolveCallDurationSec(body: unknown): number {
  const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = (root.message && typeof root.message === 'object' ? root.message : {}) as Record<string, unknown>;
  const call = (message.call && typeof message.call === 'object'
    ? message.call
    : root.call && typeof root.call === 'object'
      ? root.call
      : {}) as Record<string, unknown>;
  const artifact = (message.artifact && typeof message.artifact === 'object'
    ? message.artifact
    : {}) as Record<string, unknown>;

  const direct = firstSeconds([
    message.durationSeconds,
    message.duration_seconds,
    call.durationSeconds,
    call.duration_seconds,
    root.durationSeconds,
    root.duration_seconds,
    artifact.durationSeconds,
  ]);
  if (direct != null) return direct;

  const fromMs = firstMilliseconds([
    message.durationMs,
    message.duration_ms,
    call.durationMs,
    root.durationMs,
  ]);
  if (fromMs != null) return fromMs;

  const ambiguous = firstSeconds([call.duration, message.duration, root.duration]);
  if (ambiguous != null) {
    // Some payloads put milliseconds in `duration`. A real call is not 100000 seconds.
    if (ambiguous > 100000) return Math.round(ambiguous / 1000);
    return ambiguous;
  }

  const started = message.startedAt || call.startedAt || root.startedAt;
  const ended = message.endedAt || call.endedAt || root.endedAt;
  if (typeof started === 'string' && typeof ended === 'string') {
    const delta = new Date(ended).getTime() - new Date(started).getTime();
    if (Number.isFinite(delta) && delta >= 0) return Math.round(delta / 1000);
  }

  return 0;
}

export function formatDurationLabel(durationSec: number): string {
  const rounded = Math.round(Number(durationSec) || 0);
  if (rounded <= 0) return 'Unknown';
  return `${Math.floor(rounded / 60)}m ${rounded % 60}s`;
}
