/**
 * remove_client_phone: delete ONE phone number from ONE Jobber client with clientEdit(phonesToDelete).
 * Narrow on purpose: no other client field can change. Reads the client's phones first (before) and
 * re-reads after a write (after). dryRun defaults to TRUE. Refuses when the number is the client's only
 * phone. When the removed number was primary, the first remaining phone is made primary in the same edit.
 * Nothing emails, texts, or notifies the client.
 */
import { assertNoJobberErrors, jobberGraphql, jobberUserErrors } from './client.ts';
import { assertWriteDoesNotDeliver } from './mcp-notify.ts';
import type { JobberDeps } from './quotes.ts';

export interface ClientPhone { id: string; number: string; description: string | null; primary: boolean }
export interface RemoveClientPhoneInput { clientId: string; phone: string; dryRun: boolean }
export interface RemoveClientPhoneResult {
  dryRun: boolean;
  mutated: boolean;
  clientId: string;
  clientName: string | null;
  removed: ClientPhone[];
  promotedPrimary: ClientPhone | null;
  before: ClientPhone[];
  after: ClientPhone[];
}

const digits10 = (v: unknown): string => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
};

const READ = `query McpClientPhones($id: EncodedId!) {
  client(id: $id) { id name phones { id number description primary } }
}`;
const EDIT = `mutation McpClientRemovePhone($clientId: EncodedId!, $input: ClientEditInput!) {
  clientEdit(clientId: $clientId, input: $input) { client { id phones { id number description primary } } userErrors { message path } }
}`;

async function gql(query: string, variables: Record<string, unknown>, deps?: JobberDeps) {
  assertWriteDoesNotDeliver(query);
  return jobberGraphql(query, variables, { token: deps?.token, fetchImpl: deps?.fetchImpl, env: deps?.env });
}

async function readPhones(clientId: string, deps?: JobberDeps): Promise<{ name: string | null; phones: ClientPhone[] }> {
  const r = await gql(READ, { id: clientId }, deps);
  assertNoJobberErrors(r, 'client');
  const c = r.data?.client;
  if (!c?.id) throw new Error(`Jobber client ${clientId} not found`);
  return { name: c.name ?? null, phones: (c.phones ?? []).map((p: any) => ({ id: p.id, number: p.number, description: p.description ?? null, primary: !!p.primary })) };
}

export function parseRemoveClientPhoneArgs(args: Record<string, unknown>): RemoveClientPhoneInput {
  const clientId = typeof args.clientId === 'string' ? args.clientId.trim() : '';
  if (!clientId) throw new Error('clientId is required');
  const phone = digits10(args.phone);
  if (phone.length !== 10) throw new Error('phone must be a 10-digit US number');
  const extra = Object.keys(args).filter((k) => !['clientId', 'phone', 'dryRun'].includes(k));
  if (extra.length) throw new Error(`Unsupported fields: ${extra.join(', ')}`);
  return { clientId, phone, dryRun: args.dryRun !== false };
}

export async function removeClientPhone(input: RemoveClientPhoneInput, deps?: JobberDeps): Promise<RemoveClientPhoneResult> {
  const { name, phones: before } = await readPhones(input.clientId, deps);
  const removed = before.filter((p) => digits10(p.number) === input.phone);
  const remaining = before.filter((p) => digits10(p.number) !== input.phone);
  const base = { clientId: input.clientId, clientName: name, removed, before };
  if (!removed.length) return { ...base, dryRun: input.dryRun, mutated: false, promotedPrimary: null, after: before };
  if (!remaining.length) throw new Error('Refusing: that is the client\'s only phone number');
  const promotedPrimary = removed.some((p) => p.primary) && !remaining.some((p) => p.primary) ? remaining[0] : null;
  const projected = remaining.map((p) => (promotedPrimary && p.id === promotedPrimary.id ? { ...p, primary: true } : p));
  if (input.dryRun) return { ...base, dryRun: true, mutated: false, promotedPrimary, after: projected };
  const edit: Record<string, unknown> = { phonesToDelete: removed.map((p) => p.id) };
  if (promotedPrimary) edit.phonesToEdit = [{ id: promotedPrimary.id, primary: true }];
  const r = await gql(EDIT, { clientId: input.clientId, input: edit }, deps);
  assertNoJobberErrors(r, 'clientEdit');
  const errs = jobberUserErrors(r.data?.clientEdit);
  if (errs.length) throw new Error(errs.join('; '));
  const fresh = await readPhones(input.clientId, deps);
  return { ...base, dryRun: false, mutated: true, promotedPrimary, after: fresh.phones };
}
