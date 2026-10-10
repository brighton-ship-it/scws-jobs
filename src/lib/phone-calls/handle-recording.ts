import { downloadRecording, transcribe, summarize } from './process.ts';

export const MIN_SECONDS = 8;
export function normalizePhone(p: string | null | undefined): string | null {
  const d = (p ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

/** Process one completed recording. `db` is a supabase-like client. Idempotent per CallSid. */
export async function handleRecording(params: Record<string, string>, db: any, env: NodeJS.ProcessEnv = process.env, deps: { fetch?: typeof fetch } = {}) {
  const callSid = params.CallSid;
  if (!callSid || !params.RecordingUrl) return { ok: false, reason: 'missing fields' };
  const dur = parseInt(params.RecordingDuration || '0', 10) || 0;
  const now = () => new Date().toISOString();
  const base = { call_sid: callSid, recording_sid: params.RecordingSid, recording_duration_seconds: dur };

  const existing = await db.from('phone_call_log').select('processing_status, updated_at, caller_number').eq('call_sid', callSid).maybeSingle();
  const row = existing?.data;
  if (row && (row.processing_status === 'done' || row.processing_status === 'skipped')) return { ok: true, reason: 'already processed' };
  if (row?.processing_status === 'processing' && Date.now() - Date.parse(row.updated_at) < 4 * 60_000) return { ok: true, reason: 'in progress' };

  if (dur < MIN_SECONDS) {
    await db.from('phone_call_log').upsert({ ...base, processing_status: 'skipped', outcome: 'voicemail_or_no_answer', updated_at: now() }, { onConflict: 'call_sid' });
    return { ok: true, reason: 'too short' };
  }
  await db.from('phone_call_log').upsert({ ...base, processing_status: 'processing', updated_at: now() }, { onConflict: 'call_sid' });
  try {
    const audio = await downloadRecording(params.RecordingUrl, env.TWILIO_ACCOUNT_SID!, env.TWILIO_AUTH_TOKEN!, deps.fetch);
    const transcript = await transcribe(audio, env, deps.fetch);
    const s = transcript.trim().length > 20 ? await summarize(transcript, env, deps.fetch) : { summary: 'No speech captured.', outcome: 'voicemail_or_no_answer', caller_name: null, needs_followup: false };
    let jobber: string | null = null;
    const phone = normalizePhone(row?.caller_number ?? params.From);
    if (phone) {
      const m = await db.from('ads_calls').select('jobber_client_id').eq('caller_phone', phone).not('jobber_client_id', 'is', null).limit(1).maybeSingle();
      jobber = m?.data?.jobber_client_id ?? null;
    }
    await db.from('phone_call_log').upsert({ ...base, transcript, ...s, jobber_client_id: jobber, processing_status: 'done', processing_error: null, updated_at: now() }, { onConflict: 'call_sid' });
    return { ok: true, reason: 'done' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    await db.from('phone_call_log').upsert({ ...base, processing_status: 'failed', processing_error: msg.slice(0, 300), updated_at: now() }, { onConflict: 'call_sid' });
    return { ok: false, reason: msg };
  }
}
