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
