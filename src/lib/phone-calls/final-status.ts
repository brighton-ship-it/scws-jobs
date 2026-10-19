/**
 * Number-level StatusCallback (final call status). Every SCWS Twilio number sends it to /api/calls/webhook.
 * The <Dial action> (/api/calls/inbound/status) only fires when the call reaches the <Dial>; a caller who hangs up
 * during the recording notice never gets there, so their row stayed pending forever ("Status unknown").
 * This closes out exactly those rows: final status arrived, but no dial status was ever recorded.
 */
export const FINAL_STATUSES = new Set(['completed', 'busy', 'no-answer', 'failed', 'canceled']);

export function hangupSummary(durationSeconds: number | null): string {
  const d = durationSeconds != null ? `${durationSeconds} second${durationSeconds === 1 ? '' : 's'}` : 'a few seconds';
  return `Caller hung up after ${d}, during the recording notice, before any phone rang. Nobody answered and it never reached Mike.`;
}

/** Row patch for a call that ended before the <Dial>; null if this callback isn't a final status. */
export function finalStatusPatch(params: Record<string, string>, nowIso = new Date().toISOString()) {
  const status = params.CallStatus || '';
  if (!params.CallSid || !FINAL_STATUSES.has(status)) return null;
  const d = parseInt(params.CallDuration || '', 10);
  const duration = Number.isFinite(d) ? d : null;
  return {
    dial_status: status === 'completed' ? 'caller_hung_up' : status,
    answered: false,
    duration_seconds: duration,
    processing_status: 'skipped',
    outcome: 'hung_up',
    summary: hangupSummary(duration),
    needs_followup: false,
    updated_at: nowIso,
  };
}
