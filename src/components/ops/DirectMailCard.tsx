'use client';
import { useEffect, useState } from 'react';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';

const usd = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));

/** DM1 postcard scorecard (calls to 823-8910, /checkup forms, bookings, invoiced, response rate, matched by address). */
export function DirectMailCard() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let key: string | null = null;
    try { key = new URL(window.location.href).searchParams.get(QUOTES_GP_KEY_QUERY) || localStorage.getItem('quotes_gp_key'); } catch {}
    fetch('/api/ops/direct-mail', { headers: key ? { [QUOTES_GP_KEY_HEADER]: key } : {}, cache: 'no-store' })
      .then(async (r) => { if (!r.ok) throw new Error(`Error ${r.status}`); setD(await r.json()); })
      .catch((e) => setErr(e.message));
  }, []);
  if (err) return null;
  if (!d) return <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Direct mail · loading…</div>;
  const t = d.tracked, m = d.matchedByAddress, c = d.campaign;
  const cells: Array<[string, string | number]> = [
    ['Mailed', c.pieces.toLocaleString()],
    ['Spend', `${usd(c.spend)}${c.spendIsPlaceholder ? ' (est.)' : ''}`],
    ['Calls', `${t.calls} (${t.callers} callers)`],
    ['Forms', t.forms],
    ['Booked', t.booked],
    ['Invoiced', usd(t.invoiced)],
    ['Response rate', t.trackedResponseRatePct == null ? '—' : `${t.trackedResponseRatePct}%`],
    ['$ / booking', usd(t.costPerBooking)],
    ['Matched by address', `${m.matched} (${m.notOtherwiseTracked} not tracked)`],
    ['Matched booked / invoiced', `${m.booked} / ${usd(m.invoiced)}`],
    ['All-in ROAS', d.combined.roas == null ? '—' : `${d.combined.roas}x`],
  ];
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="font-semibold text-slate-900">Direct mail · {c.code} postcard</h3>
      <p className="text-[11px] text-slate-500">{c.offer} · {c.number} · scwellservice.com/checkup · mail date {c.mailDate} · expires {c.expires}{c.spendIsPlaceholder ? ' · spend is the Click2Mail quote until DM1_COST is set' : ''}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {cells.map(([k, v]) => <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5"><dt className="text-[10px] uppercase tracking-wider text-slate-500">{k}</dt><dd className="font-semibold tabular-nums text-slate-900">{v}</dd></div>)}
      </dl>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">Tracked = calls to the mailer number + forms from the postcard page. Matched by address = new Jobber clients since the mail date whose address was on the 2,500 list (people who called the main line or searched instead), counted separately. Booked = a Jobber job within 90 days of first contact. {m.error ? `Match-back error: ${m.error}` : `${m.scannedNewClients} new clients scanned.`}</p>
    </section>
  );
}
