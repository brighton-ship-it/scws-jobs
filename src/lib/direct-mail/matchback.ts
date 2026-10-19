/** Live DM1 match-back: new Jobber clients since the mail date whose billing/property address was mailed. Read-only. */
import { jobberGraphql } from '../jobber/client.ts';
import { matchByAddress, type MatchClient } from './campaign.ts';

const Q = `query DmClients($first: Int!, $after: String, $filter: ClientFilterAttributes) {
  clients(first: $first, after: $after, filter: $filter) {
    nodes { id name createdAt phones { number } billingAddress { street1 postalCode } properties { address { street1 postalCode } } }
    pageInfo { hasNextPage endCursor } } }`;

export async function loadNewClients(sinceIso: string, maxPages = 10): Promise<MatchClient[]> {
  const out: MatchClient[] = [];
  let after: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const r: any = await jobberGraphql(Q, { first: 50, after, filter: { createdAt: { after: sinceIso } } });
    if (r?.errors?.length) throw new Error(r.errors.map((e: any) => e.message).join('; '));
    const c = r?.data?.clients;
    for (const n of c?.nodes ?? []) {
      out.push({
        id: n.id, name: n.name ?? null, createdAt: n.createdAt,
        phones: (n.phones ?? []).map((p: any) => String(p.number ?? '').replace(/\D/g, '').slice(-10)).filter((p: string) => p.length === 10),
        addresses: [n.billingAddress, ...((n.properties ?? []).map((p: any) => p?.address))].filter(Boolean),
      });
    }
    if (!c?.pageInfo?.hasNextPage) break;
    after = c.pageInfo.endCursor;
  }
  return out;
}

export async function dm1Matchback(mailMs: number, nowMs = Date.now()) {
  if (!Number.isFinite(mailMs) || nowMs < mailMs) return { scanned: 0, matches: [] as MatchClient[] };
  const clients = await loadNewClients(new Date(mailMs).toISOString());
  return { scanned: clients.length, matches: matchByAddress(clients, mailMs, nowMs) };
}
