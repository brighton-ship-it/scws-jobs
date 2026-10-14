/** Read outbound calls for callback matching. Does not write. */
import { fetchVoiceActivityPayload, voiceLogConfig } from './voice-log.ts';
import { parsePhoneCallLog, type PhoneLogRow } from './phone-call-log.ts';
import { fetchTwilioOutbound } from './twilio-outbound.ts';

export async function loadLiveOutbound(
  startIso: string,
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ rows: PhoneLogRow[]; notes: string[] }> {
  const notes: string[] = [];
  const rows: PhoneLogRow[] = [];
  const voice = voiceLogConfig(env);
  if (voice) {
    try {
      const payload = await fetchVoiceActivityPayload(voice, fetchImpl, startIso);
      rows.push(...parsePhoneCallLog(payload).filter((r) => r.direction === 'outbound'));
    } catch (error) {
      notes.push(`outbound voice log: ${error instanceof Error ? error.message : 'error'}`);
    }
  }
  try {
    rows.push(...await fetchTwilioOutbound(startIso, env, fetchImpl));
  } catch (error) {
    notes.push(`outbound twilio: ${error instanceof Error ? error.message : 'error'}`);
  }
  return { rows, notes };
}
