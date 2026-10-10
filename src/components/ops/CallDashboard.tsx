'use client';

import { useCallback, useEffect, useState } from 'react';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';
import type { Dashboard, GroupRow } from '@/lib/ads/call-dashboard';

const KEY_STORAGE = 'quotes_gp_key';
const RANGES = [
  { v: '7', label: '7 days' }, { v: '30', label: '30 days' }, { v: '90', label: '90 days' }, { v: 'since', label: 'Since Sep 18' },
] as const;

const usd = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d }).format(n);
const mult = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}x`);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

function useDashboard(range: string, refreshMs: number | null) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  }, [range]);
  useEffect(() => {
    load();
    if (!refreshMs) return;
    const t = setInterval(load, refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);
  return { data, error, reload: load };
}

function Tile({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-red-600' : 'text-slate-900';
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: GroupRow[] }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs sm:text-sm">
          <thead className="text-slate-500"><tr>
            <th className="px-3 py-1">Name</th><th className="px-2">Calls</th><th className="px-2">Ans.</th>
            <th className="px-2">Short</th><th className="px-2">Booked</th><th className="px-2">$/call</th><th className="px-2">Invoiced</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td className="px-3 py-2 text-slate-400" colSpan={7}>No calls</td></tr> : rows.slice(0, 15).map((r) => (
              <tr key={r.key} className="border-t border-slate-100">
                <td className="max-w-[10rem] truncate px-3 py-1" title={r.key}>{r.key}</td>
                <td className="px-2">{r.calls}</td><td className="px-2">{r.answered}</td><td className="px-2">{r.short}</td>
                <td className="px-2">{r.booked}</td><td className="px-2">{usd(r.costPerCall, 2)}</td><td className="px-2">{usd(r.invoiced)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function CallDashboardPage() {
  const [range, setRange] = useState<string>('since');
  const { data, error, reload } = useDashboard(range, 5 * 60_000);
  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.v} onClick={() => setRange(r.v)}
            className={`rounded-full border px-3 py-1 text-sm ${range === r.v ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white'}`}>{r.label}</button>
        ))}
        <button onClick={reload} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-sm">Refresh</button>
        <a href="/ops/calls/tv" className="ml-auto text-sm text-blue-600 underline">TV mode</a>
      </div>
      {error ? <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {data && t ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Tile label="Calls" value={String(t.calls)} sub={`${t.answered} answered · ${t.missedOrShort} missed/short (<15s)`} />
            <Tile label="Booked (new customers)" value={String(t.bookedNew)} sub={`${t.knownExisting} existing/known · ${t.unmatched} other`} />
            <Tile label="Ad spend" value={usd(t.spend)} sub={`${usd(t.costPerCall, 2)}/call · ${usd(t.costPerBooked)}/booked`} />
            <Tile label="Return (invoiced / paid)" value={`${mult(t.multipleInvoiced)} / ${mult(t.multiplePaid)}`} tone="good" />
            <Tile label="Booked value" value={usd(t.bookedValue)} sub={`${usd(t.perCall.booked, 2)}/call`} />
            <Tile label="Quote value" value={usd(t.quoteValue)} sub={`${usd(t.perCall.quote, 2)}/call`} />
            <Tile label="Invoiced" value={usd(t.invoicedValue)} sub={`${usd(t.perCall.invoiced, 2)}/call`} />
            <Tile label="Paid" value={usd(t.paidValue)} />
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <GroupTable title="By campaign" rows={data.byCampaign} />
            <GroupTable title="By keyword / ad group" rows={data.byKeyword} />
            <GroupTable title="By tracking number / source" rows={data.byTrackingNumber} />
          </div>
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <h2 className="border-b border-slate-200 px-3 py-2 text-sm font-semibold">Recent calls</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="text-slate-500"><tr><th className="px-3 py-1">Time (PT)</th><th className="px-2">Caller</th><th className="px-2">Dur.</th><th className="px-2">Campaign</th><th className="px-2">Outcome</th><th className="px-2">Value</th></tr></thead>
                <tbody>{data.recent.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="whitespace-nowrap px-3 py-1">{when(r.at)}</td><td className="whitespace-nowrap px-2">{r.phone}</td>
                    <td className="px-2">{r.durationSeconds ?? '—'}s</td><td className="max-w-[9rem] truncate px-2">{r.campaign}</td>
                    <td className="whitespace-nowrap px-2">{r.outcome}</td><td className="px-2">{r.value ? usd(r.value) : ''}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          </section>
          <details className="text-xs text-slate-500"><summary>Data notes</summary><ul className="list-disc pl-5">{data.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></details>
        </>
      ) : null}
    </div>
  );
}

function BigTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col justify-center rounded-2xl border-2 border-slate-700 bg-slate-900 p-4 text-center">
      <p className="text-lg font-semibold uppercase tracking-widest text-slate-400 xl:text-2xl">{label}</p>
      <p className="mt-2 text-5xl font-extrabold text-white xl:text-7xl">{value}</p>
      {sub ? <p className="mt-2 text-lg text-emerald-400 xl:text-2xl">{sub}</p> : null}
    </div>
  );
}

export function CallDashboardTv() {
  const { data, error } = useDashboard('since', 60_000);
  const tv = data?.tv;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black p-4 text-white">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold xl:text-4xl">SCWS Calls &amp; Ads</h1>
        <p className="text-sm text-slate-400 xl:text-xl">{error ? error : data ? `Updated ${when((data as any).generatedAt)} · refreshes every minute` : 'Loading…'}</p>
      </div>
      {tv ? (
        <div className="mt-4 grid flex-1 grid-cols-2 gap-4 lg:grid-cols-4">
          <BigTile label="Calls today" value={String(tv.callsToday)} />
          <BigTile label="Answered" value={String(tv.answeredToday)} />
          <BigTile label="Missed / short" value={String(tv.missedToday)} />
          <BigTile label="Booked today / week" value={`${tv.bookedToday} / ${tv.bookedWeek}`} />
          <BigTile label="New-cust. revenue week" value={usd(tv.revenueWeek.invoiced)} sub={`paid ${usd(tv.revenueWeek.paid)}`} />
          <BigTile label="New-cust. revenue month" value={usd(tv.revenueMonth.invoiced)} sub={`paid ${usd(tv.revenueMonth.paid)}`} />
          <BigTile label="Ad spend month" value={usd(tv.spendMonth)} />
          <BigTile label="Ad return month" value={mult(tv.multipleMonth)} sub="invoiced ÷ spend" />
        </div>
      ) : <div className="flex-1" />}
      <div className="mt-4 h-24 overflow-hidden rounded-xl bg-slate-900 p-3 xl:h-32">
        <div className="space-y-1 text-lg xl:text-2xl">
          {(tv?.ticker ?? []).slice(0, 4).map((t, i) => (
            <p key={i} className={t.kind === 'booking' ? 'font-bold text-emerald-400' : 'text-slate-200'}>
              <span className="text-slate-500">{when(t.at)} </span>{t.kind === 'booking' ? '✅ ' : '📞 '}{t.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
