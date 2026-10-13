'use client';
import { Fragment, useEffect, useState } from 'react';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';

type Row = { call_sid: string; started_at: string; caller_number: string | null; source: string | null; dial_status: string | null; answered: boolean | null; duration_seconds: number | null; processing_status: string; transcript: string | null; summary: string | null; outcome: string | null; caller_name: string | null; needs_followup: boolean | null; jobber_client_id?: string | null; processing_error?: string | null };

function fmtPhone(p: string | null) { const d = (p ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || 'Unknown'); }
function fmtDur(s: number | null) { return s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; }
/** "Key: value" lines after the first summary line become the summary box. */
function splitSummary(summary: string | null) {
  const lines = (summary ?? '').split('\n');
  const box: Array<[string, string]> = [];
  for (const l of lines.slice(1)) { const m = l.match(/^(Who|Address|Issue|Next step|Booked):\s*(.+)$/); if (m) box.push([m[1], m[2]]); }
  return { text: lines[0] ?? '', box };
}
function turnsOf(t: string): Array<{ who: 'SCWS' | 'Caller'; text: string }> | null {
  const lines = t.split('\n').filter((l) => l.trim());
  if (lines.length < 2 || !lines.every((l) => /^(SCWS|Shop|Caller|AI|Mike|User|Assistant)\s*:/i.test(l))) return null;
  return lines.map((l) => { const i = l.indexOf(':'); const sp = l.slice(0, i).trim(); return { who: /caller|user/i.test(sp) ? 'Caller' : 'SCWS', text: l.slice(i + 1).trim() }; });
}
function Transcript({ text }: { text: string }) {
  const turns = turnsOf(text);
  if (!turns) return <div className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-50 p-4 text-[15px] leading-relaxed text-slate-800">{text.split(/(?<=[.?!])\s+/).map((s, i) => <p key={i} className="mb-1">{s}</p>)}</div>;
  return (
    <div className="mt-3 max-h-[28rem] space-y-2 overflow-auto rounded-lg bg-slate-50 p-4">
      {turns.map((t, i) => (
        <div key={i} className={`flex ${t.who === 'SCWS' ? 'justify-start' : 'justify-end'}`}>
          <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-[15px] leading-relaxed ${t.who === 'SCWS' ? 'rounded-bl-sm bg-white text-slate-900 ring-1 ring-slate-200' : 'rounded-br-sm bg-sky-600 text-white'}`}>
            <div className={`mb-0.5 text-[11px] font-bold uppercase tracking-wider ${t.who === 'SCWS' ? 'text-slate-500' : 'text-sky-100'}`}>{t.who}</div>{t.text}
          </div>
        </div>
      ))}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { gbp_ramona: 'Google profile · Ramona', gbp_anza: 'Google profile · Anza', gmb: 'Google profile', google_ads: 'Google Ads', seo: 'Website (SEO)', yelp: 'Yelp', apple_maps: 'Apple Maps', direct: 'Direct', main_line: 'Main line' };

export function PhoneCallTranscripts() {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let key: string | null = null;
    try { key = new URL(window.location.href).searchParams.get(QUOTES_GP_KEY_QUERY) || localStorage.getItem('quotes_gp_key'); } catch {}
    fetch('/api/ops/phone-calls', { headers: key ? { [QUOTES_GP_KEY_HEADER]: key } : {}, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { calls: [] })).then((j) => setRows(j.calls ?? [])).catch(() => {});
  }, []);
  if (rows.length === 0) return null; // hidden until recorded calls exist
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3"><div className="text-sm font-semibold text-slate-800">Phone calls: summaries &amp; transcripts</div><div className="text-xs text-slate-400">Recorded tracking-line calls, latest 25 · click a call for the summary box and transcript</div></div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => {
          const sm = splitSummary(r.summary);
          return (
          <li key={r.call_sid} className="px-5 py-4">
            <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === r.call_sid ? null : r.call_sid)}>
              <span className="min-w-0">
                <span className="text-base font-semibold text-slate-900">{r.caller_name || fmtPhone(r.caller_number)}</span>
                <span className="ml-2 text-sm text-slate-600">{r.caller_name ? `${fmtPhone(r.caller_number)} · ` : ''}{new Date(r.started_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {fmtDur(r.duration_seconds)} · {r.answered === false ? 'missed' : (r.source ? SOURCE_LABEL[r.source] ?? r.source : '')}</span>
                <span className="mt-1 block text-[15px] text-slate-700">{sm.text || (r.processing_status === 'done' ? '' : `(${r.processing_status})`)}</span>
              </span>
              <span className="flex shrink-0 gap-1 text-xs">
                {r.processing_error === 'note posted' ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">Jobber note</span> : null}
                {r.outcome ? <span className={`rounded-full px-2 py-0.5 font-semibold ${r.outcome === 'booked' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{r.outcome.replace(/_/g, ' ')}</span> : null}
                {r.needs_followup ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">follow up</span> : null}
              </span>
            </button>
            {open === r.call_sid ? (
              <div>
                {sm.box.length ? (
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 rounded-lg border border-sky-200 bg-sky-50 p-4 text-[15px] sm:grid-cols-[auto_1fr]">
                    {sm.box.map(([k, v]) => <Fragment key={k}><dt className="font-semibold text-sky-900">{k}</dt><dd className="text-slate-800">{v}</dd></Fragment>)}
                  </dl>
                ) : null}
                {r.transcript ? <Transcript text={r.transcript} /> : null}
              </div>
            ) : null}
          </li>
          );
        })}
      </ul>
    </div>
  );
}
