/** Download -> transcribe -> summarize. Pure-ish: network calls are injectable for tests. */
export type Summary = { summary: string; outcome: string; caller_name: string | null; needs_followup: boolean };
export const OUTCOMES = ['booked', 'quote_request', 'existing_customer', 'emergency', 'billing', 'sales_vendor', 'spam', 'voicemail_or_no_answer', 'other'] as const;

type F = typeof fetch;

export async function downloadRecording(recordingUrl: string, sid: string, token: string, f: F = fetch): Promise<ArrayBuffer> {
  const url = recordingUrl.replace(/\.(json|mp3|wav)$/, '') + '.mp3';
  if (!/^https:\/\/api\.twilio\.com\//.test(url)) throw new Error('unexpected recording host');
  const res = await f(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') } });
  if (!res.ok) throw new Error(`recording download ${res.status}`);
  return res.arrayBuffer();
}

export async function transcribe(audio: ArrayBuffer, env: NodeJS.ProcessEnv = process.env, f: F = fetch): Promise<string> {
  if (env.DEEPGRAM_API_KEY) {
    const res = await f('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&multichannel=true&utterances=true&punctuate=true&language=en', {
      method: 'POST', headers: { Authorization: `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': 'audio/mpeg' }, body: audio,
    });
    if (!res.ok) throw new Error(`deepgram ${res.status}`);
    const j: any = await res.json();
    const utts: Array<{ channel: number; transcript: string }> = j?.results?.utterances ?? [];
    if (utts.length) return utts.map((u) => `${u.channel === 0 ? 'Caller' : 'Shop'}: ${u.transcript}`).join('\n');
    return j?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  }
  if (!env.OPENAI_API_KEY) throw new Error('no transcription key (DEEPGRAM_API_KEY or OPENAI_API_KEY)');
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'call.mp3');
  fd.append('model', env.PHONE_CALL_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  fd.append('response_format', 'text');
  const res = await f('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd });
  if (!res.ok) throw new Error(`openai transcribe ${res.status}`);
  return (await res.text()).trim();
}

export function parseSummary(raw: string): Summary {
  let j: any = {};
  try { j = JSON.parse(raw); } catch { /* fall through */ }
  const outcome = (OUTCOMES as readonly string[]).includes(j.outcome) ? j.outcome : 'other';
  return {
    summary: String(j.summary ?? '').slice(0, 1200),
    outcome,
    caller_name: j.caller_name ? String(j.caller_name).slice(0, 80) : null,
    needs_followup: Boolean(j.needs_followup),
  };
}

export async function summarize(transcript: string, env: NodeJS.ProcessEnv = process.env, f: F = fetch): Promise<Summary> {
  if (!env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY');
  const res = await f('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.PHONE_CALL_SUMMARY_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You summarize inbound phone calls for Southern California Well Service (well pumps, drilling, water systems). Reply with JSON: {"summary": "2-3 sentences: who, where, what they need, what was agreed", "outcome": one of ${OUTCOMES.join('|')}, "caller_name": string|null, "needs_followup": boolean (true if someone must call back or an action is pending)}. Use only what is in the transcript.` },
        { role: 'user', content: transcript.slice(0, 24000) },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai summary ${res.status}`);
  const j: any = await res.json();
  return parseSummary(j?.choices?.[0]?.message?.content ?? '{}');
}

/** True when a transcript already has one "Speaker: text" turn per line. */
export function hasSpeakerTurns(t: string | null | undefined): boolean {
  const lines = (t ?? '').split('\n').filter((l) => l.trim());
  return lines.length > 1 && lines.every((l) => /^(SCWS|Shop|Caller|AI|Mike|User|Assistant)\s*:/i.test(l));
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean).length;

/**
 * Split a single-channel transcript into speaker turns (SCWS vs Caller) with gpt-4o-mini.
 * Words are kept verbatim; if the model drops more than 10% of the words, the original is returned.
 */
export async function labelTurns(transcript: string, env: NodeJS.ProcessEnv = process.env, f: F = fetch): Promise<string> {
  if (!env.OPENAI_API_KEY || !transcript.trim() || hasSpeakerTurns(transcript)) return transcript;
  const res = await f('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.PHONE_CALL_SUMMARY_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'This is a phone call to Southern California Well Service (SCWS). The staff member answers (e.g. "Hello, this is Liz"). Split the transcript into speaker turns. Reply JSON {"turns":[{"speaker":"SCWS"|"Caller","text":"..."}]}. Copy the words exactly in order; do not add, drop, or rephrase anything.' },
        { role: 'user', content: transcript.slice(0, 24000) },
      ],
    }),
  });
  if (!res.ok) return transcript;
  try {
    const j: any = await res.json();
    const turns: Array<{ speaker: string; text: string }> = JSON.parse(j?.choices?.[0]?.message?.content ?? '{}').turns ?? [];
    const out = turns.filter((t) => t?.text?.trim()).map((t) => `${/caller/i.test(t.speaker) ? 'Caller' : 'SCWS'}: ${t.text.trim().replace(/\s+/g, ' ')}`).join('\n');
    return out && words(out) >= 0.9 * words(transcript) ? out : transcript;
  } catch { return transcript; }
}

export type SummaryCard = { who: string | null; address: string | null; issue: string | null; next_step: string | null; booked_time: string | null };
/** Structured summary box fields (who / address / issue / next step / booked time). */
export async function summaryCard(transcript: string, env: NodeJS.ProcessEnv = process.env, f: F = fetch): Promise<SummaryCard | null> {
  if (!env.OPENAI_API_KEY || transcript.trim().length < 20) return null;
  const res = await f('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env.PHONE_CALL_SUMMARY_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'From this call to Southern California Well Service, reply JSON {"who": caller name and role/relationship or null, "address": street/city mentioned or null, "issue": short problem description or null, "next_step": outcome / what happens next or null, "booked_time": appointment day/time if one was booked, else null}. Only facts stated in the transcript. Keep each under 120 characters.' },
        { role: 'user', content: transcript.slice(0, 24000) },
      ],
    }),
  });
  if (!res.ok) return null;
  try {
    const j: any = await res.json();
    const o = JSON.parse(j?.choices?.[0]?.message?.content ?? '{}');
    const s = (v: unknown) => (typeof v === 'string' && v.trim() && !/^(null|none|n\/a)$/i.test(v.trim()) ? v.trim().slice(0, 160) : null);
    return { who: s(o.who), address: s(o.address), issue: s(o.issue), next_step: s(o.next_step), booked_time: s(o.booked_time) };
  } catch { return null; }
}

/** Summary text stored in the existing `summary` column: the 2-3 sentence summary, then "Key: value" lines for the box. */
export function composeSummary(summary: string, card: SummaryCard | null): string {
  if (!card) return summary;
  const L: Array<[string, string | null]> = [['Who', card.who], ['Address', card.address], ['Issue', card.issue], ['Next step', card.next_step], ['Booked', card.booked_time]];
  const lines = L.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  return lines.length ? `${summary.split('\n')[0]}\n${lines.join('\n')}` : summary;
}
