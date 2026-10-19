/**
 * GET /api/ops/direct-mail — DM1 postcard test scorecard. Internal, read-only. Auth: CRM session or office key.
 * Tracked = calls to (760) 823-8910 + forms with lead_source=direct_mail (scwellservice.com/checkup).
 * Matched by address = new Jobber clients since the mail date whose address was on the 2,500 list (reported separately).
 */
import { unstable_cache } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { authorizeOps } from '@/lib/ops-auth';
import { isExcludedCaller } from '@/lib/ads/real-leads';
import { dm1Config, dmSummary, DM1, mailedKeyCount } from '@/lib/direct-mail/campaign';
import { dm1Matchback } from '@/lib/direct-mail/matchback';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const d10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length === 10 ? d : null; };

export async function GET(request: NextRequest) {
  const auth = await authorizeOps(request);
  if (!auth.ok) return auth.response;
  const cfg = dm1Config();
  const startIso = new Date(Math.min(cfg.mailMs, Date.parse('2026-10-19T00:00:00-07:00'))).toISOString();
  try {
    const db = createServiceClient() as any;
    const [recs, forms] = await Promise.all([
      db.from('inbound_call_recordings').select('started_at, caller_number').eq('source', 'direct_mail').gte('started_at', startIso).limit(5000),
      db.from('booking_requests').select('id, created_at, phone, address').eq('lead_source', 'direct_mail').gte('created_at', startIso).limit(5000),
    ]);
    for (const r of [recs, forms]) if (r.error) throw new Error(r.error.message);
    const calls = (recs.data ?? []).filter((r: any) => !isExcludedCaller(r.caller_number));
    const formRows = (forms.data ?? []).filter((f: any) => !isExcludedCaller(f.phone));
    const first = new Map<string, number>();
    for (const x of [...calls.map((c: any) => ({ at: c.started_at, p: c.caller_number })), ...formRows.map((f: any) => ({ at: f.created_at, p: f.phone }))]) {
      const p = d10(x.p); if (!p) continue; const t = Date.parse(x.at);
      if (!first.has(p) || t < first.get(p)!) first.set(p, t);
    }
    let matchErr: string | null = null;
    const mb = await unstable_cache(() => dm1Matchback(cfg.mailMs), ['dm1-matchback-v1'], { revalidate: 1800 })()
      .catch((e: unknown) => { matchErr = e instanceof Error ? e.message : String(e); return { scanned: 0, matches: [] as any[] }; });
    // Jobber clients for tracked phones and matched addresses
    const phones = Array.from(first.keys());
    const clientFirst = new Map<string, number>();
    for (let i = 0; i < phones.length; i += 100) {
      const c = await db.from('jobber_clients').select('id, phones_digits').overlaps('phones_digits', phones.slice(i, i + 100));
      if (c.error) throw new Error(c.error.message);
      for (const r of c.data ?? []) {
        const t = Math.min(...(r.phones_digits ?? []).map((p: string) => first.get(p) ?? Infinity));
        if (Number.isFinite(t)) clientFirst.set(r.id, t);
      }
    }
    const trackedClients = new Set(clientFirst.keys());
    const matchedNotTracked = mb.matches.filter((m: any) => !trackedClients.has(m.id) && !m.phones.some((p: string) => first.has(p)));
    for (const m of mb.matches) if (!clientFirst.has(m.id)) clientFirst.set(m.id, Date.parse(m.createdAt));
    const ids = Array.from(clientFirst.keys());
    let booked = 0, bookedMatched = 0, invoiced = 0, invoicedMatched = 0;
    for (let i = 0; i < ids.length; i += 100) {
      const part = ids.slice(i, i + 100);
      const [jobs, invs] = await Promise.all([
        db.from('jobber_jobs').select('client_id, created_at, title').in('client_id', part),
        db.from('jobber_invoices').select('client_id, issued_date, data').in('client_id', part).not('issued_date', 'is', null),
      ]);
      if (jobs.error) throw new Error(jobs.error.message);
      if (invs.error) throw new Error(invs.error.message);
      for (const id of part) {
        const t0 = clientFirst.get(id)! - 3600_000;
        const isMatchOnly = !trackedClients.has(id);
        if ((jobs.data ?? []).some((j: any) => j.client_id === id && Date.parse(j.created_at) >= t0 && Date.parse(j.created_at) <= t0 + 90 * 86400_000)) { if (isMatchOnly) bookedMatched++; else booked++; }
        const sum = (invs.data ?? []).filter((v: any) => v.client_id === id && Date.parse(v.issued_date) >= t0).reduce((s: number, v: any) => s + (Number(v.data?.amounts?.subtotal) || 0), 0);
        if (isMatchOnly) invoicedMatched += sum; else invoiced += sum;
      }
    }
    const tracked = dmSummary({ calls: calls.length, callers: new Set(calls.map((c: any) => d10(c.caller_number)).filter(Boolean)).size, forms: formRows.length, booked, matched: mb.matches.length, matchedNotTracked: matchedNotTracked.length, invoiced: Math.round(invoiced * 100) / 100, pieces: cfg.pieces, spend: cfg.spend, spendIsPlaceholder: cfg.spendIsPlaceholder });
    const res = NextResponse.json({
      campaign: { ...DM1, ...cfg, listKeys: mailedKeyCount() },
      tracked,
      matchedByAddress: { scannedNewClients: mb.scanned, matched: mb.matches.length, notOtherwiseTracked: matchedNotTracked.length, booked: bookedMatched, invoiced: Math.round(invoicedMatched * 100) / 100, error: matchErr },
      combined: { booked: booked + bookedMatched, invoiced: Math.round((invoiced + invoicedMatched) * 100) / 100, roas: cfg.spend ? Math.round(((invoiced + invoicedMatched) / cfg.spend) * 100) / 100 : null },
    });
    res.headers.set('Cache-Control', 'no-store');
    res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    if (auth.setCookie) res.headers.append('Set-Cookie', auth.setCookie);
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}
