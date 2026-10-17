/**
 * POST /api/ops/cleanup-test-rows — ONE-OFF (10/17/2026) removal of test call rows. Ops auth (office key).
 * Dry run by default; ?confirm=delete actually deletes. Hard-coded allowlist in lib/ops/test-row-cleanup.
 * Returns the full rows it matched/deleted so they can be archived. Expires 2026-10-18 00:00 PT.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import {
  RECORDING_SID_PREFIX, RECORDINGS_SINCE_ISO, PHANTOM_RECEPTIONIST_CALL_ID, PHANTOM_TASK_ID,
  cleanupExpired, isAllowedRecording, isAllowedReceptionistCall, isAllowedTask,
} from '@/lib/ops/test-row-cleanup';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;
  if (cleanupExpired()) return NextResponse.json({ error: 'expired' }, { status: 410 });
  const apply = request.nextUrl.searchParams.get('confirm') === 'delete';
  const db: any = createServiceClient();

  const recQ = await db.from('inbound_call_recordings').select('*')
    .like('call_sid', `${RECORDING_SID_PREFIX}%`).gte('started_at', RECORDINGS_SINCE_ISO);
  if (recQ.error) return NextResponse.json({ error: `recordings: ${recQ.error.message}` }, { status: 500 });
  const recordings = (recQ.data ?? []).filter(isAllowedRecording);

  const rcQ = await db.from('receptionist_calls').select('*').eq('id', PHANTOM_RECEPTIONIST_CALL_ID);
  if (rcQ.error) return NextResponse.json({ error: `receptionist_calls: ${rcQ.error.message}` }, { status: 500 });
  const receptionist = (rcQ.data ?? []).filter(isAllowedReceptionistCall);

  const tQ = await db.from('tasks').select('*').eq('id', PHANTOM_TASK_ID);
  if (tQ.error) return NextResponse.json({ error: `tasks: ${tQ.error.message}` }, { status: 500 });
  const tasks = (tQ.data ?? []).filter(isAllowedTask);

  const deleted = { recordings: 0, receptionist_calls: 0, tasks: 0 };
  const errors: string[] = [];
  if (apply) {
    for (const r of recordings) {
      const d = await db.from('inbound_call_recordings').delete().eq('call_sid', r.call_sid).like('call_sid', `${RECORDING_SID_PREFIX}%`).gte('started_at', RECORDINGS_SINCE_ISO).select('call_sid');
      if (d.error) errors.push(`rec ${r.call_sid}: ${d.error.message}`); else deleted.recordings += (d.data ?? []).length;
    }
    if (receptionist.length) {
      const d = await db.from('receptionist_calls').delete().eq('id', PHANTOM_RECEPTIONIST_CALL_ID).gte('called_at', RECORDINGS_SINCE_ISO).select('id');
      if (d.error) errors.push(`receptionist_calls: ${d.error.message}`); else deleted.receptionist_calls = (d.data ?? []).length;
    }
    if (tasks.length) {
      const d = await db.from('tasks').delete().eq('id', PHANTOM_TASK_ID).select('id');
      if (d.error) errors.push(`tasks: ${d.error.message}`); else deleted.tasks = (d.data ?? []).length;
    }
  }
  return NextResponse.json({ applied: apply, matched: { recordings, receptionist_calls: receptionist, tasks }, deleted, errors });
}
