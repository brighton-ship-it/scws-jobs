/**
 * POST /api/ops/phone-calls/reformat?limit=25 — re-format stored transcripts in place:
 * speaker-labeled turns (SCWS / Caller) + summary box lines. Words are kept (see labelTurns guard).
 * Ops auth. Idempotent: rows that already have turns and a "Who:" box are skipped.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { labelTurns, summaryCard, composeSummary, hasSpeakerTurns } from '@/lib/phone-calls/process';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 10), 25);
  const db = createServiceClient() as any;
  const { data, error } = await db.from('inbound_call_recordings').select('call_sid, transcript, summary')
    .eq('processing_status', 'done').not('transcript', 'is', null).order('started_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const todo = (data ?? []).filter((r: any) => (r.transcript || '').trim().length > 20 && (!hasSpeakerTurns(r.transcript) || !/\n(Who|Address|Issue|Next step|Booked):/.test(r.summary || ''))).slice(0, limit);
  const done: string[] = [];
  const started = Date.now();
  for (const r of todo) {
    if (Date.now() - started > 45_000) break;
    const transcript = await labelTurns(r.transcript).catch(() => r.transcript);
    const summary = /\n(Who|Address|Issue|Next step|Booked):/.test(r.summary || '') ? r.summary : composeSummary(r.summary || '', await summaryCard(transcript).catch(() => null));
    const up = await db.from('inbound_call_recordings').update({ transcript, summary, updated_at: new Date().toISOString() }).eq('call_sid', r.call_sid);
    if (!up.error) done.push(r.call_sid);
  }
  const remaining = (data ?? []).filter((r: any) => (r.transcript || '').trim().length > 20).length - done.length;
  return NextResponse.json({ updated: done.length, candidates: todo.length, remainingApprox: remaining });
}
