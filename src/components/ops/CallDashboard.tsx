'use client';

import { useCallback, useEffect, useState } from 'react';
import { PhoneCallTranscripts } from './PhoneCallTranscripts';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';
import type { Dashboard, GroupRow } from '@/lib/ads/call-dashboard';
import {
  CallsPerDayChart, Funnel, Gauge, Sparkline, SpendRevenueChart, WeeklyBars, WeeklyCashBars, compactUsd, mult, palette, usd,
} from './call-dash/charts';

const KEY_STORAGE = 'quotes_gp_key';
const RANGES = [
  { v: '7', label: '7 days' }, { v: '30', label: '30 days' }, { v: '90', label: '90 days' }, { v: 'since', label: 'Since Sep 18' },
] as const;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—';

type Live = { generatedAt?: string };

function useDashboard(range: string, refreshMs: number | null) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get(QUOTES_GP_KEY_QUERY);
      if (q) { try { localStorage.setItem(KEY_STORAGE, q); } catch {} }
      let key = q; try { key = key || localStorage.getItem(KEY_STORAGE); } catch {}
      const res = await fetch(`/api/ops/call-dashboard?range=${range}`, {
        headers: key ? { [QUOTES_GP_KEY_HEADER]: key } : {}, cache: 'no-store',
      });
      if (!res.ok) throw new Error(res.status === 401 ? 'Not signed in. Log in to the CRM or open this page with your office key.' : `Error ${res.status}`);
      setData(await res.json()); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  }, [range]);
  useEffect(() => {
    setLoading(true);
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data, error, loading, reload: load };
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
@media (min-width:1024px){.cd-big{font-size:clamp(2.25rem,5.2vw,6rem)}}
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
      <p className="mt-0.5 min-h-[16px] truncate text-xs text-slate-500">{sub}</p>
      <div className="mt-auto pt-2">{spark ? <Sparkline values={spark} color={color} /> : <div className="h-9" />}</div>
    </div>
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

const th = 'sticky top-0 z-10 bg-slate-50/95 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 backdrop-blur';

function GroupTable({ title, rows, delay }: { title: string; rows: GroupRow[]; delay: number }) {
  const maxCalls = Math.max(...rows.map((r) => r.calls), 1);
  return (
    <section className="cd-rise overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,.04)]" style={{ animationDelay: `${delay}ms` }}>
      <h2 className="px-5 pb-2 pt-4 text-sm font-semibold text-slate-900">{title}</h2>
      <div className="max-h-[340px] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead><tr><th className={th}>Name</th><th className={`${th} text-right`}>Calls</th><th className={`${th} text-right`}>Booked</th><th className={`${th} text-right`}>Invoiced</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? <tr><td colSpan={4} className="px-5 py-8 text-center text-sm text-slate-400">No calls in this range</td></tr> : rows.slice(0, 15).map((r) => (
              <tr key={r.key} className="transition-colors hover:bg-slate-50/80">
                <td className="max-w-[9rem] px-3 py-2 xl:max-w-[11rem]"><div className="truncate font-medium text-slate-800" title={r.key}>{r.key}</div>
                  <div className="mt-1 h-1 w-full rounded bg-slate-100"><div className="h-1 rounded" style={{ width: `${(r.calls / maxCalls) * 100}%`, background: palette.revenue, opacity: 0.7 }} /></div></td>
                <td className="px-3 py-2 text-right tabular-nums" title={`${r.answered} answered · ${r.short} short · ${usd(r.costPerCall, 2)}/call`}>{r.calls}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.booked ? <span className="font-semibold text-emerald-700">{r.booked}</span> : <span className="text-slate-300">0</span>}</td>
                
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">{usd(r.invoiced)}</td>
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

function WeeklySalesCard({ weekly }: { weekly: NonNullable<Dashboard['weekly']> }) {
  const w = weekly.weeks[weekly.weeks.length - 1];
  const prev = weekly.weeks[weekly.weeks.length - 2];
  const first = weekly.weeks[0];
  const rows: Array<[string, string, string?]> = [
    ['Jobs booked', w.jobsBooked == null ? '—' : String(w.jobsBooked), 'jobs created'],
    ['Jobs completed', w.jobsCompleted == null ? '—' : String(w.jobsCompleted), 'finished'],
    ['Quotes sent', compactUsd(w.quotesSentValue), `${w.quotesSent ?? 0} quotes sent this week`],
    ['Quotes approved', compactUsd(w.quotesApprovedValue), `${w.quotesApproved ?? 0} of those sent`],
    ['Closing rate', pct(w.closingRate), `${w.bookedCalls ?? 0} booked / ${w.calls} calls`],
    ['Last full week', usd(prev?.invoiced), prev?.label],
  ];
  return (
    <Card title="Weekly sales" subtitle={`This week to date: ${w.label} · last 8 weeks ${first.label.split('–')[0]}–${prev?.label.split('–')[1] ?? ''} (Mon–Sun, PT)`} right={<Legend items={[[palette.revenue, 'Invoiced'], [palette.paid, 'Paid on invoices / cash']]} />} delay={90}>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl bg-indigo-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Invoiced this week</p><p className="whitespace-nowrap text-3xl font-extrabold tabular-nums text-slate-900 sm:text-4xl">{usd(w.invoiced)}</p><p className="text-xs text-slate-500">{w.label} · {w.invoiceCount ?? 0} invoices, pre-tax</p></div>
        <div className="min-w-0 rounded-xl bg-teal-50 px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-teal-700">Paid on this week&apos;s invoices</p><p className="whitespace-nowrap text-3xl font-extrabold tabular-nums text-slate-900 sm:text-4xl">{usd(w.paid)}</p><p className="text-xs text-slate-500">invoices issued {w.label}</p></div>
        <div className="col-span-2 min-w-0 rounded-xl bg-emerald-50 px-4 py-3 sm:col-span-1"><p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Cash collected this week</p><p className="whitespace-nowrap text-3xl font-extrabold tabular-nums text-slate-900 sm:text-4xl">{usd(w.cash)}</p><p className="text-xs text-slate-500">payments received {w.label} · {w.cashCount ?? 0} payments, any invoice</p></div>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4 lg:col-span-3">
          {rows.map(([label, value, sub]) => (
            <div key={label} className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
              <p className="whitespace-nowrap text-lg font-bold tabular-nums text-slate-900">{value}</p>
              <p className="truncate text-[11px] text-slate-400">{sub}</p>
            </div>
          ))}
        </div>
        <div className="min-w-0 lg:col-span-2"><p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Invoiced (bar) · paid on those invoices (teal)</p><WeeklyBars weeks={weekly.weeks} /><p className="mb-0.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cash collected by payment date</p><WeeklyCashBars weeks={weekly.weeks} /></div>
      </div>
      <details className="mt-3 text-[11px] text-slate-400"><summary className="cursor-pointer">Sources &amp; definitions</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">{weekly.sources.map((x) => <li key={x}>{x}</li>)}{weekly.gaps.map((x) => <li key={x} className="text-amber-600">{x}</li>)}</ul>
      </details>
    </Card>
  );
}

export function CallDashboardPage() {
  const [range, setRange] = useState<string>('since');
  const { data, error, loading, reload } = useDashboard(range, 30_000);
  const t = data?.totals;
  const s = data?.series ?? [];
  const prev = data?.previous;
  const rangeLabel = RANGES.find((r) => r.v === range)?.label ?? '';
  const calls = s.map((d) => d.answered + d.missed);
  return (
    <div className="mx-auto max-w-[1400px] space-y-5 text-slate-900 antialiased">
      <style>{STYLES}</style>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="mr-auto">
          <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Call performance</h1>
          <p className="text-xs text-slate-500">Google Ads calls, AI receptionist and closed-loop revenue · Pacific time</p>
        </div>
        <LiveBadge at={(data as (Dashboard & Live) | null)?.generatedAt} refreshMs={30_000} error={error} />
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-0.5 shadow-sm" role="tablist" aria-label="Date range">
          {RANGES.map((r) => (
            <button key={r.v} role="tab" aria-selected={range === r.v} onClick={() => setRange(r.v)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors sm:text-sm ${range === r.v ? 'bg-slate-900 text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}>{r.label}</button>
          ))}
        </div>
        <button onClick={reload} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:text-sm">Refresh</button>
        <a href="/ops/calls/tv" className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-700 sm:text-sm">TV mode ↗</a>
      </div>

      {error ? <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span aria-hidden>⚠</span><span>{error}{data ? ' Showing the last data received.' : ''}</span></div> : null}
      {!data && !error ? <DashboardSkeleton /> : null}

      {data && t ? (
        <div className={`space-y-5 transition-opacity duration-300 ${loading ? 'opacity-60' : 'opacity-100'}`}>
          {data.weekly ? <WeeklySalesCard weekly={data.weekly} /> : <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Weekly sales unavailable right now (Jobber data did not load). {data.gaps?.filter((g) => g.startsWith('weekly')).join(' ')}</div>}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi delay={0} color={palette.answered} label="Calls" range={rangeLabel} value={String(t.calls)} sub={`${t.answered} answered · ${t.missedOrShort} missed/short`} spark={calls} delta={<Delta cur={t.calls} prev={prev?.calls} />} />
            <Kpi delay={40} color={palette.booked} label="Booked (new customers)" range={rangeLabel} value={String(t.bookedNew)} sub={`${t.knownExisting} existing · ${t.unmatched} other`} spark={s.map((d) => d.booked)} />
            <Kpi delay={80} color={palette.spend} label="Ad spend" range={rangeLabel} value={usd(t.spend)} sub={`${usd(t.costPerCall, 2)}/call · ${usd(t.costPerBooked)}/booked`} spark={s.map((d) => d.spend ?? 0)} delta={<Delta cur={t.spend} prev={prev?.spend} goodWhenUp={false} />} />
            <Kpi delay={120} color={palette.revenue} label="Return (invoiced / paid)" range={rangeLabel} hint="paid = collected so far; invoiced = billed, whether or not collected yet" value={`${mult(t.multipleInvoiced)} / ${mult(t.multiplePaid)}`} sub="revenue ÷ ad spend" />
            <Kpi delay={160} color={palette.booked} label="Booked value" range={rangeLabel} value={usd(t.bookedValue)} sub={`${usd(t.perCall.booked, 2)}/call`} />
            <Kpi delay={200} color={palette.revenue} label="Quote value" range={rangeLabel} value={usd(t.quoteValue)} sub={`${usd(t.perCall.quote, 2)}/call`} />
            <Kpi delay={240} color={palette.revenue} label="Invoiced" range={rangeLabel} hint="paid = collected so far; invoiced = billed, whether or not collected yet" value={usd(t.invoicedValue)} sub={`${usd(t.perCall.invoiced, 2)}/call`} spark={s.map((d) => d.invoiced)} />
            <Kpi delay={280} color={palette.paid} label="Paid" range={rangeLabel} hint="paid = collected so far; invoiced = billed, whether or not collected yet" value={usd(t.paidValue)} sub={t.paidValue != null && t.invoicedValue ? `${Math.round((t.paidValue / t.invoicedValue) * 100)}% of invoiced` : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Calls per day" subtitle={rangeLabel} right={<Legend items={[[palette.answered, 'Answered'], [palette.missed, 'Missed / short']]} />} delay={60}>
              {s.length ? <CallsPerDayChart series={s} /> : <p className="py-16 text-center text-sm text-slate-400">No data</p>}
            </Card>
            <Card title="Ad spend vs revenue" subtitle="Daily spend and invoiced revenue from new-customer bookings" right={<Legend items={[[palette.spend, 'Spend'], [palette.revenue, 'Invoiced']]} />} delay={100}>
              {s.length ? <SpendRevenueChart series={s} /> : <p className="py-16 text-center text-sm text-slate-400">No data</p>}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-5">
            <Card title="Conversion funnel" subtitle="Calls → booked → invoiced → paid" delay={140}>
              <Funnel stages={[
                { label: 'Calls', value: data.funnel?.calls ?? t.calls, color: palette.answered },
                { label: 'Booked', value: data.funnel?.booked ?? t.bookedNew, color: palette.booked },
                { label: 'Invoiced', value: data.funnel?.invoiced ?? null, color: palette.revenue },
                { label: 'Paid', value: data.funnel?.paid ?? null, color: palette.paid },
              ]} />
            </Card>
            <Card title="Return on ad spend" subtitle={`Invoiced revenue ÷ spend · ${rangeLabel}`} delay={180} className="lg:col-span-1">
              <Gauge value={t.multipleInvoiced} label="Invoiced" />
              <div className="mt-2 flex justify-center gap-6 text-center text-xs text-slate-500">
                <div title="paid = collected so far"><div className="text-base font-bold tabular-nums text-slate-900">{mult(t.multiplePaid)}</div>paid ⓘ</div>
                <div><div className="text-base font-bold tabular-nums text-slate-900">{compactUsd(t.invoicedValue)}</div>invoiced</div>
                <div><div className="text-base font-bold tabular-nums text-slate-900">{compactUsd(t.spend)}</div>spend</div>
              </div>
            </Card>
            <Card title="Recent calls" subtitle="Latest 25" delay={220} className="lg:col-span-3 !p-0">
              <div className="-mx-5 -mb-5 max-h-[300px] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr><th className={th}>Time</th><th className={th}>Outcome</th><th className={`${th} text-right`}>Value</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.recent.length === 0 ? <tr><td colSpan={3} className="px-5 py-8 text-center text-slate-400">No calls yet</td></tr> : data.recent.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/80"><td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600"><div className="font-medium text-slate-800">{when(r.at)}</div><div className="text-slate-400">{r.phone} · {r.durationSeconds ?? '—'}s</div></td>
                        <td className="px-3 py-2"><Badge outcome={r.outcome} /></td><td className="px-3 py-2 text-right tabular-nums">{r.value ? usd(r.value) : ''}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {data.callLog ? (
              <Card title="Call log: all incoming" subtitle={`Today ${data.callLog.today.total} · ${data.callLog.today.answered} answered · ${data.callLog.today.forwardedAi} to Mike · ${data.callLog.today.missed} missed${data.callLog.today.missed ? ' ⚠' : ''}`} delay={230} className="lg:col-span-3 !p-0">
                <div className="-mx-5 -mb-5 max-h-[360px] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr><th className={th}>Time</th><th className={th}>Caller</th><th className={th}>Outcome</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.callLog.rows.map((r, i) => {
                        const missed = r.outcome === 'missed';
                        const label = missed ? 'Missed' : r.outcome === 'forwarded_ai' ? 'Mike (AI)' : r.outcome === 'voicemail' ? 'Voicemail' : r.answeredBy ? `Answered by ${r.answeredBy}` : 'Answered';
                        return (
                          <tr key={i} className={missed ? 'bg-rose-50 hover:bg-rose-100/70' : 'hover:bg-slate-50/80'}>
                            <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600"><div className="font-medium text-slate-800">{when(r.at)}</div><div className="text-slate-400">{r.durationSeconds ?? '—'}s</div></td>
                            <td className="px-3 py-2 text-xs text-slate-600"><div className={missed ? 'font-semibold text-rose-700' : 'font-medium text-slate-800'}>{missed ? <a href={`tel:${r.phone}`}>{r.phone}</a> : r.phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) •••-$3')}</div><div className="text-slate-400">{[r.client, r.campaign].filter(Boolean).join(' · ') || ' '}</div></td>
                            <td className="px-3 py-2"><Badge outcome={label} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <GroupTable title="By campaign" rows={data.byCampaign} delay={240} />
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
    <div className="cd-rise relative flex min-h-[150px] min-w-0 flex-col justify-between gap-2 overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-3.5 sm:p-4 lg:min-h-0 xl:p-6" style={{ animationDelay: `${delay}ms` }}>
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
  const { data, error } = useDashboard('since', 60_000);
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
  const showSince = view === 'since' && !!tt;
  const mainRange = showSince ? sinceRange : monthRange;
  const mainRev = showSince ? { invoiced: tt!.invoicedValue ?? 0, paid: tt!.paidValue ?? 0 } : tv?.revenueMonth;
  const mainSpend = showSince ? tt!.spend : tv?.spendMonth;
  const mainMult = showSince ? tt!.multipleInvoiced : tv?.multipleMonth ?? null;
  const altRange = showSince ? monthRange : sinceRange;
  const altMult = showSince ? tv?.multipleMonth ?? null : tt?.multipleInvoiced ?? null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col gap-3 overflow-y-auto overflow-x-hidden bg-slate-950 text-white antialiased sm:gap-4 lg:overflow-hidden xl:gap-6" style={{ padding: 'max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left))' }}>
      <style>{STYLES}</style>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 xl:px-4 xl:pt-4">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-lg font-black xl:h-14 xl:w-14 xl:text-2xl">S</div>
          <div className="min-w-0"><h1 className="text-lg font-bold leading-tight tracking-tight sm:text-xl xl:text-4xl">SCWS Calls &amp; Ads</h1><p className="text-xs text-slate-400 xl:text-lg">{dateStr}</p></div>
        </div>
        <div className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:w-auto sm:flex-nowrap xl:gap-5">
          <div className="inline-flex rounded-full border border-slate-700 bg-slate-900 p-0.5 text-xs font-medium xl:text-xl" role="tablist" aria-label="Revenue range">
            {([['since', 'Since Sep 18'], ['month', 'This month']] as const).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`whitespace-nowrap rounded-full px-2.5 py-1 xl:px-4 xl:py-1.5 ${view === v ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}>{l}</button>
            ))}
          </div>
          <LiveBadge dark at={(data as (Dashboard & Live) | null)?.generatedAt} refreshMs={60_000} error={error} />
          <p className="order-first shrink-0 text-2xl font-bold tabular-nums sm:order-last xl:text-5xl">{clockStr}</p>
        </div>
      </div>
      {error && !tv ? <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/60 p-4 text-rose-200 xl:text-2xl">{error}</div> : null}
      {tv ? (
        <div className="grid shrink-0 auto-rows-[minmax(150px,auto)] grid-cols-2 gap-2.5 sm:gap-3 lg:min-h-0 lg:flex-1 lg:shrink lg:auto-rows-fr lg:grid-cols-4 lg:grid-rows-2 xl:gap-5">
          <BigTile delay={0} accent={palette.answered} label="Calls" range="Today" value={String(tv.callsToday)} spark={last7.map((d) => d.answered + d.missed)} />
          <BigTile delay={40} accent={palette.answered} label="Answered" range="Today" value={String(tv.answeredToday)} spark={last7.map((d) => d.answered)} />
          <BigTile delay={80} accent={palette.missed} label="Missed / short" range="Today" value={String(tv.missedToday)} spark={last7.map((d) => d.missed)} />
          <BigTile delay={120} accent={palette.booked} label="Booked" range="Today / this week" value={`${tv.bookedToday} / ${tv.bookedWeek}`} spark={last7.map((d) => d.booked)} />
          <BigTile delay={160} accent={palette.revenue} label="New-cust. revenue" range="This week" value={usd(tv.revenueWeek.invoiced)} sub={`paid ${usd(tv.revenueWeek.paid)}`} />
          <BigTile delay={200} accent={palette.revenue} label="New-cust. revenue" range={mainRange} value={usd(mainRev?.invoiced ?? 0)} sub={`paid ${usd(mainRev?.paid ?? 0)} (collected)`} />
          <BigTile delay={240} accent={palette.spend} label="Ad spend" range={mainRange} value={usd(mainSpend ?? 0)} spark={last7.map((d) => d.spend ?? 0)} />
          <div className="cd-rise relative flex min-h-[150px] min-w-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-3.5 sm:p-4 lg:min-h-0" style={{ animationDelay: '280ms' }}>
            <span className="absolute inset-x-0 top-0 h-0.5 bg-emerald-500" />
            <p className="self-start text-[11px] font-semibold uppercase leading-snug tracking-[0.12em] text-slate-400 sm:text-xs sm:tracking-[0.18em] xl:text-base">Ad return<span className="mt-0.5 block text-[10px] font-medium normal-case tracking-normal text-slate-500 sm:text-[11px] xl:text-lg">{mainRange} · invoiced</span></p>
            <div className="flex w-full max-w-[420px] flex-1 items-center"><Gauge dark value={mainMult} label="invoiced ÷ spend" /></div>
            <p className="text-[11px] text-slate-400 xl:text-xl">{altRange}: <span className="font-semibold text-slate-200">{mult(altMult)}</span></p>
          </div>
        </div>
      ) : !error ? (
        <div className="grid auto-rows-[150px] grid-cols-2 gap-2.5 sm:gap-3 lg:min-h-0 lg:flex-1 lg:auto-rows-fr lg:grid-cols-4 lg:grid-rows-2 xl:gap-5" aria-busy="true">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="cd-skel-dark" />)}</div>
      ) : <div className="flex-1" />}
      {data?.weekly ? (() => {
        const ws = data.weekly.weeks; const w = ws[ws.length - 1];
        const cell = (l: string, v: string, sub?: string) => (<div className="min-w-0"><p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500 xl:text-base">{l}</p><p className="whitespace-nowrap text-base font-bold tabular-nums sm:text-lg xl:text-3xl">{v}</p>{sub ? <p className="truncate text-[10px] text-slate-500 xl:text-base">{sub}</p> : null}</div>);
        return (
          <div className="grid shrink-0 grid-cols-2 items-end gap-x-3 gap-y-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:grid-cols-4 lg:grid-cols-[repeat(8,minmax(0,1fr))_minmax(0,2.2fr)] xl:gap-x-5 xl:px-6 xl:py-4" aria-label="Weekly sales">
            <p className="col-span-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 sm:col-span-4 lg:col-span-9 xl:text-sm">Weekly sales · this week to date {w.label} · bars: invoiced, last 9 weeks, Mon–Sun</p>
            {cell('Invoiced', usd(w.invoiced))}
            {cell('Paid on invoices', usd(w.paid), 'issued this week')}
            {cell('Cash collected', usd(w.cash), 'received this week')}
            {cell('Jobs booked', w.jobsBooked == null ? '—' : String(w.jobsBooked))}
            {cell('Completed', w.jobsCompleted == null ? '—' : String(w.jobsCompleted))}
            {cell('Quotes sent', compactUsd(w.quotesSentValue), `${w.quotesSent ?? 0} quotes`)}
            {cell('Approved', compactUsd(w.quotesApprovedValue), `${w.quotesApproved ?? 0} quotes`)}
            {cell('Closing rate', pct(w.closingRate))}
            <div className="col-span-2 mt-2 min-w-0 sm:col-span-4 lg:col-span-1"><WeeklyBars dark weeks={ws} height={40} /><p className="mb-0.5 mt-1 text-[10px] uppercase tracking-wider text-slate-500">Cash collected / wk</p><WeeklyCashBars dark weeks={ws} height={28} /></div>
          </div>
        );
      })() : null}
      <div className="shrink-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 px-3.5 py-3 sm:px-4 xl:px-6 xl:py-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 xl:text-sm">Activity</p>
        <div className="space-y-1.5 overflow-hidden text-[13px] sm:text-sm lg:h-[5.5rem] lg:space-y-1 xl:h-36 xl:text-2xl">
          {(tv?.ticker ?? []).length === 0 ? <p className="text-slate-500">{tv ? 'No recent activity' : ' '}</p> : null}
          {(tv?.ticker ?? []).slice(0, 4).map((t, i) => (
            <p key={i} className={`flex min-w-0 items-start gap-2 sm:items-center sm:gap-3 ${t.kind === 'booking' ? 'font-bold text-emerald-400' : 'text-slate-200'}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full sm:mt-0 ${t.kind === 'booking' ? 'bg-emerald-400' : 'bg-sky-400'}`} />
              <span className="shrink-0 tabular-nums text-slate-500">{when(t.at)}</span><span className="line-clamp-2 min-w-0 flex-1 break-words sm:line-clamp-1 sm:truncate">{t.text}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
