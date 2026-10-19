import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRemoveClientPhoneArgs, removeClientPhone } from './mcp-client-phones.ts';

function mock(phones: any[]) {
  const bodies: any[] = [];
  let current = phones;
  const fetchImpl = (async (_url: string, init: any) => {
    const body = JSON.parse(init.body); bodies.push(body);
    if (body.query.includes('McpClientRemovePhone')) {
      const del = new Set(body.variables.input.phonesToDelete);
      const prim = body.variables.input.phonesToEdit?.[0]?.id;
      current = current.filter((p) => !del.has(p.id)).map((p) => (p.id === prim ? { ...p, primary: true } : p));
      return new Response(JSON.stringify({ data: { clientEdit: { client: { id: 'c1', phones: current }, userErrors: [] } } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { client: { id: 'c1', name: 'Byeong Kim', phones: current } } }), { status: 200 });
  }) as any;
  return { fetchImpl, bodies };
}
const P = [{ id: 'p1', number: '4083181171', description: 'Main', primary: true }, { id: 'p2', number: '(951) 551-3430', description: 'Mobile', primary: false }];

test('dryRun default does not call clientEdit', async () => {
  const { fetchImpl, bodies } = mock(P);
  const r = await removeClientPhone(parseRemoveClientPhoneArgs({ clientId: 'c1', phone: '+1 408-318-1171' }), { fetchImpl, token: 't' } as any);
  assert.equal(r.dryRun, true); assert.equal(r.mutated, false);
  assert.deepEqual(r.after.map((p) => p.id), ['p2']); assert.equal(r.after[0].primary, true);
  assert.equal(bodies.some((b) => b.query.includes('clientEdit')), false);
});

test('write deletes only that phone and promotes remaining primary', async () => {
  const { fetchImpl, bodies } = mock(P);
  const r = await removeClientPhone(parseRemoveClientPhoneArgs({ clientId: 'c1', phone: '4083181171', dryRun: false }), { fetchImpl, token: 't' } as any);
  assert.equal(r.mutated, true);
  const edit = bodies.find((b) => b.query.includes('clientEdit'));
  assert.deepEqual(edit.variables.input, { phonesToDelete: ['p1'], phonesToEdit: [{ id: 'p2', primary: true }] });
  assert.deepEqual(r.after.map((p) => p.number), ['(951) 551-3430']);
});

test('refuses only phone and unknown fields', async () => {
  const { fetchImpl } = mock([P[0]]);
  await assert.rejects(removeClientPhone(parseRemoveClientPhoneArgs({ clientId: 'c1', phone: '4083181171', dryRun: false }), { fetchImpl, token: 't' } as any), /only phone/);
  assert.throws(() => parseRemoveClientPhoneArgs({ clientId: 'c1', phone: '4083181171', name: 'x' }), /Unsupported/);
});
