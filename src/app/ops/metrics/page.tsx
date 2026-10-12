'use client';
import { useCallback, useEffect, useState } from 'react';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';
import type { MetricCard } from '@/lib/ads/metrics';

const KEY_STORAGE = 'quotes_gp_key';

export default function MetricsPage() {
  const [cards, setCards] = useState<MetricCard[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [key, setKey] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URL(window.location.href).searchParams.get(QUOTES_GP_KEY_QUERY);
      if (q) { try { localStorage.setItem(KEY_STORAGE, q); } catch {} }
      let k = q; try { k = k || localStorage.getItem(KEY_STORAGE); } catch {}
      setKey(k);
      let res: Response | null = null;
      for (let i = 0; i < 3; i++) {
        try { res = await fetch('/api/ops/metrics', { headers: k ? { [QUOTES_GP_KEY_HEADER]: k } : {}, cache: 'no-store', signal: AbortSignal.timeout(290_000) }); }
        catch { res = null; }
        if (res && (res.ok || res.status === 401)) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!res) throw new Error('Jobber is slow right now. Tap Refresh to try again.');
      if (!res.ok) throw new Error(res.status === 401 ? 'Not signed in. Log in to the CRM or open this page with your office key.' : `Error ${res.status}`);
      const j = await res.json(); setCards(j.cards); setAt(j.generatedAt); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <main className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">Business metrics</h2>
          <p className="text-xs text-slate-500">{at ? `Updated ${new Date(at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} PT` : loading ? 'Loading… (first load can take a minute)' : ''}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">Refresh</button>
          <a href={`/ops/calls${key ? `?key=${encodeURIComponent(key)}` : ''}`} className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white shadow-sm hover:bg-slate-700">← Calls</a>
        </div>
      </div>
      {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
      {!cards && loading ? <p className="text-sm text-slate-500">Pulling Jobber history…</p> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(cards ?? []).map((c) => (
          <section key={c.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.title}</h3>
            <div className={`mt-1 text-3xl font-bold ${c.value === '—' ? 'text-slate-300' : 'text-slate-900'}`}>{c.value}</div>
            {c.sub ? <p className="text-xs text-slate-500">{c.sub}</p> : null}
            {c.needs ? <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900"><b>Needs:</b> {c.needs.replace(/^needs\s*/i, '')}</p> : null}
            {c.rows?.length ? (
              <dl className="mt-3 divide-y divide-slate-100 text-sm">
                {c.rows.map((r) => (
                  <div key={r.label} className="flex items-baseline justify-between gap-3 py-1.5">
                    <dt className="min-w-0 text-slate-600">{r.label}{r.note ? <span className="block text-[11px] text-slate-400">{r.note}</span> : null}</dt>
                    <dd className="shrink-0 font-semibold tabular-nums">{r.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <div className="mt-auto space-y-0.5 pt-3 text-[11px] leading-snug text-slate-500">
              <p><b className="text-slate-600">What:</b> {c.measures}</p>
              <p><b className="text-slate-600">Source:</b> {c.source}</p>
              <p><b className="text-slate-600">Dates:</b> {c.range}</p>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
