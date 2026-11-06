'use client';
import { useCallback, useEffect, useState } from 'react';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';
import type { MetricCard } from '@/lib/ads/metrics';

const KEY_STORAGE = 'quotes_gp_key';

const GROUPS: Array<{ title: string; hint: string; ids: string[] }> = [
  { title: 'Sales and revenue', hint: 'Lifetime value, repeat business, retention, and margin.', ids: ['ltv', 'repeat', 'nrr', 'margin'] },
  { title: 'Marketing / ads', hint: 'What a new customer costs from Google Ads, next to lifetime value.', ids: ['cac', 'ltv-cac'] },
  { title: 'Operations / jobs', hint: 'Crew time and first-visit outcomes.', ids: ['util', 'ftf'] },
  { title: 'Quotes', hint: 'How long a sent quote takes to close.', ids: ['cycle'] },
];

function ptStamp(iso: string | null) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function rowDot(label: string) {
  if (/drill/i.test(label)) return 'bg-amber-500';
  if (/pump/i.test(label)) return 'bg-sky-500';
  return null;
}

export default function MetricsPage() {
  const [cards, setCards] = useState<MetricCard[] | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [source, setSource] = useState<'mirror' | 'jobber' | null>(null);
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
      const j = await res.json(); setCards(j.cards); setAt(j.dataAsOf || j.generatedAt); setSource(j.source === 'mirror' ? 'mirror' : 'jobber'); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // A card with no value yet ("—") is hidden until its data exists; what it needs is listed below the grid.
  // A known block (timesheet permission) sets a real value so that card stays in the grid.
  const shown = (cards ?? []).filter((c) => c.value !== '—');
  const hidden = (cards ?? []).filter((c) => c.value === '—');

  const stamp = ptStamp(at);
  const placed = new Set(GROUPS.flatMap((g) => g.ids));
  const extra = shown.filter((c) => !placed.has(c.id));
  const cardView = (c: MetricCard) => (
    <section key={c.id} className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04),0_8px_24px_-12px_rgba(15,23,42,.1)]">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{c.title}</h3>
      {c.badge ? <p className="mt-0.5 text-[10px] font-medium text-emerald-700">{c.badge}</p> : null}
      <p className="mt-0.5 text-[11px] text-slate-400">{c.range}</p>
      <div title={c.hover} className={`mt-1 break-words font-semibold ${c.value === '—' || c.value === 'n/a' || /^[$\d]/.test(c.value) || c.value.includes(':1') || c.value === 'Same day' ? 'text-3xl tabular-nums' : 'text-xl leading-snug'} ${c.value === '—' ? 'text-slate-300' : 'text-slate-900'} ${c.hover ? 'cursor-help' : ''}`}><span className={c.hover ? 'underline decoration-slate-300 decoration-dotted underline-offset-4' : ''}>{c.value}</span></div>
      {c.sub ? <p className="mt-1 text-xs text-slate-500">{c.sub}</p> : null}
      {c.needs ? <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900"><b>Needs:</b> {c.needs.replace(/^needs\s*/i, '')}</p> : null}
      {c.rows?.length ? (
        <dl className="mt-3 divide-y divide-slate-100 text-sm">
          {c.rows.map((r) => {
            const dot = rowDot(r.label);
            return (
              <div key={r.label} title={r.hover} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="min-w-0 text-slate-600"><span className="inline-flex items-center gap-1.5">{dot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} /> : null}<span className="truncate" title={r.label}>{r.label}</span></span>{r.note ? <span className="block text-[11px] text-slate-400">{r.note}</span> : null}</dt>
                <dd className="shrink-0 text-right font-semibold tabular-nums">{r.value}</dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      <div className="mt-auto space-y-0.5 pt-3 text-[11px] leading-snug text-slate-500">
        <p><b className="text-slate-600">What:</b> {c.measures}</p>
        <p><b className="text-slate-600">Source:</b> {c.source}</p>
        <p><b className="text-slate-600">Dates:</b> {c.range}</p>
      </div>
    </section>
  );

  return (
    <div className="min-w-0 space-y-6 overflow-x-clip">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">Business metrics</h2>
          <p className="mt-0.5 text-sm text-slate-600">Full history and since Sep 18 · Pacific time</p>
          <p className="mt-2 inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600" data-freshness={source == null ? 'pending' : source === 'mirror' ? 'mirror' : 'live'}>
            <span className={`font-semibold ${source === 'mirror' ? 'text-sky-800' : source === 'jobber' ? 'text-amber-800' : 'text-slate-500'}`}>{source === 'mirror' ? 'Jobber mirror' : source === 'jobber' ? 'Live Jobber' : 'Jobber'}</span>
            <span className="text-slate-400">·</span>
            <span>{stamp ? (source === 'mirror' ? `last synced ${stamp} PT` : `as of ${stamp} PT`) : loading ? 'Loading… first load can take a minute' : 'sync time unavailable'}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={load} className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50">Refresh</button>
          <a href={`/ops/calls${key ? `?key=${encodeURIComponent(key)}` : ''}`} className="inline-flex min-h-11 items-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white shadow-sm hover:bg-slate-700">Today</a>
        </div>
      </div>
      {error ? <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div> : null}
      {!cards && loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading metrics">
          <p className="text-sm text-slate-500">Pulling Jobber history…</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>
        </div>
      ) : null}
      {!cards && error ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">No metrics yet. Tap Refresh to try again.</div> : null}
      {GROUPS.map((group) => {
        const list = group.ids.map((id) => shown.find((c) => c.id === id)).filter((c): c is MetricCard => !!c);
        if (!list.length) return null;
        return (
          <section key={group.title} className="space-y-3">
            <div className="border-b border-slate-200/80 pb-2">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">{group.title}</h3>
              <p className="text-sm text-slate-500">{group.hint}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{list.map(cardView)}</div>
          </section>
        );
      })}
      {extra.length ? (
        <section className="space-y-3">
          <h3 className="border-b border-slate-200/80 pb-2 text-lg font-semibold tracking-tight text-slate-900">More</h3>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{extra.map(cardView)}</div>
        </section>
      ) : null}
      {hidden.length ? (
        <section className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500" data-hidden-metrics={hidden.length}>
          <p className="font-medium text-slate-600">No value yet ({hidden.length})</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{hidden.map((c) => <li key={c.id}><b className="text-slate-600">{c.title}:</b> — · {c.needs ? c.needs.replace(/^needs\s*/i, 'needs ') : 'no data yet'}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
