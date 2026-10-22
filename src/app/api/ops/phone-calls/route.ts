/** GET /api/ops/phone-calls — latest recorded inbound calls with transcript + summary. Same auth as call-dashboard. */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { isTestCallerPhone } from '@/lib/ads/real-leads';

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
      .select('call_sid, started_at, caller_number, source, dial_status, answered, duration_seconds, processing_status, transcript, summary, outcome, caller_name, needs_followup, jobber_client_id, processing_error')
      .order('started_at', { ascending: false }).limit(25);
    // (test traffic filtered below unless ?tests=1)
    if (error) return finish(NextResponse.json({ calls: [], note: error.message }));
    const url = new URL(request.url);
    const tests = url.searchParams.get('tests') === '1';
    const focus = url.searchParams.get('call');
    const isTest = (r: any) => r.source === 'test' || r.caller_number === '+18773863995' || isTestCallerPhone(r.caller_number);
    let calls = (data ?? []).filter((r: any) => tests || !isTest(r));
    // The missed-call email links here. Include that row even when it is a test call or older than the latest 25.
    if (focus && !calls.some((r: any) => r.call_sid === focus)) {
      const one = await db.from('inbound_call_recordings')
        .select('call_sid, started_at, caller_number, source, dial_status, answered, duration_seconds, processing_status, transcript, summary, outcome, caller_name, needs_followup, jobber_client_id, processing_error')
        .eq('call_sid', focus).maybeSingle();
      if (one.data) calls = [one.data, ...calls];
    }
    return finish(NextResponse.json({ calls }));
  } catch {
    return finish(NextResponse.json({ error: 'Failed to load' }, { status: 500 }));
  }
}
