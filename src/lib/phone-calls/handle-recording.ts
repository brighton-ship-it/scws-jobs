import { downloadRecording, transcribe, summarize, labelTurns, summaryCard, composeSummary } from './process.ts';
import { commitProcessingNote } from './missed-alert.ts';
import { findClientByPhone, buildNoteMessage, postCallNote } from './jobber-note.ts';

export const MIN_SECONDS = 8;
export function normalizePhone(p: string | null | undefined): string | null {
  const d = (p ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

/** Process one completed recording. `db` is a supabase-like client. Idempotent per CallSid. */
type JobberHooks = { find: typeof findClientByPhone; post: typeof postCallNote };
export async function handleRecording(params: Record<string, string>, db: any, env: NodeJS.ProcessEnv = process.env, deps: { fetch?: typeof fetch; jobber?: JobberHooks | null } = {}) {
  const callSid = params.CallSid;
  if (!callSid || !params.RecordingUrl) return { ok: false, reason: 'missing fields' };
  const dur = parseInt(params.RecordingDuration || '0', 10) || 0;
  const now = () => new Date().toISOString();
  const base = { call_sid: callSid, recording_sid: params.RecordingSid, recording_duration_seconds: dur };

  const existing = await db.from('inbound_call_recordings').select('processing_status, updated_at, caller_number, started_at, source, duration_seconds, processing_error').eq('call_sid', callSid).maybeSingle();
  const row = existing?.data;
  if (row && (row.processing_status === 'done' || row.processing_status === 'skipped')) return { ok: true, reason: 'already processed' };
  if (row?.processing_status === 'processing' && Date.now() - Date.parse(row.updated_at) < 4 * 60_000) return { ok: true, reason: 'in progress' };

  if (dur < MIN_SECONDS) {
    await db.from('inbound_call_recordings').upsert({ ...base, processing_status: 'skipped', outcome: 'voicemail_or_no_answer', updated_at: now() }, { onConflict: 'call_sid' });
    return { ok: true, reason: 'too short' };
  }
  await db.from('inbound_call_recordings').upsert({ ...base, processing_status: 'processing', updated_at: now() }, { onConflict: 'call_sid' });
  try {
    const audio = await downloadRecording(params.RecordingUrl, env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, deps.fetch);
    const raw = await transcribe(audio, env, deps.fetch);
    const transcript = raw.trim().length > 20 ? await labelTurns(raw, env, deps.fetch).catch(() => raw) : raw;
    const s = transcript.trim().length > 20 ? await summarize(transcript, env, deps.fetch) : { summary: 'No speech captured.', outcome: 'voicemail_or_no_answer', caller_name: null, needs_followup: false };
    if (transcript.trim().length > 20) s.summary = composeSummary(s.summary, await summaryCard(transcript, env, deps.fetch).catch(() => null));
    let jobber: string | null = null;
    const phone = normalizePhone(row?.caller_number ?? params.From);
    if (phone) {
      const m = await db.from('ads_calls').select('jobber_client_id').eq('caller_phone', phone).not('jobber_client_id', 'is', null).limit(1).maybeSingle();
      jobber = m?.data?.jobber_client_id ?? null;
    }
    let noteStatus: string | null = null;
    const hooks = deps.jobber === undefined ? { find: findClientByPhone, post: postCallNote } : deps.jobber;
    if (hooks && phone && env.PHONE_CALL_JOBBER_NOTES !== 'false' && s.outcome !== 'spam' && row?.source !== 'test') {
      try {
        if (!jobber) jobber = (await hooks.find(phone))?.id ?? null;
        if (jobber) {
          await hooks.post(jobber, buildNoteMessage({ startedAt: row?.started_at, source: row?.source, summary: s.summary, outcome: s.outcome, needsFollowup: s.needs_followup, transcript, durationSeconds: row?.duration_seconds ?? dur }));
          noteStatus = 'note posted';
        } else noteStatus = 'no jobber client match';
      } catch (e) { noteStatus = 'jobber note failed: ' + (e instanceof Error ? e.message : 'error').slice(0, 200); }
    }
    const savedAt = now();
    await db.from('inbound_call_recordings').upsert({ ...base, transcript, ...s, jobber_client_id: jobber, processing_status: 'done', updated_at: savedAt }, { onConflict: 'call_sid' });
    await commitProcessingNote(db, callSid, noteStatus, savedAt);
    return { ok: true, reason: 'done' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    const savedAt = now();
    await db.from('inbound_call_recordings').upsert({ ...base, processing_status: 'failed', updated_at: savedAt }, { onConflict: 'call_sid' });
    await commitProcessingNote(db, callSid, msg.slice(0, 300), savedAt);
    return { ok: false, reason: msg };
  }
}
