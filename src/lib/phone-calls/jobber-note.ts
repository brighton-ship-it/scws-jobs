/** Post a call summary as a Jobber client note (match caller by phone). Never emails/texts the client. */
import { jobberGraphql } from '../jobber/client.ts';
import { createNote } from '../jobber/mcp-notes.ts';

const Q = `query CallerLookup($searchTerm: String!) { clients(searchTerm: $searchTerm, first: 10) { nodes { id name phones { number } } } }`;
const d10 = (p: string) => p.replace(/\D/g, '').slice(-10);

export async function findClientByPhone(phone: string, deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}): Promise<{ id: string; name: string | null } | null> {
  const n = d10(phone);
  if (n.length !== 10) return null;
  const r: any = await jobberGraphql(Q, { searchTerm: n.slice(-7) }, deps);
  for (const c of r?.data?.clients?.nodes ?? []) {
    if ((c.phones ?? []).some((p: any) => d10(p.number || '') === n)) return { id: c.id, name: c.name ?? null };
  }
  return null;
}

export function buildNoteMessage(o: { startedAt?: string | null; source?: string | null; summary: string; outcome: string; needsFollowup: boolean; transcript: string; durationSeconds?: number | null }): string {
  const when = new Date(o.startedAt || Date.now()).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const t = o.transcript.length > 3000 ? o.transcript.slice(0, 3000) + ' …' : o.transcript;
  return `📞 Inbound call ${when} PT${o.durationSeconds ? ` (${o.durationSeconds}s)` : ''}${o.source ? ` · ${o.source}` : ''}\nOutcome: ${o.outcome.replace(/_/g, ' ')}${o.needsFollowup ? ' · NEEDS FOLLOW-UP' : ''}\nSummary: ${o.summary}\n\nTranscript:\n${t}`;
}

export async function postCallNote(clientId: string, message: string, deps: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {}) {
  return createNote({ target: 'client', id: clientId, message }, deps as any);
}
