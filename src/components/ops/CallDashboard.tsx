'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SOURCE_LABEL, Transcript, fmtPhone, splitSummary, useRecordedCalls, type RecordedCall } from './PhoneCallTranscripts';
import { useSearchParams } from 'next/navigation';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';
import type { Dashboard, GroupRow } from '@/lib/ads/call-dashboard';
const SECTIONS = ['today', 'sales', 'ads', 'collections'] as const;
import {
  CallsSpendChart, Funnel, Gauge, Sparkline, WeeklyBars, WeeklyCashBars, compactUsd, mult, palette, usd,
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

/** A dashboard request that has not answered by now is abandoned (server maxDuration is 180 s). */
const FETCH_TIMEOUT_MS = 60_000;

function useDashboard(range: string, refreshMs: number | null, view?: 'tv') {
  // One cached payload per period. A response only ever lands in its own period's slot, and the page shows
  // the selected period's payload only, so switching the toggle never shows the other period's numbers.
  const [byRange, setByRange] = useState<Record<string, Dashboard>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const current = useRef(range);
  current.current = range;
  // One request per period at a time, but never forever: iOS Safari can leave a fetch pending after the tab is
  // backgrounded, which used to keep inFlight set so every refresh (and the Refresh button) was skipped and the
  // page sat on skeletons with "Connecting…". Each request now aborts after FETCH_TIMEOUT_MS, Refresh aborts a
  // stuck request and starts over, and coming back to the tab reloads.
  const inFlight = useRef<Record<string, { ctrl: AbortController; at: number } | undefined>>({});
  const loadWith = useCallback(async (force: boolean) => {
    const r = range;
    const busy = inFlight.current[r];
    if (busy && !force && Date.now() - busy.at < FETCH_TIMEOUT_MS) return; // keeps Jobber load flat while a cold load runs
    busy?.ctrl.abort();
    const ctrl = new AbortController();
    const mine = { ctrl, at: Date.now() };
    inFlight.current[r] = mine;
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get(QUOTES_GP_KEY_QUERY);
      if (q) { try { localStorage.setItem(KEY_STORAGE, q); } catch {} }
      let key = q; try { key = key || localStorage.getItem(KEY_STORAGE); } catch {}
      const res = await fetch(`/api/ops/call-dashboard?range=${r}${view ? `&view=${view}` : ''}`, {
        headers: key ? { [QUOTES_GP_KEY_HEADER]: key } : {}, cache: 'no-store', signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Not signed in. Log in to the CRM or open this page with your office key.' : `Error ${res.status}`);
      const json = await res.json();
      setByRange((m) => ({ ...m, [r]: json }));
      if (current.current === r) setError(null);
    } catch (e) {
      if (inFlight.current[r] !== mine) return; // replaced by a newer request (Refresh / tab return)
      const msg = ctrl.signal.aborted ? 'Taking too long to load. Tap Refresh to try again.' : e instanceof Error ? e.message : 'Failed to load';
      if (current.current === r) setError(msg);
    } finally {
      clearTimeout(timer);
      if (inFlight.current[r] === mine) { inFlight.current[r] = undefined; if (current.current === r) setLoading(false); }
    }
  }, [range, view]);
  const load = useCallback(() => loadWith(false), [loadWith]);
  const reload = useCallback(() => loadWith(true), [loadWith]);
  useEffect(() => {
    setLoading(true); setError(null);
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);
    const t = refreshMs ? setInterval(load, refreshMs) : null;
    return () => {
      if (t) clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [load, refreshMs]);
  return { data: byRange[range] ?? null, error, loading, reload };
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

function LiveBadge({ at, refreshMs, error, dark = false, large = false }: { at?: string; refreshMs: number; error: string | null; dark?: boolean; large?: boolean }) {
  const now = useNow(1000);
  const age = at ? Math.max(0, Math.round((now - Date.parse(at)) / 1000)) : null;
  const stale = !!error || (age != null && age * 1000 > refreshMs * 2.5);
  const dot = error ? 'bg-rose-500' : stale ? 'bg-amber-500' : 'bg-emerald-500 cd-live';
  const text = dark ? 'text-slate-300' : 'text-slate-600';
  const size = large ? 'xl:px-5 xl:py-2 xl:text-xl' : 'min-h-9';
  return (
    <div className={`inline-flex max-w-full shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium tabular-nums ${size} ${dark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'} ${text}`} role="status">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="font-semibold">{error ? 'Offline' : stale ? 'Delayed' : 'Live'}</span>
      <span className={`min-w-0 truncate ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{at ? `Updated ${clock(at)} PT${age != null ? ` · ${age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`} ago` : ''}` : 'Connecting…'}</span>
    </div>
  );
}

/** Mirror when the API has a Jobber sync time; otherwise the page is on live Jobber. */
function Freshness({ mirrorAsOf, generatedAt, dark = false }: { mirrorAsOf?: string | null; generatedAt?: string | null; dark?: boolean }) {
  const mirror = !!mirrorAsOf;
  const when = mirror ? hm(mirrorAsOf ?? null) : generatedAt ? hm(generatedAt) : null;
  const tone = mirror ? (dark ? 'text-sky-300' : 'text-sky-800') : (dark ? 'text-amber-300' : 'text-amber-800');
  const box = dark ? 'border-slate-700 bg-slate-900 text-slate-300' : 'border-slate-200 bg-white text-slate-600';
  return (
    <p className={`inline-flex max-w-full flex-wrap items-center gap-x-1.5 rounded-full border px-3 py-1 text-xs ${box}`} data-freshness={mirror ? 'mirror' : 'live'}>
      <span className={`font-semibold ${tone}`}>{mirror ? 'Jobber mirror' : 'Live Jobber'}</span>
      <span className={dark ? 'text-slate-500' : 'text-slate-400'}>·</span>
      <span>{mirror ? `last synced ${when ?? '—'} PT` : generatedAt ? `as of ${when} PT` : 'waiting for a sync time'}</span>
    </p>
  );
}

function SectionHead({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div id={id} className="scroll-mt-6 border-b border-slate-200/80 pb-2 pt-1">
      <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
      {hint ? <p className="mt-0.5 max-w-3xl text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

const BLENDED_ROAS_HINT = 'All revenue ÷ all ad spend. New-customer ROAS counts only revenue from new customers who came in through ads.';

function HeadlineKpis({ data, rangeLabel, moneyLabel }: { data: Dashboard; rangeLabel: string; moneyLabel: string }) {
  const w = data.weekly?.totals ?? null;
  const ro = data.roas;
  const t = data.totals;
  const quoteClose = w?.quotesSent ? (w.quotesSentApproved ?? 0) / w.quotesSent : null;
  const items: Array<{ label: string; value: string; sub: string; period: string; hint?: string }> = [
    { label: 'Revenue invoiced', value: usd(w?.invoiced), sub: w ? `${w.invoiceCount ?? 0} invoices, pre-tax${w.zeroInvoices ? ` · ${w.zeroInvoices} at $0` : ''}` : 'Sales did not load', period: w?.title || rangeLabel },
    { label: 'Cash collected', value: usd(w?.cash), sub: w ? `${w.cashCount ?? 0} payments, any invoice` : 'Sales did not load', period: rangeLabel },
    { label: 'Jobs booked / completed', value: w ? `${w.jobsBooked == null ? '—' : w.jobsBooked} / ${w.jobsCompleted == null ? '—' : w.jobsCompleted}` : '—', sub: 'created / finished', period: rangeLabel },
    { label: 'Quotes approved', value: w ? usd(w.quotesApprovedValue) : '—', sub: w ? `${w.quotesApproved ?? 0} approved this period` : 'Sales did not load', period: rangeLabel },
    { label: 'Close rate', value: pct(quoteClose), sub: w ? `${w.quotesSentApproved ?? 0} of ${w.quotesSent ?? 0} quotes sent · calls ${pct(w.closingRate)}` : 'Quote close rate', period: rangeLabel, hint: 'Big number is the quote close rate: quotes sent in the range that are approved or converted. The calls figure is call to booking on real leads.' },
    { label: 'Ad calls', value: String(t.calls), sub: `${t.answered} answered · ${t.missedOrShort} missed or short · includes Mike`, period: rangeLabel, hint: 'Google Ads tracked calls plus calls answered by Mike. Staff lines answered on the main, Ransom, and GBP numbers are not in this count.' },
    { label: 'New-customer ROAS', value: ro ? mult(ro.newOnly.multipleInvoiced) : '—', sub: ro ? `${usd(ro.newOnly.invoiced)} invoiced ÷ ${usd(ro.spend)} spend` : 'Jobber invoices did not load', period: moneyLabel, hint: 'Jobber invoices to new customers who called an ad, divided by Google Ads spend.' },
    { label: 'Blended ROAS', value: mult(ro?.blended?.multiple), sub: ro?.blended ? (ro.blended.spend ? `${usd(ro.blended.invoiced)} invoiced ÷ ${usd(ro.blended.spend)} spend` : `${usd(ro.blended.invoiced)} invoiced · no ad spend in this period`) : 'Jobber invoices did not load', period: moneyLabel, hint: BLENDED_ROAS_HINT },
    { label: 'Ad spend', value: usd(t.spend), sub: `${usd(t.costPerCall, 2)} per ad call · ${usd(t.costPerBooked)} per new booking`, period: moneyLabel },
  ];
  return (
    <section aria-label="Headline metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, i) => (
        <div key={item.label} title={item.hint} data-kpi={item.label} className={`${i === items.length - 1 && items.length % 2 ? 'sm:col-span-2 lg:col-span-1 ' : ''}flex min-h-[128px] min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04),0_8px_24px_-12px_rgba(15,23,42,.12)]`}>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{item.label}{item.hint ? <span className="ml-1 cursor-help normal-case text-slate-400" aria-label={item.hint}>ⓘ</span> : null}</p>
          <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400" title={item.period}>{item.period}</p>
          <p className="mt-1.5 break-words text-[1.65rem] font-semibold leading-none tracking-tight text-slate-900 tabular-nums sm:text-[1.85rem]">{item.value}</p>
          <p className="mt-2 text-xs leading-snug text-slate-500">{item.sub}</p>
        </div>
      ))}
    </section>
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
    <section className={`cd-rise min-w-0 rounded-2xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04),0_8px_24px_-12px_rgba(15,23,42,.1)] ${className}`} style={{ animationDelay: `${delay}ms` }}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-slate-100 px-4 py-3 sm:px-5">
        <div className="min-w-0"><h3 className="text-sm font-semibold text-slate-900">{title}</h3>{subtitle ? <p className="mt-0.5 text-xs leading-snug text-slate-500">{subtitle}</p> : null}</div>
        {right}
      </header>
      <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">{children}</div>
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
function InvoiceEmails({ emails, dark }: { emails?: Array<{ at: string; by: string | null; subject: string }> | null; dark: boolean }) {
  if (!emails?.length) return null;
  const tip = emails.map((email) => `${feedTime(email.at)} · ${email.by || 'Shop'} · ${email.subject}`).join('\n');
  return (
    <details className="mt-1">
      <summary className={`cursor-pointer text-xs underline decoration-dotted underline-offset-2 ${dark ? 'text-slate-300' : 'text-slate-600'}`} title={tip}>
        Show email subjects
      </summary>
      <ul className={`mt-1 space-y-0.5 ${dark ? 'text-slate-300' : 'text-slate-400'}`}>
        {emails.map((email, i) => (
          <li key={`${email.at}-${i}`} className="text-xs leading-snug" title={`${email.by || 'Shop'} · ${email.subject}`}>
            {feedTime(email.at)} · {email.by || 'Shop'} · {email.subject}
          </li>
        ))}
      </ul>
    </details>
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
                  {metric === 'invoices' ? <InvoiceEmails emails={r.collectionEmails} dark={dark} /> : null}
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
      {list.length === 0 ? <li className={`px-4 py-8 text-center ${sub}`}>No calls yet</li> : list.map((r, i) => (
        <li key={i} className={`min-w-0 px-1 py-3 ${r.outcome === 'Missed' ? (dark ? 'bg-rose-950/40' : 'bg-rose-50') : ''}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-sm tabular-nums ${sub}`}>{feedTime(r.at)} · {fmtDur(r.durationSeconds)}</span>
            <span className="text-sm"><OutcomePill o={r.outcome} by={r.answeredBy} dark={dark} /></span>
          </div>
          <div className={`mt-1 truncate text-base font-semibold ${ink}`} title={r.name || r.phone}>{r.name || <a className="underline decoration-slate-300 underline-offset-2" href={`tel:${r.phone}`}>{r.phone}</a>}</div>
          <div className={`truncate text-sm ${sub}`} title={`${r.phone} · ${r.line}`}>{r.name ? <a href={`tel:${r.phone}`}>{r.phone}</a> : null}{r.name ? ' · ' : ''}{r.line}</div>
          {r.summary ? <div className={`mt-1 break-words text-sm ${sub}`}>{r.summary}</div> : null}
          {r.callback ? <CallbackLine text={r.callback} dark={dark} /> : null}
          {r.mike ? <MikeLine text={r.mike} dark={dark} /> : null}
          {r.outreach ? <OutreachLine text={r.outreach} cold={r.goingCold} dark={dark} /> : null}
        </li>
      ))}
    </ul>
    <div className="hidden max-h-[32rem] overflow-auto min-[769px]:block">
    <table className={`w-full table-fixed text-left ${dark ? 'text-base xl:text-xl' : 'text-[15px]'}`}>
      <colgroup><col className="w-[19%]" /><col className="w-[28%]" /><col className="w-[14%]" /><col className="w-[26%]" /><col className="w-[13%]" /></colgroup>
      <thead className="sticky top-0 z-10"><tr className={`text-xs font-semibold uppercase tracking-wider ${head} ${dark ? 'bg-slate-900 xl:text-sm' : 'bg-white'}`}><th className="px-3 py-2">Time</th><th className="px-3 py-2">Caller</th><th className="px-3 py-2">Line</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2 text-right">Duration</th></tr></thead>
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
    </div>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading dashboard">
      <p className="text-sm text-slate-500">Loading office numbers… the first pull can take a minute.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="cd-skel h-[128px]" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2"><div className="cd-skel h-72" /><div className="cd-skel h-72" /></div>
      <div className="cd-skel h-64" />
    </div>
  );
}

const pct = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = Math.round(n * 1000) / 10;
  return Number.isInteger(v) ? `${v}%` : `${v.toFixed(1)}%`;
};


const CAT_LABEL = { pump: 'Pump / service (Search-1)', drilling: 'Drilling' } as const;
function AdSplitBlocks({ split, dark = false }: { split: NonNullable<Dashboard['adSplit']>; dark?: boolean }) {
  const ink = dark ? 'text-slate-100' : 'text-slate-900';
  const mut = dark ? 'text-slate-500' : 'text-slate-500';
  const box = dark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-200 bg-white';
  const tone = (category: string) => category === 'drilling' ? 'border-l-amber-500' : 'border-l-sky-500';
  const labelTone = (category: string) => category === 'drilling' ? (dark ? 'text-amber-300' : 'text-amber-800') : (dark ? 'text-sky-300' : 'text-sky-800');
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
      {([split.since, split.week] as const).map((win) => (
        <div key={win.label} className="min-w-0 space-y-2">
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${mut} ${dark ? 'xl:text-base' : ''}`}>{win.label}</p>
          {win.rows.map((r) => (
            <div key={r.category} className={`min-w-0 rounded-xl border border-l-4 p-3 ${tone(r.category)} ${box}`}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-2">
                <p className={`min-w-0 text-xs font-semibold leading-tight ${labelTone(r.category)} ${dark ? 'xl:text-xl' : ''}`}>{CAT_LABEL[r.category]}</p>
                <p className={`min-w-0 text-2xl font-semibold tabular-nums ${ink} ${dark ? 'xl:text-4xl' : ''}`} title="ROAS (new customers) = new-customer invoiced ÷ spend">{r.multipleNew === undefined ? '—' : mult(r.multipleNew)}<span className="ml-1 text-[10px] font-medium text-slate-400 xl:text-sm">ROAS (new customers)</span>{r.category === 'drilling' ? <span className="ml-1 text-[10px] font-medium text-amber-500 xl:text-sm">early</span> : null}</p>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
                {([['Spend', usd(r.spend)], ['Calls', String(r.calls)], ['New booked', String(r.booked)], ['Invoiced (new)', r.invoicedNew == null ? '—' : usd(r.invoicedNew)]] as const).map(([k, v]) => (
                  <div key={k} className="min-w-0"><dt className={`text-[11px] uppercase leading-tight tracking-wider ${mut} ${dark ? 'xl:text-sm' : ''}`}>{k}</dt><dd className={`truncate text-lg font-semibold tabular-nums ${ink} ${dark ? 'xl:text-3xl' : ''}`}>{v}</dd>{k === 'Spend' ? <MiniSpark values={r.dailySpend} color={palette.spend} title={`Daily Google Ads spend, ${win.dates ?? win.label}`} /> : null}</div>
                ))}
              </dl>
              <p className={`mt-2 break-words text-xs ${mut} ${dark ? 'xl:text-base' : ''}`}>All ad callers {mult(r.multiple)}{r.leads != null ? <span title="new booked ÷ real new leads (one per caller; junk, repeat and existing customers excluded)"> · Call to booking (real leads) {r.leads ? `${pct(Math.min(1, r.booked / r.leads))} (${r.booked}/${r.leads})` : '—'}</span> : null}</p>
            </div>
          ))}
          {win.otherBooked != null ? <p className={`text-[11px] ${mut} ${dark ? 'xl:text-sm' : ''}`}>{win.otherBooked > 0 ? `+${win.otherBooked} booked via Mike calls · ` : ''}{win.rows.reduce((a, r) => a + r.booked, 0) + win.otherBooked} new booked total</p> : null}
        </div>
      ))}
    </div>
  );
}

function leadsHint(rl: Dashboard['realLeads']): string {
  const base = 'New-customer bookings ÷ real new leads (one per caller). Excluded: spam/robocalls/solicitors, hang-ups and short calls never reached, repeat calls, missed calls later reached, existing customers (Jobber job before the call), staff.';
  if (!rl) return base;
  return `${base}\n${rl.calls} ad + Mike calls → ${rl.leads} real leads.\n` + rl.excluded.filter((e) => e.count).map((e) => `− ${e.count} ${e.label}`).join('\n');
}

function WeeklySalesCard({ weekly }: { weekly: NonNullable<Dashboard['weekly']> }) {
  const cw = weekly.weeks[weekly.weeks.length - 1];
  const prev = weekly.weeks[weekly.weeks.length - 2];
  const first = weekly.weeks[0];
  // Headline tiles follow the selected range; fall back to this week if the API predates range totals.
  const w = weekly.totals ?? cw;
  const title = weekly.totals?.title ?? `This week to date: ${cw.label}`;
  const span = w.label;
  const jobRows: Array<[string, string, string?, string?]> = [
    ['Jobs booked', w.jobsBooked == null ? '—' : String(w.jobsBooked), 'jobs created'],
    ['Jobs completed', w.jobsCompleted == null ? '—' : String(w.jobsCompleted), 'finished'],
  ];
  const quoteRows: Array<[string, string, string?, string?]> = [
    ['Quotes sent', usd(w.quotesSentValue), `${w.quotesSent ?? 0} quotes sent`],
    ['Approved this period', usd(w.quotesApprovedValue), `${w.quotesApproved ?? 0} quotes approved (any send date)`],
  ];
  const cats = weekly.totals?.byCategory;
  const lwc = weekly.lastWeekByCategory;
  const CATS = [['drilling', 'Drilling'], ['pump', 'Pump & service'], ['service_call', 'Service calls']] as const;
  const tone = { drilling: { bar: 'border-l-amber-500', label: 'text-amber-800', dot: 'bg-amber-500' }, pump: { bar: 'border-l-sky-500', label: 'text-sky-800', dot: 'bg-sky-500' }, service_call: { bar: 'border-l-violet-500', label: 'text-violet-800', dot: 'bg-violet-500' } } as const;
  const stat = (label: string, value: string, sub?: string, hint?: string) => (
    <div key={label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5" title={hint}>
      <p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-500">{label}</p>
      <p className="mt-0.5 break-words text-lg font-semibold tabular-nums text-slate-900">{value}</p>
      {sub ? <p className="text-[11px] leading-tight text-slate-400">{sub}</p> : null}
    </div>
  );
  return (
    <Card title="Sales and revenue" subtitle={`${title} · bars: last 8 weeks ${first.label.split('–')[0]}–${prev?.label.split('–')[1] ?? ''} + this week (Mon–Sun, PT)`} right={<Legend items={[[palette.revenue, 'Invoiced'], [palette.paid, 'Paid on invoices / cash']]} />} delay={90}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl bg-indigo-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Invoiced</p><p className="break-words text-3xl font-semibold tabular-nums text-slate-900">{usd(w.invoiced)}</p><p className="text-xs text-slate-500">{span} · {w.invoiceCount ?? 0} invoices{w.zeroInvoices ? ` (${w.zeroInvoices} at $0)` : ""}, pre-tax</p></div>
        <div className="min-w-0 rounded-xl bg-teal-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">Paid on those invoices</p><p className="break-words text-3xl font-semibold tabular-nums text-slate-900">{usd(w.paid)}</p><p className="text-xs text-slate-500">invoices issued {span}</p></div>
        <div className="min-w-0 rounded-xl bg-emerald-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Cash collected</p><p className="break-words text-3xl font-semibold tabular-nums text-slate-900">{usd(w.cash)}</p><p className="text-xs text-slate-500">payments received {span} · {w.cashCount ?? 0} payments, any invoice</p></div>
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <div id="operations">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Operations / jobs</h4>
            <div className="mt-2 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{jobRows.map(([label, value, sub, hint]) => stat(label, value, sub, hint))}</div>
          </div>
          <div id="quotes">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Quotes</h4>
            <div className="mt-2 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">{quoteRows.map(([label, value, sub, hint]) => stat(label, value, sub, hint))}</div>
          </div>
          <div>{stat('Last full week', usd(prev?.invoiced), `invoiced ${prev?.label ?? ''}`)}</div>
        </div>
        <div className="min-w-0 overflow-hidden lg:col-span-2">
          <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Invoiced (bar) · paid on those invoices (teal)</p>
          <WeeklyBars weeks={weekly.weeks} />
          <p className="mb-0.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cash collected by payment date</p>
          <WeeklyCashBars weeks={weekly.weeks} />
        </div>
      </div>
      {cats ? (
        <div className="mt-5 min-w-0">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">By type · {span}</p>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {CATS.map(([k, label]) => {
              const c = cats[k];
              const accent = tone[k];
              const svc = k === 'service_call';
              const lines: Array<[string, string, string?]> = svc ? [
                ['Completed', String(c.jobsCompleted ?? 0)],
                ['Invoiced', usd(c.invoiced), `${c.invoiceCount} invoices`],
                ['Last full week', lwc ? `${lwc[k].jobsBooked} booked` : '—'],
              ] : [
                ['Jobs booked', `${c.jobsBooked}${c.siteVisits ? ` +${c.siteVisits} site walk${c.siteVisits === 1 ? '' : 's'}` : ''}`, 'Jobber jobs created; site walks / site visits counted separately'],
                ['Quotes sent', `${c.quotesSent} · ${usd(c.quotesSentValue)}`],
                ['Approved this period', `${c.quotesApproved} · ${usd(c.quotesApprovedValue)}`, 'quotes approved in the range by approval date, including quotes sent earlier (e.g. an old drilling quote approved today)'],
                ['Last full week', lwc ? usd(lwc[k].invoiced) : '—'],
              ];
              return (
                <section key={k} className={`min-w-0 rounded-xl border border-slate-100 border-l-4 ${accent.bar} bg-slate-50/60 px-3 py-2.5`}>
                  <p className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${accent.label}`}><span className={`h-1.5 w-1.5 rounded-full ${accent.dot}`} />{label}</p>
                  <p className="break-words text-2xl font-semibold tabular-nums text-slate-900">{svc ? c.jobsBooked : usd(c.invoiced)}</p>
                  <p className="text-[11px] text-slate-400">{svc ? 'service-call jobs booked' : `invoiced · ${c.invoiceCount} invoices`}</p>
                  <dl className="mt-2 space-y-1.5 text-xs">
                    {lines.map(([l, v, h]) => (
                      <div key={l} className="flex items-baseline justify-between gap-3" title={h}><dt className="text-slate-500">{l}</dt><dd className="text-right font-semibold tabular-nums text-slate-800">{v}</dd></div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-slate-400">Close rates (call to booking, quote close rate) are on <a className="underline" href="#ads">Marketing / ads → Ad performance</a>.</p>
      <details className="mt-1 text-[11px] text-slate-400"><summary className="cursor-pointer">Sources &amp; definitions</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">{weekly.sources.map((x) => <li key={x}>{x}</li>)}{weekly.gaps.map((x) => <li key={x} className="text-amber-600">{x}</li>)}</ul>
      </details>
    </Card>
  );
}

const DAY_MS = 86400_000;
const OLDER_DAYS = 7;

/** "Jobber texts unavailable" and friends: shown once per card, not on every row. */
const UNAVAILABLE_RE = /\s*·?\s*\b(Jobber texts unavailable|Jobber emails unavailable|app texts unavailable|[A-Z][a-z]+ Gmail unavailable|Gmail unavailable|texts unavailable|email unavailable|calls unavailable)\b/g;
export function splitUnavailable(text: string | null | undefined): { text: string; missing: string[] } {
  if (!text) return { text: '', missing: [] };
  const missing: string[] = [];
  const cleaned = text.replace(UNAVAILABLE_RE, (_m, phrase: string) => { missing.push(phrase); return ''; }).replace(/^\s*·\s*/, '').replace(/\s*·\s*$/, '').replace(/(\s*·\s*){2,}/g, ' · ');
  return { text: cleaned.trim(), missing };
}

function Tile({ label, value, sub, tone = 'plain', href, spark, sparkColor, hint }: { label: string; value: string; sub?: string; tone?: 'plain' | 'alert'; href?: string; spark?: number[]; sparkColor?: string; hint?: string }) {
  const cls = `block min-w-0 rounded-2xl border p-4 shadow-[0_1px_2px_rgba(15,23,42,.04)] ${tone === 'alert' ? 'border-rose-200 bg-rose-50/70' : 'border-slate-200/80 bg-white'} ${href ? 'transition-colors hover:border-slate-300' : ''}`;
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 break-words text-[1.75rem] font-semibold leading-tight tracking-tight tabular-nums text-slate-900" data-tile={label}>{value}</p>
      {sub ? <p className="mt-0.5 text-xs leading-snug text-slate-500">{sub}</p> : null}
      {spark && spark.length > 1 ? <div className="mt-2"><Sparkline values={spark} color={sparkColor ?? palette.booked} height={28} /></div> : null}
    </>
  );
  return href ? <a href={href} className={cls} title={hint}>{body}</a> : <div className={cls} title={hint}>{body}</div>;
}

const SCROLL = 'max-h-[60vh] touch-pan-y overflow-y-auto overscroll-y-contain sm:max-h-[520px]';

function QueueRow({ r, metric }: { r: NonNullable<Dashboard['needsCallback']>['rows'][number]; metric: 'leads' | 'invoices' }) {
  const out = splitUnavailable(r.outreach);
  return (
    <li className="py-2.5 pr-1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="break-words font-semibold text-slate-900">{r.name || <a href={`tel:${r.phone}`}>{r.phone}</a>}</div>
          <div className="break-words text-sm text-slate-600">{r.name ? <><a href={`tel:${r.phone}`}>{r.phone}</a> · </> : null}{metric === 'invoices' ? (r.invoiceNumber ? `Invoice #${r.invoiceNumber}` : 'Invoice # unavailable') : r.line} · {r.outcome}</div>
          {metric === 'invoices' && r.balance != null && r.balance > 0 ? <div className="mt-1 text-xs font-semibold tabular-nums text-amber-800">Owes {usd(r.balance, Number.isInteger(r.balance) ? 0 : 2)}</div> : null}
          {metric === 'invoices' ? <div className="mt-1 text-xs text-slate-600">{r.daysPastDue == null ? (r.pastDue ? 'Past due (due date unavailable)' : 'Due date unavailable') : r.daysPastDue === 0 ? 'Not past due' : `${r.daysPastDue} ${r.daysPastDue === 1 ? 'day' : 'days'} past due`}</div> : null}
          {r.calledAfter ? <div className="mt-1 text-xs font-medium text-sky-800">{r.calledAfter}</div> : null}
          {r.mike ? <MikeLine text={r.mike} dark={false} /> : null}
          {out.text ? <OutreachLine text={out.text} cold={r.goingCold} dark={false} /> : null}
          {metric === 'invoices' ? <InvoiceEmails emails={r.collectionEmails} dark={false} /> : null}
        </div>
        <span className="shrink-0 text-sm tabular-nums text-slate-600">{feedTime(r.at)}</span>
      </div>
    </li>
  );
}

function missingNotice(rows: Array<{ outreach?: string | null }>): string | null {
  const set = new Set<string>();
  for (const r of rows) for (const m of splitUnavailable(r.outreach).missing) set.add(m);
  if (!set.size) return null;
  const list = Array.from(set);
  return `${list.join(', ').replace(/^./, (c) => c.toUpperCase())}${list.length === 1 ? ' for every row' : ' for every row'}: those counts may be low.`;
}

export function splitByAge<T extends { at: string }>(rows: T[], nowMs: number, days = OLDER_DAYS): { recent: T[]; older: T[] } {
  const cut = nowMs - days * DAY_MS;
  const recent = rows.filter((r) => Date.parse(r.at) >= cut).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const older = rows.filter((r) => !(Date.parse(r.at) >= cut));
  return { recent, older };
}

function NeedsCallbackCard({ view, rangeLabel }: { view: Dashboard['needsCallback']; rangeLabel: string }) {
  const [showOlder, setShowOlder] = useState(false);
  const rows = view?.rows ?? [];
  const { recent, older } = splitByAge(rows, Date.now());
  const notice = missingNotice(rows);
  return (
    <Card title={`Needs callback${view ? ` · ${view.count}` : ''}`} subtitle={`New leads (missed, voicemail, Mike) · ${rangeLabel} · newest first; older than ${OLDER_DAYS} days collapsed`} right={<span className="cursor-help text-xs text-slate-400" title={`${OUTREACH_TIP}\nSkips hang-ups under 10s, spam, vendors, AI bookings, dismissed leads, and any Jobber request, quote, job, visit or invoice on or after the call.`}>ⓘ</span>} delay={40}>
      <p className="sr-only" data-needs-callback-count={view ? view.count : undefined}>{view?.count}</p>
      {notice ? <p className="mb-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-500">{notice}</p> : null}
      <div className={SCROLL} data-scroll="needs-callback">
        {recent.length === 0 ? <p className="py-3 text-sm text-slate-500">{view ? `No new leads from the last ${OLDER_DAYS} days waiting on a callback.` : ' '}</p> : (
          <ul className="divide-y divide-slate-200">{recent.map((r, i) => <QueueRow key={`${r.at}-${r.phone}-${i}`} r={r} metric="leads" />)}</ul>
        )}
        {older.length ? (
          <div className="border-t border-slate-200 pt-2">
            <button type="button" onClick={() => setShowOlder((v) => !v)} className="text-sm font-semibold text-slate-700 underline decoration-dotted underline-offset-2" aria-expanded={showOlder}>
              {showOlder ? 'Hide' : 'Show'} {older.length} older than {OLDER_DAYS} days
            </button>
            {showOlder ? <ul className="mt-1 divide-y divide-slate-200 opacity-90">{older.map((r, i) => <QueueRow key={`o-${r.at}-${r.phone}-${i}`} r={r} metric="leads" />)}</ul> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

type MergedCall = { at: string; feed: FeedRow | null; rec: RecordedCall | null };
const d10 = (p: string | null | undefined) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : null; };
/** One list: every feed call, with its recording (summary box + transcript) attached when the same number called within 15 minutes. */
export function mergeCalls(feed: FeedRow[], recorded: RecordedCall[]): MergedCall[] {
  const used = new Set<string>();
  const out: MergedCall[] = feed.map((f) => {
    const p = d10(f.phone); const t = Date.parse(f.at);
    const rec = recorded.find((r) => !used.has(r.call_sid) && d10(r.caller_number) === p && Math.abs(Date.parse(r.started_at) - t) <= 15 * 60_000) ?? null;
    if (rec) used.add(rec.call_sid);
    return { at: f.at, feed: f, rec };
  });
  // Every recorded call stays, even older than the feed's last row (the old transcripts card listed the latest 25).
  for (const r of recorded) if (!used.has(r.call_sid)) out.push({ at: r.started_at, feed: null, rec: r });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

const CALL_FILTERS = [['all', 'All'], ['missed', 'Missed'], ['mike', 'Mike'], ['follow', 'Follow up']] as const;
type CallFilter = (typeof CALL_FILTERS)[number][0];
function matchesFilter(c: MergedCall, f: CallFilter): boolean {
  const o = c.feed?.outcome ?? (c.rec?.answered === false ? 'Missed' : 'Answered');
  if (f === 'missed') return o === 'Missed' || o === 'Voicemail';
  if (f === 'mike') return o.startsWith('Mike');
  if (f === 'follow') return !!c.rec?.needs_followup || !!c.feed?.goingCold || /^No callback/.test(c.feed?.callback ?? '');
  return true;
}

function CallsCard({ feed, recorded }: { feed: FeedRow[] | null | undefined; recorded: RecordedCall[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<CallFilter>('all');
  const all = mergeCalls(feed ?? [], recorded);
  const list = all.filter((c) => matchesFilter(c, filter));
  return (
    <Card title="Calls · summaries & transcripts" subtitle="All incoming (Voice main/Ransom, tracking numbers, Mike) · last 60 + every recorded call (latest 25) · tap a call for its summary and transcript" delay={60}>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Call filter">
        {CALL_FILTERS.map(([v, l]) => <button key={v} role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium ${filter === v ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>{l}</button>)}
      </div>
      {feed == null && !recorded.length ? <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Call feed unavailable</div> : null}
      <ul className={`${SCROLL} -mx-1 divide-y divide-slate-100`} data-scroll="calls">
        {list.length === 0 && (feed != null || recorded.length) ? <li className="px-1 py-8 text-center text-sm text-slate-500">No calls match</li> : null}
        {list.map((c, i) => {
          const f = c.feed, r = c.rec;
          const id = r?.call_sid ?? `${c.at}-${i}`;
          const sm = r ? splitSummary(r.summary) : null;
          const name = f?.name || r?.caller_name || null;
          const phone = f?.phone || fmtPhone(r?.caller_number ?? null);
          const line = f?.line || (r?.source ? SOURCE_LABEL[r.source] ?? r.source : '');
          const outcome0 = f?.outcome ?? (r?.answered === false ? 'Missed' : 'Answered');
          const stuck = !!(r && r.processing_status === 'pending' && !r.dial_status && Date.now() - Date.parse(r.started_at) > 30 * 60_000);
          const summary = sm?.text || f?.summary || (stuck ? 'No recording or summary: Twilio never sent this call\'s final status, so it was never processed.' : r && r.processing_status !== 'done' ? `(${r.processing_status})` : '');
          const outcome = stuck && outcome0 === 'Answered' ? 'Status unknown' : outcome0;
          const expandable = !!(r && (sm?.box.length || r.transcript));
          const isOpen = open === id;
          const who = name || phone;
          return (
            <li key={id} className={`px-1 py-3 ${outcome === 'Missed' ? 'bg-rose-50/70' : ''}`}>
              <button type="button" disabled={!expandable} onClick={() => setOpen(isOpen ? null : id)} className={`flex w-full min-w-0 flex-col gap-2 text-left ${expandable ? 'cursor-pointer' : 'cursor-default'}`} aria-expanded={expandable ? isOpen : undefined}>
                <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <span className="text-sm tabular-nums text-slate-500">{feedTime(c.at)} · {fmtDur(f?.durationSeconds ?? r?.duration_seconds ?? null)}</span>
                  <span className="flex max-w-full flex-wrap items-center gap-1 text-xs">
                    <OutcomePill o={outcome} by={f?.answeredBy} />
                    {r?.processing_error === 'note posted' ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Jobber note</span> : null}
                    {r?.outcome ? <span className={`rounded-full px-2 py-0.5 font-semibold ${r.outcome === 'booked' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{r.outcome.replace(/_/g, ' ')}</span> : null}
                    {r?.needs_followup ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">follow up</span> : null}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900" title={who}>{who}</span>
                  <span className="block truncate text-sm text-slate-600" title={`${phone}${line ? ` · ${line}` : ''}`}>{name ? `${phone} · ` : ''}{line}</span>
                  {summary ? <span className="mt-1 block break-words text-sm leading-snug text-slate-700">{summary}</span> : null}
                  {f?.callback ? <CallbackLine text={f.callback} dark={false} /> : null}
                  {f?.mike ? <MikeLine text={f.mike} dark={false} /> : null}
                  {f?.outreach ? <OutreachLine text={f.outreach} cold={f.goingCold} dark={false} /> : null}
                  {expandable ? <span className="mt-1.5 inline-flex min-h-11 items-center text-sm font-medium text-sky-800">{isOpen ? 'Hide summary & transcript' : 'Summary & transcript'}</span> : null}
                </span>
              </button>
              {isOpen && r ? (
                <div>
                  {sm?.box.length ? (
                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border border-sky-200 bg-sky-50 p-4 text-[15px] sm:grid-cols-[auto_1fr]">
                      {sm.box.map(([k, v]) => <div key={k} className="contents"><dt className="font-semibold text-sky-900">{k}</dt><dd className="break-words text-slate-800">{v}</dd></div>)}
                    </dl>
                  ) : null}
                  {r.transcript ? <Transcript text={r.transcript} /> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function InvoiceFollowUpCard({ view, rangeLabel }: { view: Dashboard['invoiceFollowUp']; rangeLabel: string }) {
  const [showNotDue, setShowNotDue] = useState(false);
  const rows = view?.rows ?? [];
  const late = rows.filter((r) => r.pastDue);
  const notDue = rows.filter((r) => !r.pastDue);
  const notice = missingNotice(rows);
  const money = (n: number | null | undefined) => (n == null ? '—' : usd(n, Number.isInteger(n) ? 0 : 2));
  return (
    <Card title="Invoice follow-up" subtitle={`Every open Jobber invoice · ${rangeLabel} · past due = due date before today (PT). Calls are shop Voice lines since the invoice date; emails count when they cite the invoice, amount due, or a pay link.`} delay={40}>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-rose-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">Past due</p><p className="text-3xl font-extrabold tabular-nums" data-invoice-follow-up-count={view ? late.length : undefined}>{view ? late.length : '—'}</p><p className="text-sm font-semibold tabular-nums text-rose-800" data-past-due-owed>{money(view?.pastDue?.owed)}</p></div>
        <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-600">Not yet due</p><p className="text-3xl font-extrabold tabular-nums">{view ? notDue.length : '—'}</p><p className="text-sm font-semibold tabular-nums text-slate-700">{money(view?.notDue?.owed)}</p></div>
        <div className="rounded-xl bg-amber-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">All open</p><p className="text-3xl font-extrabold tabular-nums">{view ? view.count : '—'}</p><p className="text-sm font-semibold tabular-nums text-amber-800">{money(view?.totalOwed)}</p></div>
      </div>
      {notice ? <p className="mb-2 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-500" data-unavailable-notice>{notice}</p> : null}
      <div className={SCROLL} data-scroll="invoices">
        {late.length === 0 ? <p className="py-3 text-sm text-slate-500">{view ? 'No past-due invoices.' : ' '}</p> : <ul className="divide-y divide-slate-200">{late.map((r, i) => <QueueRow key={`${r.at}-${r.invoiceNumber ?? ''}-${i}`} r={r} metric="invoices" />)}</ul>}
        {notDue.length ? (
          <div className="border-t border-slate-200 pt-2">
            <button type="button" onClick={() => setShowNotDue((v) => !v)} className="text-sm font-semibold text-slate-700 underline decoration-dotted underline-offset-2" aria-expanded={showNotDue}>{showNotDue ? 'Hide' : 'Show'} {notDue.length} not yet due</button>
            {showNotDue ? <ul className="mt-1 divide-y divide-slate-200">{notDue.map((r, i) => <QueueRow key={`n-${r.at}-${r.invoiceNumber ?? ''}-${i}`} r={r} metric="invoices" />)}</ul> : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AdPerformanceCard({ data, rangeLabel, moneyLabel }: { data: Dashboard; rangeLabel: string; moneyLabel: string }) {
  const t = data.totals; const prev = data.previous; const ro = data.roas;
  const w = data.weekly?.totals ?? null;
  const cab = w?.closingByAd;
  const cats = w?.byCategory;
  const quoteRate = (sent?: number | null, approved?: number | null) => (sent ? `${pct((approved ?? 0) / sent)} (${approved ?? 0}/${sent})` : '—');
  const stat = (label: string, value: string, sub?: React.ReactNode, hint?: string) => (
    <div className="min-w-0 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3" title={hint}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="break-words text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {sub ? <div className="mt-0.5 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
  return (
    <Card title="Ad performance" subtitle={`The one place for return on ad spend and close rates · calls ${rangeLabel} · money ${moneyLabel}`} delay={40}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stat('ROAS (new customers)', ro ? mult(ro.newOnly.multipleInvoiced) : '—', ro ? <>{usd(ro.newOnly.invoiced)} invoiced ÷ {usd(ro.spend)} spend · All ad callers <b className="text-slate-700">{mult(ro.overall.multipleInvoiced)}</b></> : 'Jobber invoices did not load', 'Jobber invoices to new customers who called an ad ÷ Google Ads spend')}
        {stat('Ad spend', usd(t.spend), <><Delta cur={t.spend} prev={prev?.spend} goodWhenUp={false} /> <span className="block">{usd(t.costPerCall, 2)}/ad call · {usd(t.costPerBooked)}/new booking</span></>)}
        {stat('Ad + Mike calls', String(t.calls), <><Delta cur={t.calls} prev={prev?.calls} /> <span className="block">{t.answered} answered · {t.missedOrShort} missed/short</span></>, 'Google Ads tracked calls + calls answered by Mike (AI receptionist). Main/Ransom/GBP lines answered by staff are not included (Voice history starts Oct 3).')}
        {stat('Call to booking (real leads)', pct(w?.closingRate), w ? `${w.bookedCalls ?? 0} new booked / ${w.calls} real leads` : undefined, leadsHint(data.realLeads))}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200/80 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Close rates by type · {w?.label ?? rangeLabel}</p>
          <table className="w-full text-left text-xs sm:text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-slate-500"><th className="py-1 font-semibold">Type</th><th className="py-1 text-right font-semibold" title="new bookings ÷ real new leads of that type">Call to booking</th><th className="py-1 text-right font-semibold" title="Cohort: quotes sent in the range that are approved/converted as of now">Quote close rate</th></tr></thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              <tr><td className="py-2 font-medium">All</td><td className="py-2 text-right">{pct(w?.closingRate)}</td><td className="py-2 text-right">{quoteRate(w?.quotesSent, w?.quotesSentApproved)}</td></tr>
              <tr><td className="py-2 font-medium text-sky-800">Pump &amp; service</td><td className="py-2 text-right">{cab?.pump ? `${pct(cab.pump.closingRate)} (${cab.pump.booked}/${cab.pump.calls})` : '—'}</td><td className="py-2 text-right">{quoteRate(cats?.pump?.quotesSent, cats?.pump?.quotesSentApproved)}</td></tr>
              <tr><td className="py-2 font-medium text-amber-800">Drilling</td><td className="py-2 text-right">{cab?.drilling ? `${pct(cab.drilling.closingRate)} (${cab.drilling.booked}/${cab.drilling.calls})` : '—'}</td><td className="py-2 text-right">{quoteRate(cats?.drilling?.quotesSent, cats?.drilling?.quotesSentApproved)}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="rounded-xl border border-slate-200/80 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Conversion funnel · new-customer jobs credited to a call · {rangeLabel}</p>
          <Funnel stages={[
            { label: 'Ad + Mike calls', value: data.funnel?.calls ?? t.calls, color: palette.answered },
            ...(data.realLeads ? [{ label: 'Real new leads', value: data.realLeads.leads, color: palette.answered }] : []),
            { label: 'Booked jobs (new)', value: data.funnel?.booked ?? t.bookedNew, color: palette.booked },
            { label: `New customers invoiced${ro ? ` · ${usd(ro.newOnly.invoiced)}` : ''}`, value: ro ? ro.newOnly.clients : null, color: palette.revenue },
            { label: 'Paid in full', value: ro ? ro.newOnly.paidClients ?? null : null, color: palette.paid },
          ]} />
          <p className="mt-2 text-[11px] text-slate-400">{data.funnel?.adCalls != null ? `${data.funnel.adCalls} Google Ads + ${data.funnel.calls - data.funnel.adCalls} Mike calls · ${data.funnel.uniqueCallers ?? '—'} unique callers · ` : ''}invoiced/paid = same new-customer set and dollars as ROAS (new customers)</p>
        </div>
      </div>
      {data.adSplit ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pump vs drilling (Google Ads campaigns)</p>
          <AdSplitBlocks split={data.adSplit} />
          <p className="mt-2 text-[11px] text-amber-600">Drilling return is early: drilling jobs invoice weeks to months after the call, so expect it to rise. Spend and clicks come straight from Google Ads; calls are Google Ads calls only.</p>
        </div>
      ) : null}
      {ro ? <details className="mt-3 text-[11px] text-slate-400"><summary className="cursor-pointer">How it is counted</summary><ul className="mt-1 list-disc space-y-0.5 pl-4">{ro.method.filter((m) => !m.startsWith('Paid')).map((m) => <li key={m}>{m}</li>)}<li>{leadsHint(data.realLeads).split('\n')[0]}</li></ul></details> : null}
    </Card>
  );
}

function LeadsBySourceTable({ data, rangeLabel, moneyLabel }: { data: Dashboard; rangeLabel: string; moneyLabel: string }) {
  type R = { key: string; label: string; numbers: string; calls: number; callers?: number; detail?: string; forms: string; formsSplit?: string; booked: number | null; bookedSplit?: string; spend: number | null; note?: string | null };
  const split = (x: { pump: number; drilling: number }) => `pump ${x.pump} · drilling ${x.drilling}`;
  const rows: R[] = [];
  for (const g of data.byCampaign ?? []) {
    const detail = `${g.answered} answered · ${g.short} short${g.costPerCall != null ? ` · ${usd(g.costPerCall, 2)}/call` : ''}`;
    if (/^not from ads$/i.test(g.key)) { rows.push({ key: 'not-ads', label: 'Not from ads (all other lines)', numbers: 'Main, Ransom, Mike and the tracking numbers below', calls: g.calls, detail, forms: '—', booked: g.booked, spend: null }); continue; }
    rows.push({ key: `ads-${g.key}`, label: `Google Ads · ${g.key}`, numbers: 'Google forwarding numbers', calls: g.calls, detail, forms: '—', booked: g.booked, spend: g.spend });
  }
  for (const c of data.sourceCards ?? []) {
    rows.push({ key: c.key, label: c.label, numbers: c.numbers.length ? c.numbers.join(' · ') : 'No tracking number yet', calls: c.calls, callers: c.callers, forms: String(c.forms.total), formsSplit: c.forms.total ? split(c.forms) : undefined, booked: c.booked.total, bookedSplit: c.booked.total ? split(c.booked) : undefined, spend: null, note: c.note });
  }
  const cells = (r: R) => [
    ['Calls', <>{r.calls}{r.callers != null && r.calls ? <span className="block text-[11px] font-normal text-slate-400">{r.callers} caller{r.callers === 1 ? '' : 's'}</span> : null}{r.detail ? <span className="block text-[11px] font-normal text-slate-400">{r.detail}</span> : null}</>],
    ['Forms', <>{r.forms}{r.formsSplit ? <span className="block text-[11px] font-normal text-slate-400">{r.formsSplit}</span> : null}</>],
    ['Booked', r.booked == null ? '—' : r.booked ? <b className="text-emerald-700">{r.booked}</b> : <span className="text-slate-400">0</span>],
    ['Spend', r.spend == null ? '—' : usd(r.spend)],
    ['$ / booking', r.spend != null && r.booked ? usd(r.spend / r.booked) : '—'],
  ] as const;
  return (
    <Card title="Leads by source" subtitle={`Every lead source in one table · calls ${rangeLabel} · Google Ads spend ${moneyLabel}. Booked excludes internal, training, and test jobs.`} delay={80}>
      {rows.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No source data</div> : (
        <>
          <ul className="space-y-3 md:hidden">
            {rows.map((r) => (
              <li key={r.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="truncate font-semibold text-slate-900" title={r.label}>{r.label}</p>
                <p className="truncate text-[11px] text-slate-500" title={r.numbers}>{r.numbers}</p>
                {r.note ? <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{r.note}</p> : null}
                {r.bookedSplit ? <p className="mt-1 text-[11px] text-slate-400">Booked {r.bookedSplit}</p> : null}
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm tabular-nums">
                  {cells(r).map(([k, v]) => <div key={k} className="flex items-baseline justify-between gap-2"><dt className="text-[11px] uppercase tracking-wider text-slate-500">{k}</dt><dd className="text-right font-semibold text-slate-900">{v}</dd></div>)}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden max-h-[32rem] overflow-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-white"><tr className="text-[11px] uppercase tracking-wider text-slate-500"><th className="bg-white py-2 pr-3 font-semibold">Source</th><th className="bg-white py-2 pr-3 text-right font-semibold">Calls</th><th className="bg-white py-2 pr-3 text-right font-semibold">Forms</th><th className="bg-white py-2 pr-3 text-right font-semibold">Booked</th><th className="bg-white py-2 pr-3 text-right font-semibold">Spend</th><th className="bg-white py-2 text-right font-semibold">$ / booking</th></tr></thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {rows.map((r) => (
                  <tr key={r.key} className="align-top">
                    <td className="max-w-[16rem] py-2.5 pr-3"><div className="truncate font-medium text-slate-900" title={r.label}>{r.label}</div><div className="truncate text-[11px] text-slate-500" title={r.numbers}>{r.numbers}</div>{r.note ? <div className="mt-0.5 text-[11px] leading-snug text-slate-400">{r.note}</div> : null}</td>
                    <td className="py-2.5 pr-3 text-right">{r.calls}{r.callers != null && r.calls ? <span className="block text-[11px] text-slate-400">{r.callers} caller{r.callers === 1 ? '' : 's'}</span> : null}{r.detail ? <span className="block text-[11px] text-slate-400">{r.detail}</span> : null}</td>
                    <td className="py-2.5 pr-3 text-right">{r.forms}{r.formsSplit ? <span className="block text-[11px] text-slate-400">{r.formsSplit}</span> : null}</td>
                    <td className="py-2.5 pr-3 text-right">{r.booked == null ? '—' : r.booked ? <b className="text-emerald-700">{r.booked}</b> : <span className="text-slate-400">0</span>}{r.bookedSplit ? <span className="block text-[11px] text-slate-400">{r.bookedSplit}</span> : null}</td>
                    <td className="py-2.5 pr-3 text-right">{r.spend == null ? '—' : usd(r.spend)}</td>
                    <td className="py-2.5 text-right">{r.spend != null && r.booked ? usd(r.spend / r.booked) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="mt-2 text-[11px] leading-snug text-slate-400">Google Ads rows: calls to Google forwarding numbers, booked = new customers (same as Ad performance). Other rows: calls to that source&apos;s tracking number, forms = website requests whose first visit came from that source, booked = a Jobber job created within 30 days of that caller&apos;s or form&apos;s first contact (site walks excluded); drilling vs pump from the job title, forms by the service picked.</p>
    </Card>
  );
}

const TRACKING_LABEL: Record<string, string> = { AD: 'Google Ads · ad call extension', LANDING_PAGE: 'Google Ads · website (landing page) number', 'Unknown (AI-handled)': 'Mike (AI), line unknown' };
function GroupTable({ title, subtitle, rows, label }: { title: string; subtitle: string; rows: GroupRow[]; label?: (k: string) => string }) {
  const maxCalls = Math.max(...rows.map((r) => r.calls), 1);
  const nameOf = (r: GroupRow) => label ? label(r.key) : r.key;
  return (
    <Card title={title} subtitle={subtitle} delay={90}>
      {rows.length === 0 ? <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No calls in this range</div> : (
        <>
          <ul className="space-y-3 sm:hidden">
            {rows.map((r) => (
              <li key={r.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="truncate font-medium text-slate-800" title={r.key}>{nameOf(r)}</p>
                <div className="mt-1 h-1 w-full rounded bg-slate-200"><div className="h-1 rounded bg-sky-500" style={{ width: `${(r.calls / maxCalls) * 100}%` }} /></div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-sm tabular-nums">
                  {([['Calls', r.calls], ['Answered', r.answered], ['Short', r.short], ['New booked', r.booked ? r.booked : 0]] as const).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2"><dt className="text-[11px] uppercase tracking-wider text-slate-500">{k}</dt><dd className={`font-semibold ${k === 'New booked' && v ? 'text-emerald-700' : 'text-slate-900'}`}>{v}</dd></div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden max-h-[28rem] overflow-auto sm:block">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-white"><tr className="text-[11px] uppercase tracking-wider text-slate-500"><th className="bg-white py-2 pr-3 font-semibold">Name</th><th className="bg-white py-2 pr-3 text-right font-semibold">Calls</th><th className="bg-white py-2 pr-3 text-right font-semibold">Answered</th><th className="bg-white py-2 pr-3 text-right font-semibold">Short</th><th className="bg-white py-2 text-right font-semibold">New booked</th></tr></thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="max-w-[18rem] py-2.5 pr-3"><div className="truncate font-medium text-slate-800" title={r.key}>{nameOf(r)}</div>
                      <div className="mt-1 h-1 w-full rounded bg-slate-100"><div className="h-1 rounded bg-sky-500" style={{ width: `${(r.calls / maxCalls) * 100}%` }} /></div></td>
                    <td className="py-2.5 pr-3 text-right">{r.calls}</td>
                    <td className="py-2.5 pr-3 text-right">{r.answered}</td>
                    <td className="py-2.5 pr-3 text-right">{r.short}</td>
                    <td className="py-2.5 text-right">{r.booked ? <b className="text-emerald-700">{r.booked}</b> : <span className="text-slate-300">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function DataNotes({ gaps }: { gaps: string[] }) {
  return <details className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"><summary className="cursor-pointer font-medium text-slate-600">How it&apos;s counted / data notes</summary><ul className="mt-2 list-disc space-y-1 pl-5">{gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></details>;
}

export function CallDashboardPage() {
  const params = useSearchParams();
  const [range, setRangeState] = useState<string>('since');
  const rangeParam = params?.get('range');
  useEffect(() => { // honor ?range= (TV mode and old links carry it)
    if (rangeParam && RANGES.some((x) => x.v === rangeParam)) setRangeState(rangeParam);
  }, [rangeParam]);
  const setRange = (v: string) => {
    setRangeState(v);
    try { const u = new URL(window.location.href); u.searchParams.set('range', v); window.history.replaceState(window.history.state, '', u.toString()); } catch {}
  };
  const { data, error, loading, reload } = useDashboard(range, 30_000);
  const recorded = useRecordedCalls();
  // Old ?tab= links jump to that section of the single page.
  const tabParam = params?.get('tab');
  const jumped = useRef(false);
  useEffect(() => {
    if (!data || jumped.current) return;
    const target = tabParam && (SECTIONS as readonly string[]).includes(tabParam) ? tabParam : (typeof window !== 'undefined' ? window.location.hash.slice(1) : '');
    if (target && target !== 'today') { jumped.current = true; setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: 'start' }), 50); }
  }, [data, tabParam]);
  const t = data?.totals;
  const s = data?.series ?? [];
  const rangeLabel = RANGES.find((r) => r.v === range)?.label ?? '';
  // Spend, revenue and ROAS start at Sep 18 (closed-loop tracking start) even when the toggle reaches further back.
  const moneyLabel = data?.start && data?.revenueStart && Date.parse(data.start) < Date.parse(data.revenueStart) ? 'Since Sep 18 (tracking start)' : rangeLabel;
  const today = data?.callLog?.today;
  const nc = data?.needsCallback;
  const ncSplit = nc ? splitByAge(nc.rows, Date.now()) : null;
  const existingExcluded = data?.realLeads?.excluded.find((e) => e.reason === 'existing')?.count;
  const live = data as (Dashboard & Live) | null;
  return (
    <div className="min-w-0 space-y-5 overflow-x-clip text-slate-900 antialiased" data-tab="all">
      <style>{STYLES}</style>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="mr-auto min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">Office dashboard</h1>
          <p className="mt-0.5 text-sm text-slate-600">{rangeLabel}{moneyLabel !== rangeLabel ? ` · money ${moneyLabel}` : ''} · Pacific time</p>
          <div className="mt-2"><Freshness mirrorAsOf={live?.jobberDataAsOf} generatedAt={live?.generatedAt} /></div>
        </div>
        <LiveBadge at={live?.generatedAt} refreshMs={30_000} error={error} />
        <div className="flex w-full flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm sm:w-auto" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.v} role="tab" aria-selected={range === r.v} onClick={() => setRange(r.v)}
              className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium transition-colors ${range === r.v ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>{r.label}</button>
          ))}
        </div>
        <button onClick={reload} className="inline-flex min-h-11 items-center rounded-full border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50">Refresh</button>
      </div>

      {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span aria-hidden>⚠</span><span>{error}{data ? ' Showing the last data received.' : ''}</span></div> : null}
      {!data && !error ? <DashboardSkeleton /> : null}
      {!data && error ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">Nothing on screen until the dashboard loads. Tap Refresh to try again.</div> : null}

      {data && t ? (
        <div className={`space-y-8 transition-opacity duration-300 ${loading ? 'opacity-60' : 'opacity-100'}`}>
          <HeadlineKpis data={data} rangeLabel={rangeLabel} moneyLabel={moneyLabel} />

          <section className="space-y-4">
            <SectionHead id="today" title="Calls and leads" hint={`Today’s lines, callbacks still open, and the call list · ${rangeLabel}.`} />
            <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-4">
              <Tile label="Calls today" value={today ? String(today.total) : '—'} sub={today ? `${today.answered} answered · ${today.forwardedAi} to Mike · all incoming lines` : 'all incoming'} />
              <Tile label="Missed today" value={today ? String(today.missed) : '—'} sub="missed or voicemail, all lines" tone={today && today.missed > 0 ? 'alert' : 'plain'} />
              <Tile label="Needs callback" value={nc ? String(nc.count) : '—'} sub={ncSplit ? `${ncSplit.recent.length} in last ${OLDER_DAYS} days · ${ncSplit.older.length} older · ${rangeLabel}` : undefined} tone={ncSplit && ncSplit.recent.length > 0 ? 'alert' : 'plain'} />
              <Tile label="Booked (new customers)" value={String(t.bookedNew)}
                sub={`${rangeLabel}${data.tv ? ` · ${data.tv.bookedToday} today · ${data.tv.bookedWeek} this week` : ''}${data.realLeads ? ` · of ${data.realLeads.leads} real leads · ${existingExcluded ?? 0} existing-customer callers excluded` : ` · ${t.knownExisting} existing · ${t.unmatched} other`}`}
                spark={s.map((d) => d.booked)} sparkColor={palette.booked} hint="New-customer jobs booked per day (sparkline)" />
            </div>
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-5"><NeedsCallbackCard view={nc} rangeLabel={rangeLabel} /></div>
              <div className="min-w-0 lg:col-span-7"><CallsCard feed={data.callFeed} recorded={recorded} /></div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHead id="sales" title="Sales and revenue" hint="Invoices, cash collected, jobs, and quotes for the period above. Drilling is amber, pump is blue." />
            {data.weekly ? <WeeklySalesCard weekly={data.weekly} /> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Sales unavailable right now (Jobber data did not load). {data.gaps?.filter((g) => g.startsWith('weekly')).join(' ')}</div>}
          </section>

          <section className="space-y-4">
            <SectionHead id="ads" title="Marketing / ads" hint={`Return, spend, and where leads came from · calls ${rangeLabel} · money ${moneyLabel}.`} />
            <AdPerformanceCard data={data} rangeLabel={rangeLabel} moneyLabel={moneyLabel} />
            <Card title="Calls & ad spend per day" subtitle={`${rangeLabel} · bars: answered / missed or short calls · line: Google Ads spend`} right={<Legend items={[[palette.answered, 'Answered'], [palette.missed, 'Missed / short'], [palette.spend, 'Ad spend']]} />} delay={60}>
              <div className="min-w-0 overflow-hidden">
                {s.length ? <CallsSpendChart series={s} spendFrom={data.revenueStart ? ptKey(data.revenueStart) : null} /> : <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">No calls in this range</div>}
              </div>
            </Card>
            <LeadsBySourceTable data={data} rangeLabel={rangeLabel} moneyLabel={moneyLabel} />
            <div className="grid gap-4 lg:grid-cols-2">
              <GroupTable title="By keyword / ad group" subtitle={`Google Ads keyword or ad group of each call · ${rangeLabel}`} rows={data.byKeyword ?? []} />
              <GroupTable title="By tracking number / source" subtitle={`Which number or Google Ads asset the call came in on · ${rangeLabel}`} rows={data.byTrackingNumber ?? []} label={(k) => TRACKING_LABEL[k] ?? k} />
            </div>
          </section>

          <section className="space-y-4">
            <SectionHead id="collections" title="Collections" hint="Open invoices for the office. Nothing here is customer-facing." />
            <InvoiceFollowUpCard view={data.invoiceFollowUp} rangeLabel={rangeLabel} />
          </section>

          <DataNotes gaps={data.gaps} />
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
  // view=tv: the API strips collections and payment figures server-side (TV can be on a shop screen).
  const { data, error } = useDashboard(view, 60_000, 'tv');
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
  const mainRev = ro ? { invoiced: ro.newOnly.invoiced } : null; // one strict new-customer source; '—' on failure
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
          <LiveBadge dark large at={(data as (Dashboard & Live) | null)?.generatedAt} refreshMs={60_000} error={error} />
          <p className="order-first shrink-0 text-2xl font-bold tabular-nums sm:order-last xl:text-5xl">{clockStr}</p>
        </div>
      </div>
      <div className="flex justify-end"><Freshness dark mirrorAsOf={(data as (Dashboard & Live) | null)?.jobberDataAsOf} generatedAt={(data as (Dashboard & Live) | null)?.generatedAt} /></div>
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
            {ro ? <p className="text-sm text-slate-400 xl:text-xl">All ad callers <span className="font-semibold text-slate-200">{mult(ro?.overall.multipleInvoiced ?? null)}</span></p> : null}
          </div>
        </div>
      ) : null}
      {data?.weekly ? (() => {
        const ws = data.weekly.weeks; const w = data.weekly.totals ?? ws[ws.length - 1];
        const head = data.weekly.totals?.title ?? `This week to date ${w.label}`;
        const cell = (l: string, v: string, sub?: string) => (<div className="min-w-0"><p className="text-[10px] font-semibold uppercase leading-tight tracking-wider text-slate-500 xl:text-base">{l}</p><p className="whitespace-nowrap text-lg font-bold tabular-nums xl:text-2xl 2xl:text-3xl">{v}</p>{sub ? <p className="text-[10px] leading-tight text-slate-500 xl:text-base">{sub}</p> : null}</div>);
        return (
          <div className="grid shrink-0 grid-cols-2 items-start gap-x-4 gap-y-3 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:grid-cols-3 md:grid-cols-5 2xl:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] 2xl:items-end xl:gap-x-5 xl:px-6 xl:py-4" aria-label="Sales">
            <p className="col-span-full text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 xl:text-sm">Sales · {head} · bars: invoiced, last 9 weeks, Mon–Sun</p>
            {cell('Invoiced', usd(w.invoiced))}
            {cell('Jobs booked', w.jobsBooked == null ? '—' : String(w.jobsBooked))}
            {cell('Completed', w.jobsCompleted == null ? '—' : String(w.jobsCompleted))}
            {cell('Quotes sent', compactUsd(w.quotesSentValue), `${w.quotesSent ?? 0} quotes`)}
            {cell('Approved', compactUsd(w.quotesApprovedValue), `${w.quotesApproved ?? 0} quotes`)}
            {cell('Quote close rate', pct(w.quotesSent ? (w.quotesSentApproved ?? 0) / w.quotesSent : null), `${w.quotesSentApproved ?? 0}/${w.quotesSent ?? 0} sent, approved to date · ${w.quotesApproved ?? 0} approved this period`)}
            {cell('Call to booking (real leads)', pct(w.closingRate), `${w.bookedCalls ?? 0}/${w.calls} real leads`)}
            <div className="col-span-full mt-2 min-w-0 2xl:col-span-3"><WeeklyBars dark weeks={ws} height={56} showPaid={false} /></div>
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
          <p className="mb-2 text-[11px] text-slate-500 xl:text-sm">Missed, voicemail, and Mike · {mainRange}. Counts include Mike&apos;s automated callbacks. Personal cell calls are not logged.</p>
          <NeedsCallbackList dark view={data?.needsCallback} rangeLabel={mainRange} empty="No new leads waiting on a callback in this period." />
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:px-4 xl:px-6 xl:py-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 xl:text-base">Recent calls</p>
          {data?.callFeed ? <CallFeedTable dark rows={data.callFeed} max={6} /> : <p className="text-slate-500">{tv ? 'No recent calls' : ' '}</p>}
        </div>
      </div>
    </div>
  );
}
