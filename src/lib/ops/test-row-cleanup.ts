/**
 * One-off cleanup of 10/17/2026 test traffic (approved by Brighton). Hard-coded allowlist:
 *  - inbound_call_recordings rows whose call_sid starts with 'CAtest' AND started_at >= 2026-10-17 00:00 PT
 *  - receptionist_calls id 2552d041-2d2b-499a-8b23-c4b34cb8d271 (phantom 8:22 AM "Unknown caller")
 *  - tasks id 4999ce4e-6ea7-4080-8a42-39c1f8bc607f (its task)
 * Expires 2026-10-18 00:00 PT. Pure helpers; the route does the I/O.
 */
export const RECORDING_SID_PREFIX = 'CAtest';
export const RECORDINGS_SINCE_ISO = '2026-10-17T07:00:00.000Z'; // 2026-10-17 00:00 PDT
export const PHANTOM_RECEPTIONIST_CALL_ID = '2552d041-2d2b-499a-8b23-c4b34cb8d271';
export const PHANTOM_TASK_ID = '4999ce4e-6ea7-4080-8a42-39c1f8bc607f';
export const CLEANUP_EXPIRES_ISO = '2026-10-18T07:00:00.000Z';

export function cleanupExpired(now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(CLEANUP_EXPIRES_ISO);
}

export function isAllowedRecording(r: { call_sid?: string | null; started_at?: string | null }): boolean {
  const sid = r.call_sid ?? '';
  const t = Date.parse(r.started_at ?? '');
  return sid.startsWith(RECORDING_SID_PREFIX) && Number.isFinite(t) && t >= Date.parse(RECORDINGS_SINCE_ISO);
}

/** The phantom record must be the named id AND from 10/17 (guards against a reused id). */
export function isAllowedReceptionistCall(r: { id?: string | null; called_at?: string | null }): boolean {
  const t = Date.parse(r.called_at ?? '');
  return r.id === PHANTOM_RECEPTIONIST_CALL_ID && Number.isFinite(t) && t >= Date.parse(RECORDINGS_SINCE_ISO);
}

export function isAllowedTask(r: { id?: string | null }): boolean {
  return r.id === PHANTOM_TASK_ID;
}
