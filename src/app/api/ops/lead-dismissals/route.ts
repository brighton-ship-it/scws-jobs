/**
 * Reversible dismiss/restore for the Needs-callback (Going cold) lead card. Ops auth (office key or CRM session).
 * GET  -> current dismissals.
 * POST { action: 'dismiss', items: [{ phone, at, reason? }] }  hides that caller's calls up to `at`.
 * POST { action: 'restore', phones: ['(619) 555-0100', ...] } removes the marks (the leads show again).
 * Only touches settings.lead_callback_dismissals; never edits or deletes call records.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { LEAD_DISMISSALS_KEY, addDismissals, parseDismissals, removeDismissals } from '@/lib/ads/lead-dismissals';

export const dynamic = 'force-dynamic';
const MAX_ITEMS = 200;

async function load(db: any) {
  const r = await db.from('settings').select('value').eq('key', LEAD_DISMISSALS_KEY).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  return parseDismissals(r.data?.value);
}

export async function GET(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ items: await load(createServiceClient()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;
  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }
  const db: any = createServiceClient();
  try {
    const current = await load(db);
    let next = current;
    let result: Record<string, unknown> = {};
    if (body?.action === 'dismiss' && Array.isArray(body.items) && body.items.length <= MAX_ITEMS) {
      const r = addDismissals(current, body.items, typeof body.by === 'string' ? body.by.slice(0, 80) : 'office');
      next = r.list; result = { added: r.added, invalid: r.invalid };
    } else if (body?.action === 'restore' && Array.isArray(body.phones) && body.phones.length <= MAX_ITEMS) {
      const r = removeDismissals(current, body.phones);
      next = r.list; result = { removed: r.removed };
    } else {
      return NextResponse.json({ error: 'expected {action:"dismiss",items:[...]} or {action:"restore",phones:[...]}' }, { status: 400 });
    }
    const up = await db.from('settings').upsert(
      { key: LEAD_DISMISSALS_KEY, value: { items: next }, updated_at: new Date().toISOString() },
      { onConflict: 'key' },
    );
    if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
    return NextResponse.json({ ...result, total: next.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
