'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneCallTranscripts } from './PhoneCallTranscripts';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';
import type { Dashboard, GroupRow } from '@/lib/ads/call-dashboard';
import {
  CallsPerDayChart, Funnel, Gauge, Sparkline, SpendRevenueChart, WeeklyBars, WeeklyCashBars, compactUsd, mult, palette, usd,
} from './call-dash/charts';

const KEY_STORAGE = 'quotes_gp_key';
const RANGES = [
  { v: '7', label: '7 days' }, { v: '30', label: '30 days' }, { v: '90', label: '90 days' }, { v: 'since', label: 'Since Sep 18' }, { v: 'month', label: 'This month' },
] as const;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const hm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }) : '—');
const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—';

type Live = { generatedAt?: string; jobberDataAsOf?: string | null };

function useDashboard(range: string, refreshMs: number | null) {
  // One cached payload per period. A response only ever lands in its own period's slot, and the page shows
  // the selected period's payload only, so switching the toggle never shows the other period's numbers.
  const [byRange, setByRange] = useState<Record<string, Dashboard>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const current = useRef(range);
  current.current = range;
  const inFlight = useRef<Record<string, boolean>>({});
  const load = useCallback(async () => {
    const r = range;
    if (inFlight.current[r]) return; // never stack requests (keeps Jobber load flat while a cold load runs)
    inFlight.current[r] = true;
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get(QUOTES_GP_KEY_QUERY);
      if (q) { try { localStorage.setItem(KEY_STORAGE, q); } catch {} }
      let key = q; try { key = key || localStorage.getItem(KEY_STORAGE); } catch {}
      const res = await fetch(`/api/ops/call-dashboard?range=${r}`, {
        headers: key ? { [QUOTES_GP_KEY_HEADER]: key } : {}, cache: 'no-store',
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Not signed in. Log in to the CRM or open this page with your office key.' : `Error ${res.status}`);
      const json = await res.json();
      setByRange((m) => ({ ...m, [r]: json }));
      if (current.current === r) setError(null);
    } catch (e) { if (current.current === r) setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { inFlight.current[r] = false; if (current.current === r) setLoading(false); }
  }, [range]);
  useEffect(() => {
    setLoading(true); setError(null);
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data: byRange[range] ?? null, error, loading, reload: load };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const STYLES = `
@keyframes cd-pulse{0%{box-shadow:0 0 0 0 rgba(16,185,129,.55)}70%{box-shadow:0 0 0 8px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
@keyframes cd-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes cd-grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes cd-draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes cd-shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}
.cd-live{animation:cd-pulse 2s infinite}
.cd-rise{animation:cd-rise .45s ease-out both}
.cd-bar rect{transform-box:fill-box;transform-origin:bottom;animation:cd-grow .5s ease-out both}
.cd-line{stroke-dasharray:1;stroke-dashoffset:0;animation:cd-draw .9s ease-out both}
.cd-gauge{transition:stroke .4s}
.cd-skel{background:linear-gradient(90deg,#e2e8f0 0,#f1f5f9 100px,#e2e8f0 200px);background-size:400px 100%;animation:cd-shimmer 1.4s linear infinite;border-radius:8px}
.cd-skel-dark{background:linear-gradient(90deg,#1e293b 0,#334155 100px,#1e293b 200px);background-size:400px 100%;animation:cd-shimmer 1.4s linear infinite;border-radius:12px}
@media (max-width:1023px){.cd-big{font-size:clamp(1.9rem,8.5vw,2.75rem)}}
@media (min-width:1024px){.cd-big{font-size:clamp(1.75rem,3vw,4rem)}}
.cd-big{white-space:nowrap}
@media (prefers-reduced-motion:reduce){.cd-live,.cd-rise,.cd-bar rect,.cd-line,.cd-skel,.cd-skel-dark{animation:none!important}}
`;

function LiveBadge({ at, refreshMs, error, dark = false }: { at?: string; refreshMs: number; error: string | null; dark?: boolean }) {
  const now = useNow(1000);
  const age = at ? Math.max(0, Math.round((now - Date.parse(at)) / 1000)) : null;
  const stale = !!error || (age != null && age * 1000 > refreshMs * 2.5);
  const dot = error ? 'bg-rose-500' : stale ? 'bg-amber-500' : 'bg-emerald-500 cd-live';
  const text = dark ? 'text-slate-300' : 'text-slate-600';
  return (
    <div className={`inline-flex max-w-full shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1 text-xs xl:px-5 xl:py-2 xl:text-xl font-medium tabular-nums ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'} ${text}`} role="status">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <span className="font-semibold">{error ? 'Offline' : stale ? 'Delayed' : 'Live'}</span>
      <span className={`truncate ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{at ? `Updated ${clock(at)} PT${age != null ? ` · ${age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`} ago` : ''}` : 'Connecting…'}</span>
    </div>
  );
}

function Delta({ cur, prev, goodWhenUp = true, dark = false }: { cur: number | null; prev: number | null | undefined; goodWhenUp?: boolean; dark?: boolean }) {
  if (cur == null || prev == null) return <span className="text-xs text-slate-400">no prior period</span>;
  if (prev === 0) return <span className="text-xs text-slate-400">{cur === 0 ? 'flat vs prior' : 'new vs prior'}</span>;
  const pct = ((cur - prev) / prev) * 100;
  const up = pct > 0.5, down = pct < -0.5;
  const good = (up && goodWhenUp) || (down && !goodWhenUp);
  const bad = (up && !goodWhenUp) || (down && goodWhenUp);
  const cls = good ? (dark ? 'bg-emerald-500/15 text-emerald-300' : 'bg-emerald-50 text-emerald-700') : bad ? (dark ? 'bg-rose-500/15 text-rose-300' : 'bg-rose-50 text-rose-700') : (dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600');
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-nums ${cls}`}>{up ? '▲' : down ? '▼' : '■'} {Math.abs(pct).toFixed(0)}%</span>
      <span className="text-slate-400">vs prior</span>
    </span>
  );
}

function Card({ title, subtitle, right, children, className = '', delay = 0 }: { title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode; className?: string; delay?: number }) {
  return (
    <section className={`cd-rise min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_4px_16px_-8px_rgba(15,23,42,.08)] ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-5 pb-1 pt-4">
        <div><h2 className="text-sm font-semibold text-slate-900">{title}</h2>{subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}</div>
        {right}
      </header>
      <div className="px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">{items.map(([c, l]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: c }} />{l}</span>)}</div>;
}

function Kpi({ label, range, hint, value, sub, spark, color, delta, delay }: { label: string; range?: string; hint?: string; value: string; sub?: string; spark?: number[]; color: string; delta?: React.ReactNode; delay: number }) {
  return (
    <div className="cd-rise flex min-h-[148px] flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04),0_4px_16px_-8px_rgba(15,23,42,.08)]" style={{ animationDelay: `${delay}ms` }} title={hint}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}{hint ? <span className="ml-1 cursor-help normal-case text-slate-400" aria-label={hint}>ⓘ</span> : null}</p>
      {range ? <p className="text-[10px] font-medium text-slate-400">{range}</p> : null}
      <p className="mt-1 text-[1.75rem] font-bold leading-tight tracking-tight tabular-nums text-slate-900">{value}</p>
      <div className="mt-1 min-h-[20px]">{delta}</div>
      <p className="mt-0.5 min-h-[16px] text-xs leading-snug text-slate-500">{sub}</p>
      <div className="mt-auto pt-2">{spark ? <Sparkline values={spark} color={color} /> : <div className="h-9" />}</div>
    </div>
  );
}

/** Tiny, unobtrusive daily-spend line under a spend figure. */
const ptKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

function MiniSpark({ values, color, title }: { values?: number[]; color: string; title?: string }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1), w = 100, h = 16;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - (v / max) * (h - 2)).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-1 block h-3.5 w-full max-w-[110px] opacity-70" aria-hidden role="img">
      <title>{title}</title>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function Badge({ outcome }: { outcome: string }) {
  const o = outcome.toLowerCase();
  const [cls, dot] = o.startsWith('booked') ? ['bg-emerald-50 text-emerald-700 ring-emerald-200', 'bg-emerald-500']
    : o.includes('booking request') ? ['bg-sky-50 text-sky-700 ring-sky-200', 'bg-sky-500']
    : o.includes('short') || o.includes('missed') ? ['bg-rose-50 text-rose-700 ring-rose-200', 'bg-rose-500']
    : o.includes('existing') ? ['bg-violet-50 text-violet-700 ring-violet-200', 'bg-violet-500']
    : ['bg-slate-50 text-slate-700 ring-slate-200', 'bg-slate-400'];
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{outcome}</span>;
}


type FeedRow = NonNullable<Dashboard['callFeed']>[number];
const fmtDur = (s: number | null) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`);
const ptDay = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const feedTime = (iso: string) => { const d = new Date(iso); const t = d.toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }); return ptDay(d) === ptDay(new Date()) ? t : `${d.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric' })}, ${t}`; };
// Google Voice answerer (email local part) -> staff first name. Unknown answerers show their recorded id, never a guess.
const STAFF_BY_ANSWERER: Record<string, string> = { lizbeth: 'Liz', liz: 'Liz', shanicey: 'Shanicey', brighton: 'Brighton' };
const answererName = (a: string | null | undefined) => { if (!a) return null; const k = a.toLowerCase(); return STAFF_BY_ANSWERER[k] ?? a.charAt(0).toUpperCase() + a.slice(1); };
function OutcomePill({ o, by, dark = false }: { o: string; by?: string | null; dark?: boolean }) {
  const who = o === 'Answered' ? answererName(by) : null;
  const c = o === 'Booked' ? (dark ? 'bg-emerald-500 text-emerald-950' : 'bg-emerald-600 text-white')
    : o === 'Missed' ? (dark ? 'bg-rose-500 text-white' : 'bg-rose-600 text-white')
    : o === 'Voicemail' ? (dark ? 'bg-amber-400 text-amber-950' : 'bg-amber-500 text-white')
    : o.startsWith('Mike') ? (dark ? 'bg-sky-400 text-sky-950' : 'bg-sky-600 text-white')
    : (dark ? 'bg-slate-200 text-slate-900' : 'bg-slate-700 text-white');
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 font-semibold ${c}`}>{who ? `${o} · ${who}` : o}</span>;
}
function MikeLine({ text, dark }: { text: string; dark: boolean }) {
  const booked = text.includes('booked') || text.includes('reached');
  const cls = booked ? (dark ? 'text-sky-300' : 'text-sky-800') : (dark ? 'text-sky-200' : 'text-sky-900');
  return <div className={`mt-1 break-words text-xs font-medium leading-snug xl:text-sm ${cls}`}>{text}</div>;
}
function CallbackLine({ text, dark }: { text: string; dark: boolean }) {
  const called = text.startsWith('Called back');
  const cls = called ? (dark ? 'text-emerald-300' : 'text-emerald-700') : (dark ? 'text-amber-300' : 'text-amber-800');
  return <div className={`mt-1 break-words text-xs font-medium leading-snug xl:text-sm ${cls}`}>{text}</div>;
}
const OUTREACH_TIP = 'Counts outbound calls from shop Google Voice lines (Liz, Shanicey, Brighton) and Mike\'s automated callbacks. Personal cell calls are not in this log, so a callback from a cell does not show here.';
const COLD_TIP = 'Going cold: 3 or more Voice attempts with no connected call or booking, or no attempt in the last 3 days.';
function OutreachLine({ text, cold, dark }: { text: string; cold?: boolean; dark: boolean }) {
  return (
    <div className={`mt-1 break-words text-xs leading-snug xl:text-sm ${dark ? 'text-slate-300' : 'text-slate-600'}`} title={OUTREACH_TIP}>
      <span>{text}</span>
      {cold ? <span className="ml-1.5 inline-block rounded-full bg-rose-600 px-2 py-0.5 align-middle text-[10px] font-semibold text-white" title={COLD_TIP}>Going cold</span> : null}
    </div>
  );
}

function NeedsCallbackList({ view, rangeLabel, dark = false, empty, metric = 'leads' }: { view: Dashboard['needsCallback']; rangeLabel: string; dark?: boolean; empty: string; metric?: 'leads' | 'invoices' }) {
  const count = view?.count ?? 0;
  const rows = view?.rows ?? [];
  const ink = dark ? 'text-white' : 'text-slate-900';
  const sub = dark ? 'text-slate-300' : 'text-slate-600';
  const rule = dark ? 'divide-slate-800' : 'divide-slate-200';
  const countAttr = metric === 'invoices' ? 'data-invoice-follow-up-count' : 'data-needs-callback-count';
  const owed = metric === 'invoices' ? view?.totalOwed : null;
  return (
    <div>
      <p className={`text-3xl font-bold tabular-nums xl:text-5xl ${ink}`} {...{ [countAttr]: view ? count : undefined }}>{view ? String(count) : '—'}</p>
      {metric === 'invoices' ? <p className={`mt-0.5 text-sm font-semibold tabular-nums ${dark ? 'text-amber-300' : 'text-amber-800'}`}>{owed == null ? 'Total open —' : `Total open ${usd(owed, Number.isInteger(owed) ? 0 : 2)}`}</p> : null}
      <p className={`mt-0.5 text-xs ${sub}`}>{rangeLabel}</p>
      {rows.length === 0 ? <p className={`mt-3 text-sm ${sub}`}>{view ? empty : ' '}</p> : (
        <ul className={`mt-3 max-h-[600px] touch-pan-y divide-y overflow-y-auto overscroll-y-contain ${rule}`}>
          {rows.map((r, i) => (
            <li key={`${r.at}-${r.phone}-${r.invoiceNumber ?? ''}-${i}`} className="py-2.5 pr-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={`break-words font-semibold ${ink}`}>{r.name || <a href={`tel:${r.phone}`}>{r.phone}</a>}</div>
                  <div className={`break-words text-sm ${sub}`}>{r.name ? <><a href={`tel:${r.phone}`}>{r.phone}</a> · </> : null}{metric === 'invoices' ? (r.invoiceNumber ? `Invoice #${r.invoiceNumber}` : 'Invoice # unavailable') : r.line} · {r.outcome}</div>
                  {r.balance != null && r.balance > 0 ? <div className={`mt-1 text-xs font-semibold tabular-nums ${dark ? 'text-amber-300' : 'text-amber-800'}`}>Owes {usd(r.balance, Number.isInteger(r.balance) ? 0 : 2)}</div> : null}
                  {metric === 'invoices' ? <div className={`mt-1 text-xs ${sub}`}>{r.daysPastDue == null ? 'Days past due unavailable' : r.daysPastDue === 0 ? 'Not past due' : `${r.daysPastDue} ${r.daysPastDue === 1 ? 'day' : 'days'} past due`}</div> : null}
                  {r.calledAfter ? <div className={`mt-1 text-xs font-medium ${dark ? 'text-sky-300' : 'text-sky-800'}`}>{r.calledAfter}</div> : null}
                  {r.mike ? <MikeLine text={r.mike} dark={dark} /> : null}
                  {r.outreach ? <OutreachLine text={r.outreach} cold={r.goingCold} dark={dark} /> : null}
                </div>
                <span className={`shrink-0 text-sm tabular-nums ${sub}`}>{feedTime(r.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CallFeedTable({ rows, dark = false, max }: { rows: FeedRow[]; dark?: boolean; max?: number }) {
  const list = max ? rows.slice(0, max) : rows;
  const head = dark ? 'text-slate-400' : 'text-slate-500';
  const ink = dark ? 'text-white' : 'text-slate-900';
  const sub = dark ? 'text-slate-300' : 'text-slate-600';
  return (
    <>
    <ul className={`min-[769px]:hidden ${dark ? 'divide-y divide-slate-800' : 'divide-y divide-slate-200'}`}>
      {list.length === 0 ? <li className={`px-4 py-6 text-center ${sub}`}>No calls yet</li> : list.map((r, i) => (
        <li key={i} className={`px-4 py-3 ${r.outcome === 'Missed' ? (dark ? 'bg-rose-950/40' : 'bg-rose-50') : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <span className={`whitespace-nowrap text-sm tabular-nums ${sub}`}>{feedTime(r.at)} · {fmtDur(r.durationSeconds)}</span>
            <span className="shrink-0 text-sm"><OutcomePill o={r.outcome} by={r.answeredBy} dark={dark} /></span>
          </div>
          <div className={`mt-1 break-words text-base font-semibold ${ink}`}>{r.name || <a href={`tel:${r.phone}`}>{r.phone}</a>}</div>
          <div className={`break-words text-sm ${sub}`}>{r.name ? <a href={`tel:${r.phone}`}>{r.phone}</a> : null}{r.name ? ' · ' : ''}{r.line}</div>
          {r.summary ? <div className={`mt-1 text-sm ${sub}`}>{r.summary}</div> : null}
          {r.callback ? <CallbackLine text={r.callback} dark={dark} /> : null}
          {r.mike ? <MikeLine text={r.mike} dark={dark} /> : null}
          {r.outreach ? <OutreachLine text={r.outreach} cold={r.goingCold} dark={dark} /> : null}
        </li>
      ))}
    </ul>
    <table className={`hidden w-full table-fixed text-left min-[769px]:table ${dark ? 'text-base xl:text-xl' : 'text-[15px]'}`}>
      <colgroup><col className="w-[19%]" /><col className="w-[28%]" /><col className="w-[14%]" /><col className="w-[26%]" /><col className="w-[13%]" /></colgroup>
      <thead><tr className={`text-xs font-semibold uppercase tracking-wider ${head} ${dark ? 'xl:text-sm' : ''}`}><th className="px-3 py-2">Time</th><th className="px-3 py-2">Caller</th><th className="px-3 py-2">Line</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2 text-right">Duration</th></tr></thead>
      <tbody className={dark ? 'divide-y divide-slate-800' : 'divide-y divide-slate-200'}>
        {list.length === 0 ? <tr><td colSpan={5} className={`px-3 py-6 text-center ${sub}`}>No calls yet</td></tr> : list.map((r, i) => (
          <tr key={i} className={r.outcome === 'Missed' ? (dark ? 'bg-rose-950/40' : 'bg-rose-50') : ''}>
            <td className={`whitespace-nowrap px-3 py-2 align-top tabular-nums ${sub}`}>{feedTime(r.at)}</td>
            <td className="px-3 py-2 align-top">
              <div className={`truncate font-semibold ${ink}`}>{r.name || <a href={`tel:${r.phone}`}>{r.phone}</a>}</div>
              {r.name ? <div className={`truncate text-sm ${sub}`}>{r.phone}</div> : null}
              {r.summary ? <div className={`truncate text-sm ${sub}`} title={r.summary}>{r.summary}</div> : null}
            </td>
            <td className={`truncate px-3 py-2 align-top font-medium ${ink}`}>{r.line}</td>
            <td className="px-3 py-2 align-top text-sm"><OutcomePill o={r.outcome} by={r.answeredBy} dark={dark} />{r.callback ? <CallbackLine text={r.callback} dark={dark} /> : null}{r.mike ? <MikeLine text={r.mike} dark={dark} /> : null}{r.outreach ? <OutreachLine text={r.outreach} cold={r.goingCold} dark={dark} /> : null}</td>
            <td className={`whitespace-nowrap px-3 py-2 text-right align-top tabular-nums ${ink}`}>{fmtDur(r.durationSeconds)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </>
  );
}

const th = 'sticky top-0 z-10 bg-slate-50/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur';

function GroupTable({ title, rows, delay }: { title: string; rows: GroupRow[]; delay: number }) {
  const maxCalls = Math.max(...rows.map((r) => r.calls), 1);
  return (
    <section className="cd-rise overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)]" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="px-5 pb-2 pt-4 text-sm font-semibold text-slate-900">{title}</h2>
      <div className="max-h-[340px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead><tr><th className={th}>Name</th><th className={`${th} text-right`}>Calls</th><th className={`${th} text-right`}>New booked</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={3} className="px-5 py-8 text-center text-sm text-slate-400">No calls in this range</td></tr> : rows.slice(0, 15).map((r) => (
              <tr key={r.key} className="transition-colors hover:bg-slate-50/80">
                <td className="max-w-[9rem] px-3 py-2 xl:max-w-[11rem]"><div className="truncate font-medium text-slate-800" title={r.key}>{r.key}</div>
                  <div className="mt-1 h-1 w-full rounded bg-slate-100"><div className="h-1 rounded" style={{ width: `${(r.calls / maxCalls) * 100}%`, background: palette.revenue, opacity: 0.7 }} /></div></td>
                <td className="px-3 py-2 text-right tabular-nums" title={`${r.answered} answered · ${r.short} short · ${usd(r.costPerCall, 2)}/call`}>{r.calls}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.booked ? <span className="font-semibold text-emerald-700">{r.booked}</span> : <span className="text-slate-300">0</span>}</td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="cd-skel h-[148px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><div className="cd-skel h-72" /><div className="cd-skel h-72" /></div>
      <div className="grid gap-4 lg:grid-cols-3"><div className="cd-skel h-64" /><div className="cd-skel h-64" /><div className="cd-skel h-64" /></div>
    </div>
  );
}

const pct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n * 100)}%`);


const CAT_LABEL = { pump: 'Pump / service (Search-1)', drilling: 'Drilling' } as const;
function AdSplitBlocks({ split, dark = false }: { split: NonNullable<Dashboard['adSplit']>; dark?: boolean }) {
  const ink = dark ? 'text-slate-100' : 'text-slate-900';
  const mut = dark ? 'text-slate-500' : 'text-slate-500';
  const box = dark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-slate-50/60';
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
      {([split.since, split.week] as const).map((win) => (
        <div key={win.label} className="min-w-0 space-y-2">
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${mut} ${dark ? 'xl:text-base' : ''}`}>{win.label}</p>
          {win.rows.map((r) => (
            <div key={r.category} className={`min-w-0 rounded-xl border p-3 ${box}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className={`min-w-0 text-xs font-semibold leading-tight ${ink} ${dark ? 'xl:text-xl' : ''}`}>{CAT_LABEL[r.category]}</p>
                <p className={`shrink-0 text-2xl font-extrabold tabular-nums ${ink} ${dark ? 'xl:text-4xl' : ''}`} title="ROAS (new customers) = new-customer invoiced ÷ spend">{r.multipleNew === undefined ? '—' : mult(r.multipleNew)}<span className="ml-1 text-[10px] font-medium text-slate-400 xl:text-sm">ROAS (new customers)</span>{r.category === 'drilling' ? <span className="ml-1 text-[10px] font-medium text-amber-500 xl:text-sm">early</span> : null}</p>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 min-[480px]:grid-cols-4">
                {([['Spend', usd(r.spend)], ['Calls', String(r.calls)], ['New booked', String(r.booked)], ['Invoiced (new)', r.invoicedNew == null ? '—' : usd(r.invoicedNew)]] as const).map(([k, v]) => (
                  <div key={k} className="min-w-0"><dt className={`text-[11px] uppercase leading-tight tracking-wider ${mut} ${dark ? 'xl:text-sm' : ''}`}>{k}</dt><dd className={`truncate text-lg font-bold tabular-nums ${ink} ${dark ? 'xl:text-3xl' : ''}`}>{v}</dd>{k === 'Spend' ? <MiniSpark values={r.dailySpend} color={palette.spend} title={`Daily Google Ads spend, ${win.dates ?? win.label}`} /> : null}</div>
                ))}
              </dl>
              <p className={`mt-2 text-xs ${mut} ${dark ? 'xl:text-base' : ''}`}>Blended (all callers) {mult(r.multiple)}{r.leads != null ? <span title="new booked ÷ real new leads (one per caller; junk, repeat and existing customers excluded)"> · Call to booking (real leads) {r.leads ? `${pct(Math.min(1, r.booked / r.leads))} (${r.booked}/${r.leads})` : '—'}</span> : null}</p>
            </div>
          ))}
          {win.otherBooked != null ? <p className={`text-[11px] ${mut} ${dark ? 'xl:text-sm' : ''}`}>{win.otherBooked > 0 ? `+${win.otherBooked} booked via Mike calls · ` : ''}{win.rows.reduce((a, r) => a + r.booked, 0) + win.otherBooked} new booked total</p> : null}
        </div>
      ))}
    </div>
  );
}

function AdSplitCard({ split }: { split: NonNullable<Dashboard['adSplit']> }) {
  return (
    <Card title="Ad spend: pump vs drilling" subtitle="Google Ads campaigns · same calculation as the Return on ad spend card: Jobber invoices to callers whose latest prior ad call was this campaign ÷ Google Ads spend, same Pacific days · all = new + repeat customers" delay={100}>
      <AdSplitBlocks split={split} />
      <p className="mt-3 text-[11px] text-amber-600">Drilling return is early: drilling jobs invoice weeks to months after the call, so expect it to rise. Spend and clicks come straight from Google Ads; calls are Google Ads calls only.</p>
    </Card>
  );
}

function leadsHint(rl: Dashboard['realLeads']): string {
  const base = 'New-customer bookings ÷ real new leads (one per caller). Excluded: spam/robocalls/solicitors, hang-ups and short calls never reached, repeat calls, missed calls later reached, existing customers (Jobber job before the call), staff.';
  if (!rl) return base;
  return `${base}\n${rl.calls} ad + Mike calls → ${rl.leads} real leads.\n` + rl.excluded.filter((e) => e.count).map((e) => `− ${e.count} ${e.label}`).join('\n');
}

function WeeklySalesCard({ weekly, realLeads }: { weekly: NonNullable<Dashboard['weekly']>; realLeads?: Dashboard['realLeads'] }) {
  const cw = weekly.weeks[weekly.weeks.length - 1];
  const prev = weekly.weeks[weekly.weeks.length - 2];
  const first = weekly.weeks[0];
  // Headline tiles follow the selected range; fall back to this week if the API predates range totals.
  const w = weekly.totals ?? cw;
  const title = weekly.totals?.title ?? `This week to date: ${cw.label}`;
  const span = w.label;
  const rows: Array<[string, string, string?, string?]> = [
    ['Jobs booked', w.jobsBooked == null ? '—' : String(w.jobsBooked), 'jobs created'],
    ['Jobs completed', w.jobsCompleted == null ? '—' : String(w.jobsCompleted), 'finished'],
    ['Quotes sent', compactUsd(w.quotesSentValue), `${w.quotesSent ?? 0} quotes sent`],
    ['Approved this period', compactUsd(w.quotesApprovedValue), `${w.quotesApproved ?? 0} quotes approved (any send date)`],
    ['Call to booking (real leads)', pct(w.closingRate), `${w.bookedCalls ?? 0} new booked / ${w.calls} real leads`, leadsHint(realLeads)],
    ['Quote close rate', pct(w.quotesSent ? (w.quotesSentApproved ?? 0) / w.quotesSent : null), `${w.quotesSentApproved ?? 0} of ${w.quotesSent ?? 0} sent in range approved to date`, 'Cohort: quotes sent in the selected range that are approved/converted as of now. Recent quotes may still close.'],
    ['Last full week', usd(prev?.invoiced), `invoiced ${prev?.label ?? ''}`],
  ];
  const cats = weekly.totals?.byCategory;
  const lwc = weekly.lastWeekByCategory;
  const cab = weekly.totals?.closingByAd;
  const CATS = [['drilling', 'Drilling'], ['pump', 'Pump & service'], ['service_call', 'Service calls']] as const;
  return (
    <Card title="Sales" subtitle={`${title} · bars: last 8 weeks ${first.label.split('–')[0]}–${prev?.label.split('–')[1] ?? ''} + this week (Mon–Sun, PT)`} right={<Legend items={[[palette.revenue, 'Invoiced'], [palette.paid, 'Paid on invoices / cash']]} />} delay={90}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl bg-indigo-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Invoiced</p><p className="whitespace-nowrap text-3xl font-extrabold tabular-nums text-slate-900 sm:text-4xl">{usd(w.invoiced)}</p><p className="text-xs text-slate-500">{span} · {w.invoiceCount ?? 0} invoices{w.zeroInvoices ? ` (${w.zeroInvoices} at $0)` : ""}, pre-tax</p></div>
        <div className="min-w-0 rounded-xl bg-teal-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">Paid on those invoices</p><p className="whitespace-nowrap text-3xl font-extrabold tabular-nums text-slate-900 sm:text-4xl">{usd(w.paid)}</p><p className="text-xs text-slate-500">invoices issued {span}</p></div>
        <div className="col-span-2 min-w-0 rounded-xl bg-emerald-50 px-4 py-3 sm:col-span-1"><p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Cash collected</p><p className="whitespace-nowrap text-3xl font-extrabold tabular-nums text-slate-900 sm:text-4xl">{usd(w.cash)}</p><p className="text-xs text-slate-500">payments received {span} · {w.cashCount ?? 0} payments, any invoice</p></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4 lg:col-span-3">
          {rows.map(([label, value, sub, hint]) => (
            <div key={label} className="min-w-0" title={hint}>
              <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
              <p className="whitespace-nowrap text-lg font-bold tabular-nums text-slate-900">{value}</p>
              <p className="text-[11px] leading-tight text-slate-400">{sub}</p>
            </div>
          ))}
        </div>
        {cats ? (
          <div className="min-w-0 lg:col-span-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">By type · {span}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {CATS.map(([k, label]) => {
                const c = cats[k];
                const ac = k === 'service_call' ? null : cab?.[k];
                const accent = k === 'drilling' ? 'border-l-amber-400' : k === 'pump' ? 'border-l-sky-500' : 'border-l-violet-500';
                const svc = k === 'service_call';
                const lines: Array<[string, string, string?]> = svc ? [
                  ['Completed', String(c.jobsCompleted ?? 0)],
                  ['Invoiced', usd(c.invoiced), `${c.invoiceCount} invoices`],
                  ['Last full week', lwc ? `${lwc[k].jobsBooked} booked` : '—'],
                ] : [
                  ['Jobs booked', `${c.jobsBooked}${c.siteVisits ? ` +${c.siteVisits} site walk${c.siteVisits === 1 ? '' : 's'}` : ''}`, 'Jobber jobs created; site walks / site visits counted separately'],
                  ['Quotes sent', `${c.quotesSent} · ${compactUsd(c.quotesSentValue)}`],
                  ['Close rate (sent in period)', c.quotesSent ? `${pct((c.quotesSentApproved ?? 0) / c.quotesSent)} (${c.quotesSentApproved ?? 0}/${c.quotesSent})` : '—', 'of quotes sent in the range, share approved/converted to date (cohort)'],
                  ['Approved this period', `${c.quotesApproved} · ${compactUsd(c.quotesApprovedValue)}`, 'quotes approved in the range by approval date, including quotes sent earlier (e.g. an old drilling quote approved today)'],
                  ['Call to booking', ac ? `${pct(ac.closingRate)} (${ac.booked}/${ac.calls})` : '—', 'new bookings ÷ real new leads of that type (one per caller; junk, repeat and existing customers excluded)'],
                  ['Last full week', lwc ? usd(lwc[k].invoiced) : '—'],
                ];
                return (
                  <section key={k} className={`min-w-0 rounded-xl border border-slate-100 border-l-4 ${accent} bg-white px-3 py-2.5 shadow-sm`}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
                    <p className="whitespace-nowrap text-2xl font-extrabold tabular-nums text-slate-900">{svc ? c.jobsBooked : usd(c.invoiced)}</p>
                    <p className="text-[11px] text-slate-400">{svc ? 'service-call jobs booked' : `invoiced · ${c.invoiceCount} invoices`}</p>
                    <dl className="mt-2 space-y-1 text-xs">
                      {lines.map(([l, v, h]) => (
                        <div key={l} className="flex items-baseline justify-between gap-2" title={h}><dt className="text-slate-500">{l}</dt><dd className="whitespace-nowrap font-semibold tabular-nums text-slate-800">{v}</dd></div>
                      ))}
                    </dl>
                  </section>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className="min-w-0 lg:col-span-2"><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Invoiced (bar) · paid on those invoices (teal)</p><WeeklyBars weeks={weekly.weeks} /><p className="mb-0.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cash collected by payment date</p><WeeklyCashBars weeks={weekly.weeks} /></div>
      </div>
      <details className="mt-3 text-[11px] text-slate-400"><summary className="cursor-pointer">Sources &amp; definitions</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">{weekly.sources.map((x) => <li key={x}>{x}</li>)}{weekly.gaps.map((x) => <li key={x} className="text-amber-600">{x}</li>)}</ul>
      </details>
    </Card>
  );
}

const SOURCE_ACCENT: Record<string, string> = { gbp: '#2563eb', seo: '#16a34a', yelp: '#dc2626', apple_maps: '#475569' };
function SourceCardsBlock({ cards, rangeLabel }: { cards: NonNullable<Dashboard['sourceCards']>; rangeLabel: string }) {
  const split = (x: { pump: number; drilling: number }) => `pump ${x.pump} · drilling ${x.drilling}`;
  return (
    <Card title="Leads by source (not ads)" subtitle={`Google Business Profile, website search, Yelp and Apple Maps · ${rangeLabel} · Google Ads stays in the cards above`} delay={110}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.key} className="min-w-0 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3" style={{ borderTop: `3px solid ${SOURCE_ACCENT[c.key] ?? '#64748b'}` }}>
            <p className="truncate text-sm font-semibold text-slate-800">{c.label}</p>
            <p className="truncate text-[11px] text-slate-500" title={c.numbers.join(' · ')}>{c.numbers.length ? c.numbers.join(' · ') : 'No tracking number yet'}</p>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              {([['Calls', String(c.calls), c.calls ? `${c.callers} caller${c.callers === 1 ? '' : 's'}` : ''], ['Forms', String(c.forms.total), c.forms.total ? split(c.forms) : ''], ['Booked', String(c.booked.total), c.booked.total ? split(c.booked) : '']] as const).map(([k, v, sub]) => (
                <div key={k} className="min-w-0"><dt className="text-[11px] uppercase tracking-wider text-slate-500">{k}</dt><dd className="text-xl font-bold tabular-nums text-slate-900">{v}</dd>{sub ? <dd className="truncate text-[10px] text-slate-500" title={sub}>{sub}</dd> : null}</div>
              ))}
            </dl>
            {c.note ? <p className="mt-2 text-[10px] leading-snug text-slate-400">{c.note}</p> : null}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-slate-400">Calls = calls to that source&apos;s tracking number. Forms = website requests whose first visit came from that source. Booked = a Jobber job created within 30 days of that caller&apos;s or form&apos;s first contact (site walks excluded); drilling vs pump from the job title, forms by the service picked.</p>
    </Card>
  );
}

export function CallDashboardPage() {
  const [range, setRange] = useState<string>('since');
  useEffect(() => { // honor ?range= (e.g. coming back from TV mode with its period)
    const r = new URLSearchParams(window.location.search).get('range');
    if (r && RANGES.some((x) => x.v === r)) setRange(r);
  }, []);
  const { data, error, loading, reload } = useDashboard(range, 30_000);
  const t = data?.totals;
  const s = data?.series ?? [];
  const prev = data?.previous;
  const rangeLabel = RANGES.find((r) => r.v === range)?.label ?? '';
  // Spend, revenue and ROAS start at Sep 18 (closed-loop tracking start) even when the toggle reaches further back.
  const moneyLabel = data?.start && data?.revenueStart && Date.parse(data.start) < Date.parse(data.revenueStart) ? 'Since Sep 18 (tracking start)' : rangeLabel;
  const calls = s.map((d) => d.answered + d.missed);
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 text-slate-900 antialiased">
      <style>{STYLES}</style>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="mr-auto">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Call performance</h1>
          <p className="text-xs text-slate-500">Google Ads calls, AI receptionist and closed-loop revenue · Pacific time{(data as (Dashboard & Live) | null)?.jobberDataAsOf ? <span className="text-slate-400"> · data as of {hm((data as Dashboard & Live).jobberDataAsOf)} PT</span> : null}</p>
        </div>
        <LiveBadge at={(data as (Dashboard & Live) | null)?.generatedAt} refreshMs={30_000} error={error} />
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 shadow-sm" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.v} role="tab" aria-selected={range === r.v} onClick={() => setRange(r.v)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors sm:text-sm ${range === r.v ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>{r.label}</button>
          ))}
        </div>
        <button onClick={reload} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:text-sm">Refresh</button>
        <a href="/ops/metrics" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:text-sm">Metrics</a>
        <a href="/ops/calls/tv" className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-700 sm:text-sm">TV mode ↗</a>
      </div>

      {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span aria-hidden>⚠</span><span>{error}{data ? ' Showing the last data received.' : ''}</span></div> : null}
      {!data && !error ? <DashboardSkeleton /> : null}

      {data && t ? (
        <div className={`space-y-5 transition-opacity duration-300 ${loading ? 'opacity-60' : 'opacity-100'}`}>
          {data.weekly ? <WeeklySalesCard weekly={data.weekly} realLeads={data.realLeads} /> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Sales unavailable right now (Jobber data did not load). {data.gaps?.filter((g) => g.startsWith('weekly')).join(' ')}</div>}

          {data.adSplit ? <AdSplitCard split={data.adSplit} /> : null}

          {data.sourceCards ? <SourceCardsBlock cards={data.sourceCards} rangeLabel={rangeLabel} /> : null}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi delay={0} color={palette.answered} label="Ad + Mike calls" hint="Google Ads tracked calls + calls answered by Mike (AI receptionist). Main/Ransom/GBP lines answered by staff are not included (Voice history starts Oct 3)." range={rangeLabel} value={String(t.calls)} sub={`${t.answered} answered · ${t.missedOrShort} missed/short`} spark={calls} delta={<Delta cur={t.calls} prev={prev?.calls} />} />
            <Kpi delay={40} color={palette.booked} label="Booked (new customers)" range={rangeLabel} value={String(t.bookedNew)} sub={data.realLeads ? `of ${data.realLeads.leads} real leads · ${data.realLeads.excluded.find((e) => e.reason === 'existing')?.count ?? 0} existing-customer callers excluded` : `${t.knownExisting} existing · ${t.unmatched} other`} spark={s.map((d) => d.booked)} />
            <Kpi delay={80} color={palette.spend} label="Ad spend" range={moneyLabel} value={usd(t.spend)} sub={`${usd(t.costPerCall, 2)}/ad call · ${usd(t.costPerBooked)}/new booking`} spark={s.filter((d) => !data.revenueStart || d.date >= ptKey(data.revenueStart)).map((d) => d.spend ?? 0)} delta={<Delta cur={t.spend} prev={prev?.spend} goodWhenUp={false} />} />
            <Kpi delay={120} color={palette.revenue} label="ROAS (new customers)" range={moneyLabel} hint="Jobber invoices to new customers who called an ad ÷ Google Ads spend" value={data.roas ? mult(data.roas.newOnly.multipleInvoiced) : '—'} sub={data.roas ? `${usd(data.roas.newOnly.invoiced)} invoiced · Blended (all callers) ${mult(data.roas.overall.multipleInvoiced)}` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Calls per day" subtitle={rangeLabel} right={<Legend items={[[palette.answered, 'Answered'], [palette.missed, 'Missed / short']]} />} delay={60}>
              {s.length ? <CallsPerDayChart series={s} /> : <p className="py-16 text-center text-sm text-slate-400">No data</p>}
            </Card>
            <Card title="Daily ad spend" subtitle={`Google Ads spend per day · ${rangeLabel} (revenue: see Return on ad spend)`} right={<Legend items={[[palette.spend, 'Spend']]} />} delay={100}>
              {s.length ? <SpendRevenueChart series={s.map((d) => ({ ...d, invoiced: 0 }))} /> : <p className="py-16 text-center text-sm text-slate-400">No data</p>}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="New leads — needs callback" subtitle="Missed, voicemail, and Mike. Attempt counts include shop Voice lines and Mike's automated callbacks. Skips hang-ups under 10s, spam, vendors, AI bookings, and any Jobber request, quote, job (including cancelled), visit, or invoice on or after the call. Scroll for every row." right={<span className="cursor-help text-xs text-slate-400" title={OUTREACH_TIP}>Voice lines + Mike ⓘ</span>} delay={200}>
              <NeedsCallbackList view={data.needsCallback} rangeLabel={rangeLabel} empty="No new leads waiting on a callback in this period." />
            </Card>
            <Card title="Invoice follow-up" subtitle="Every awaiting-payment and past-due invoice, called or not. Scroll for every row. Calls are shop Voice lines since the invoice date, matched to the customer phone or Jobber client. Texts are app invoice SMS plus Jobber texts when that history loads. Emails are shop Gmail from Brighton, Liz, and Shanicey, plus Jobber invoice sends. A mailbox or source that cannot be read says unavailable." delay={220}>
              <NeedsCallbackList metric="invoices" view={data.invoiceFollowUp} rangeLabel={rangeLabel} empty="No invoice follow-ups right now." />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card title="Conversion funnel" subtitle={`New-customer jobs credited to a call · ${rangeLabel}`} delay={140}>
              <Funnel stages={[
                { label: 'Ad + Mike calls', value: data.funnel?.calls ?? t.calls, color: palette.answered },
                ...(data.realLeads ? [{ label: 'Real new leads', value: data.realLeads.leads, color: palette.answered }] : []),
                { label: 'Booked jobs (new)', value: data.funnel?.booked ?? t.bookedNew, color: palette.booked },
                { label: `New customers invoiced${data.roas ? ` · ${usd(data.roas.newOnly.invoiced)}` : ''}`, value: data.roas ? data.roas.newOnly.clients : null, color: palette.revenue },
                { label: 'Paid in full', value: data.roas ? data.roas.newOnly.paidClients ?? null : null, color: palette.paid },
              ]} />
              <p className="mt-2 text-[11px] text-slate-400">
                {data.funnel?.adCalls != null ? `${data.funnel.adCalls} Google Ads + ${data.funnel.calls - data.funnel.adCalls} Mike calls · ${data.funnel.uniqueCallers ?? '—'} unique callers` : null}
                {' · invoiced/paid = same new-customer set and dollars as ROAS (new customers)'}
              </p>
            </Card>
            <Card title="Return on ad spend" subtitle={`Jobber invoices ÷ Google Ads spend · ${rangeLabel}`} delay={180} className="lg:col-span-1">
              {data.roas ? (
                <>
                  <Gauge value={data.roas.newOnly.multipleInvoiced} label="ROAS (new)" />
                  <p className="-mt-1 text-center text-xs font-semibold uppercase tracking-wider text-slate-500">ROAS (new customers)</p>
                  <p className="mt-1 text-center text-sm text-slate-500">{usd(data.roas.newOnly.invoiced)} invoiced ÷ {usd(data.roas.spend)} spend</p>
                  <div className="mt-3 flex justify-center gap-6 text-center text-xs text-slate-500">
                    <div><div className="text-lg font-bold tabular-nums text-slate-800">{mult(data.roas.overall.multipleInvoiced)}</div>Blended (all callers)</div>
                  </div>
                  <details className="mt-2 text-[10px] text-slate-400"><summary className="cursor-pointer">How it is counted</summary><ul className="list-disc pl-4">{data.roas.method.filter((m) => !m.startsWith('Paid')).map((m) => <li key={m}>{m}</li>)}</ul></details>
                </>
              ) : (
                <p className="py-10 text-center text-sm text-slate-400">— Jobber invoices did not load; refresh in a minute.</p>
              )}
            </Card>
            <Card title="Recent calls" subtitle={data.callLog ? `All incoming · today ${data.callLog.today.total} · ${data.callLog.today.answered} answered · ${data.callLog.today.forwardedAi} to Mike · ${data.callLog.today.missed} missed` : 'All incoming'} delay={220} className="lg:col-span-3 !p-0">
              <div className="-mx-5 -mb-5 max-h-[520px] overflow-auto">
                {data.callFeed ? <CallFeedTable rows={data.callFeed} /> : <p className="px-5 py-8 text-center text-slate-400">Call feed unavailable</p>}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <GroupTable title={moneyLabel !== rangeLabel ? "By campaign (spend & $/call since Sep 18)" : "By campaign"} rows={data.byCampaign} delay={240} />
            <GroupTable title="By keyword / ad group" rows={data.byKeyword} delay={270} />
            <GroupTable title="By tracking number / source" rows={data.byTrackingNumber} delay={300} />
          </div>

          <PhoneCallTranscripts />

          <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><summary className="cursor-pointer font-medium text-slate-600">Data notes</summary><ul className="mt-2 list-disc space-y-1 pl-5">{data.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></details>
        </div>
      ) : null}
    </div>
  );
}

function BigTile({ label, range, value, sub, accent, spark, delta, delay }: { label: string; range?: string; value: string; sub?: string; accent: string; spark?: number[]; delta?: React.ReactNode; delay: number }) {
  return (
    <div className="cd-rise relative flex min-h-[150px] min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-3.5 sm:p-4 xl:p-5" style={{ animationDelay: `${delay}ms` }}>
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: accent }} />
      <p className="text-[11px] font-semibold uppercase leading-snug tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.18em] xl:text-base">{label}{range ? <span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-500 sm:text-[11px] xl:text-lg">{range}</span> : null}</p>
      <div className="min-w-0">
        <p className="cd-big font-extrabold leading-none tracking-tight tabular-nums text-white">{value}</p>
        <div className="mt-1 min-h-[1.25rem] text-sm text-emerald-400 xl:mt-2 xl:text-xl">{sub}</div>
      </div>
      <div className="h-8 shrink-0 overflow-hidden xl:h-12">{spark ? <Sparkline values={spark} color={accent} dark height={40} /> : delta}</div>
    </div>
  );
}

export function CallDashboardTv() {
  const [view, setView] = useState<'since' | 'month'>('since');
  const { data, error } = useDashboard(view, 60_000);
  const tv = data?.tv;
  const tt = data?.totals;
  const s = data?.series ?? [];
  const last7 = s.slice(-14);
  const now = useNow(1000);
  const clockStr = new Date(now).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
  const dateStr = new Date(now).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric' });
  const pt = (o: Intl.DateTimeFormatOptions) => new Date(now).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', ...o });
  const monthRange = `${pt({ month: 'short' })} 1–${pt({ day: 'numeric' })}`;
  const sinceRange = 'Since Sep 18';
  const mainRange = view === 'month' ? `This month · ${monthRange}` : sinceRange; // every period number follows the toggle (API range)
  const ro = data?.roas ?? null;
  const mainRev = ro ? { invoiced: ro.newOnly.invoiced, paid: ro.newOnly.paid } : null; // one strict new-customer source; '—' on failure
  const wk = data?.adSplit?.week;
  const weekNew = wk && wk.rows.every((r) => r.invoicedNew != null) ? wk.rows.reduce((a, r) => a + (r.invoicedNew ?? 0), 0) : null;
  const mainSpend = ro ? ro.spend : tt?.spend ?? null;
  const mainMult = ro?.overall.multipleInvoiced ?? null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto overflow-x-hidden bg-slate-950 text-white antialiased sm:gap-4 xl:gap-5" style={{ padding: 'max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))' }}>
      <style>{STYLES}</style>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 xl:px-4 xl:pt-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-black xl:h-14 xl:w-14 xl:text-2xl">S</div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-tight tracking-tight sm:text-xl xl:text-4xl">SCWS Calls &amp; Ads</h1><p className="text-xs text-slate-400 xl:text-lg">{dateStr}</p></div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:w-auto sm:flex-nowrap xl:gap-5">
          <div className="flex items-center gap-2 xl:gap-3">
          <a href={`/ops/calls?range=${view}`} aria-label="Back to dashboard" title="Back to dashboard" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white xl:px-4 xl:py-1.5 xl:text-xl"><span aria-hidden>←</span><span className="hidden sm:inline">Back to dashboard</span><span className="sm:hidden">Dashboard</span></a>
          <div className="inline-flex rounded-full border border-slate-700 bg-slate-900 p-0.5 text-xs font-medium xl:text-xl" role="tablist" aria-label="Revenue range">
            {([['since', 'Since Sep 18'], ['month', 'This month']] as const).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`whitespace-nowrap rounded-full px-2.5 py-1 xl:px-4 xl:py-1.5 ${view === v ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}>{l}</button>
            ))}
          </div>
          </div>
          <LiveBadge dark at={(data as (Dashboard & Live) | null)?.generatedAt} refreshMs={60_000} error={error} />
          <p className="order-first shrink-0 text-2xl font-bold tabular-nums sm:order-last xl:text-5xl">{clockStr}</p>
        </div>
      </div>
      {(data as (Dashboard & Live) | null)?.jobberDataAsOf ? <p className="-mt-1 text-right text-[10px] text-slate-500 xl:text-sm">data as of {hm((data as Dashboard & Live).jobberDataAsOf)} PT</p> : null}
      {!data && !error ? <p className="text-sm text-slate-400 xl:text-xl" aria-live="polite">Loading {view === 'month' ? 'this month' : 'since Sep 18'} numbers…</p> : null}
      {error && !tv ? <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-rose-200 xl:text-2xl">{error}</div> : null}
      {tv ? (
        <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 xl:gap-4">
          <BigTile delay={0} accent={palette.answered} label="Calls" range="Today · all incoming" value={data?.callLog ? String(data.callLog.today.total) : '—'} spark={last7.map((d) => d.answered + d.missed)} />
          <BigTile delay={40} accent={palette.answered} label="Answered" range="Today" value={data?.callLog ? String(data.callLog.today.answered) : '—'} sub={data?.callLog ? `+${data.callLog.today.forwardedAi} to Mike` : undefined} spark={last7.map((d) => d.answered)} />
          <BigTile delay={80} accent={palette.missed} label="Missed" range="Today" value={data?.callLog ? String(data.callLog.today.missed) : '—'} spark={last7.map((d) => d.missed)} />
          <BigTile delay={120} accent={palette.booked} label="Booked" range="Today / this week" value={`${tv.bookedToday} / ${tv.bookedWeek}`} spark={last7.map((d) => d.booked)} />
        </div>
      ) : !error ? (
        <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3 xl:gap-4" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="cd-skel-dark h-[150px]" />)}</div>
      ) : null}
      {tv ? (
        <div className="grid shrink-0 grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:gap-4" aria-label="Revenue and return">
          <BigTile delay={160} accent={palette.revenue} label="New-cust. revenue" range={mainRange} value={usd(mainRev?.invoiced ?? null)} sub={`this week ${usd(weekNew)}`} />
          <BigTile delay={200} accent={palette.spend} label="Ad spend" range={mainRange} value={usd(mainSpend ?? 0)} spark={s.filter((d) => !data?.revenueStart || d.date >= ptKey(data.revenueStart)).map((d) => d.spend ?? 0)} />
          <div className="cd-rise relative flex min-h-[150px] min-w-0 flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-3" style={{ animationDelay: '240ms' }}>
            <span className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500" />
            <p className="self-start text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400 xl:text-base">ROAS (new customers)<span className="block text-[10px] font-medium normal-case tracking-normal text-slate-500 xl:text-sm">{mainRange}</span></p>
            <div className="w-full max-w-[240px] xl:max-w-[300px]"><Gauge dark value={ro?.newOnly.multipleInvoiced ?? null} label="invoiced ÷ spend" /></div>
            {ro ? <p className="text-sm text-slate-400 xl:text-xl">Blended (all callers) <span className="font-semibold text-slate-200">{mult(ro?.overall.multipleInvoiced ?? null)}</span></p> : null}
          </div>
        </div>
      ) : null}
      {data?.weekly ? (() => {
        const ws = data.weekly.weeks; const w = data.weekly.totals ?? ws[ws.length - 1];
        const head = data.weekly.totals?.title ?? `This week to date ${w.label}`;
        const cell = (l: string, v: string, sub?: string) => (<div className="min-w-0"><p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-500 xl:text-base">{l}</p><p className="whitespace-nowrap text-lg font-bold tabular-nums xl:text-2xl 2xl:text-3xl">{v}</p>{sub ? <p className="text-[10px] leading-tight text-slate-500 xl:text-base">{sub}</p> : null}</div>);
        return (
          <div className="grid shrink-0 grid-cols-2 items-start gap-x-4 gap-y-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:grid-cols-3 md:grid-cols-5 2xl:grid-cols-[repeat(9,minmax(0,1fr))_minmax(0,2.2fr)] 2xl:items-end xl:gap-x-5 xl:px-6 xl:py-4" aria-label="Sales">
            <p className="col-span-full text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 xl:text-sm">Sales · {head} · bars: invoiced, last 9 weeks, Mon–Sun</p>
            {cell('Invoiced', usd(w.invoiced))}
            {cell('Paid on invoices', usd(w.paid), `issued ${w.label}`)}
            {cell('Cash collected', usd(w.cash), `received ${w.label}`)}
            {cell('Jobs booked', w.jobsBooked == null ? '—' : String(w.jobsBooked))}
            {cell('Completed', w.jobsCompleted == null ? '—' : String(w.jobsCompleted))}
            {cell('Quotes sent', compactUsd(w.quotesSentValue), `${w.quotesSent ?? 0} quotes`)}
            {cell('Approved', compactUsd(w.quotesApprovedValue), `${w.quotesApproved ?? 0} quotes`)}
            {cell('Quote close rate', pct(w.quotesSent ? (w.quotesSentApproved ?? 0) / w.quotesSent : null), `${w.quotesSentApproved ?? 0}/${w.quotesSent ?? 0} sent, approved to date · ${w.quotesApproved ?? 0} approved this period`)}
            {cell('Call to booking (real leads)', pct(w.closingRate), `${w.bookedCalls ?? 0}/${w.calls} real leads`)}
            <div className="col-span-full mt-2 min-w-0 2xl:col-span-1"><WeeklyBars dark weeks={ws} height={40} /><p className="mb-0.5 mt-1 text-[10px] uppercase tracking-wider text-slate-500">Cash collected / wk</p><WeeklyCashBars dark weeks={ws} height={28} /></div>
          </div>
        );
      })() : null}
      {data?.adSplit ? (
        <div className="shrink-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:px-4 xl:px-6 xl:py-4" aria-label="Ad spend pump vs drilling">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 xl:text-sm">Ad spend · pump vs drilling · drilling return is early (long-tail)</p>
          <AdSplitBlocks dark split={data.adSplit} />
        </div>
      ) : null}
      <div className="grid shrink-0 gap-3 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:px-4 xl:px-6 xl:py-4" aria-label="New leads — needs callback">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 xl:text-base" title={OUTREACH_TIP}>New leads — needs callback</p>
          <p className="mb-2 text-[11px] text-slate-500 xl:text-sm">Missed, voicemail, and Mike · {mainRange}. Counts include Mike's automated callbacks. Personal cell calls are not logged.</p>
          <NeedsCallbackList dark view={data?.needsCallback} rangeLabel={mainRange} empty="No new leads waiting on a callback in this period." />
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:px-4 xl:px-6 xl:py-4" aria-label="Invoice follow-up">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 xl:text-base">Invoice follow-up</p>
          <p className="mb-2 text-[11px] text-slate-500 xl:text-sm">Every open invoice · scroll for all · {mainRange}.</p>
          <NeedsCallbackList dark metric="invoices" view={data?.invoiceFollowUp} rangeLabel={mainRange} empty="No invoice follow-ups right now." />
        </div>
      </div>
      <div className="shrink-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:px-4 xl:px-6 xl:py-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 xl:text-base">Recent calls</p>
        {data?.callFeed ? <CallFeedTable dark rows={data.callFeed} max={6} /> : <p className="text-slate-500">{tv ? 'No recent calls' : ' '}</p>}
      </div>
    </div>
  );
}
