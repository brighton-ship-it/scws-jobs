/** GET /api/ops/phone-calls — latest recorded inbound calls with transcript + summary. Same auth as call-dashboard. */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;
  const finish = (res: NextResponse) => {
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (auth.setCookie) res.headers.append('Set-Cookie', auth.setCookie);
    return res;
  };
  try {
    const db = createServiceClient() as any;
    const { data, error } = await db.from('inbound_call_recordings')
      .select('call_sid, started_at, caller_number, source, dial_status, answered, duration_seconds, processing_status, transcript, summary, outcome, caller_name, needs_followup, jobber_client_id')
      .order('started_at', { ascending: false }).limit(25);
    if (error) return finish(NextResponse.json({ calls: [], note: error.message }));
    return finish(NextResponse.json({ calls: data ?? [] }));
  } catch {
    return finish(NextResponse.json({ error: 'Failed to load' }, { status: 500 }));
  }
}
