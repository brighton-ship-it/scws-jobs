import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { fetchVoiceActivityPayload, voiceLogConfig } from '@/lib/ads/voice-log';
import { enrichPhoneLog, parsePhoneCallLog, type Party } from '@/lib/ads/phone-call-log';
import { findExistingClient, searchClients } from '@/lib/jobber/quotes';
import { normalizePhone } from '@/lib/ads/book-job';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Sync the inbound call log (metadata only) from the Voice audit log. Query: ?days=3 (1 to 30). */
export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const started = Date.now();
  try {
    const voice = voiceLogConfig();
    if (!voice) return NextResponse.json({ success: true, skipped: 'voice_log_not_configured' });
    const days = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 3));
    const start = new Date(Date.now() - days * 86400_000).toISOString();
    const parsed = parsePhoneCallLog(await fetchVoiceActivityPayload(voice, fetch, start));

    const db = createServiceClient() as any;
    const [customers, ads, mike, existing] = await Promise.all([
      db.from('customers').select('id, name, phone').not('phone', 'is', null).limit(5000),
      db.from('ads_calls').select('caller_phone, started_at, campaign_name, keyword, call_view_resource, customer_id, jobber_client_id').gte('started_at', start).limit(5000),
      db.from('receptionist_calls').select('vapi_call_id, phone, called_at').gte('called_at', start).limit(5000),
      db.from('phone_call_log').select('voice_call_key, customer_id, jobber_client_id, client_name').gte('started_at', start).limit(5000),
    ]);
    if (existing.error) {
      return NextResponse.json({ error: `phone_call_log unavailable: ${existing.error.message}` }, { status: 500 });
    }
    const known = new Map<string, { customer_id: string | null; jobber_client_id: string | null; client_name: string | null }>(
      (existing.data ?? []).map((r: any) => [r.voice_call_key, r])
    );
    const parties: Party[] = [
      ...(customers.data ?? []).map((c: any) => ({ phone: c.phone, customer_id: String(c.id), jobber_client_id: null, name: c.name ?? null })),
      ...(ads.data ?? []).filter((a: any) => a.customer_id || a.jobber_client_id)
        .map((a: any) => ({ phone: a.caller_phone, customer_id: a.customer_id ?? null, jobber_client_id: a.jobber_client_id ?? null, name: null })),
    ];
    let rows = enrichPhoneLog(parsed, ads.data ?? [], mike.data ?? [], parties);

    // Jobber lookup for new, unmatched callers only (capped)
    let lookups = 0;
    const cache = new Map<string, { id: string; name: string | null } | null>();
    for (const r of rows) {
      if (r.customer_id || r.jobber_client_id || known.has(r.voice_call_key)) continue;
      const n = normalizePhone(r.caller_phone);
      if (!n) continue;
      if (!cache.has(n)) {
        if (lookups >= 15) continue;
        lookups += 1;
        try {
          const found = findExistingClient(await searchClients(n), { phone: n });
          cache.set(n, found ? { id: found.id, name: found.name ?? null } : null);
        } catch {
          cache.set(n, null);
        }
      }
      const hit = cache.get(n);
      if (hit) { r.jobber_client_id = hit.id; r.client_name = r.client_name ?? hit.name; }
    }
    rows = rows.map((r) => {
      const prev = known.get(r.voice_call_key);
      return prev ? { ...r, customer_id: r.customer_id ?? prev.customer_id, jobber_client_id: r.jobber_client_id ?? prev.jobber_client_id, client_name: r.client_name ?? prev.client_name } : r;
    });

    const payload = rows.map((r) => ({ ...r, synced_at: new Date().toISOString() }));
    for (let i = 0; i < payload.length; i += 200) {
      const { error } = await db.from('phone_call_log').upsert(payload.slice(i, i + 200), { onConflict: 'voice_call_key' });
      if (error) throw new Error(error.message);
    }
    const count = (o: string) => rows.filter((r) => r.outcome === o).length;
    return NextResponse.json({
      success: true, days, calls: rows.length, newRows: rows.filter((r) => !known.has(r.voice_call_key)).length,
      answered: count('answered'), missed: count('missed'), forwarded_ai: count('forwarded_ai'), answered_unknown: count('answered_unknown'),
      withClient: rows.filter((r) => r.customer_id || r.jobber_client_id).length,
      withAdSource: rows.filter((r) => r.campaign_name).length,
      linkedToMike: rows.filter((r) => r.receptionist_call_id).length,
      jobberLookups: lookups, duration_ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    console.error('[phone_call_log] Cron failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
