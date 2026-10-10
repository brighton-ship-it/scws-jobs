'use client';
import { useEffect, useState } from 'react';
import { QUOTES_GP_KEY_HEADER, QUOTES_GP_KEY_QUERY } from '@/lib/quotes-gp-auth';

type Row = { call_sid: string; started_at: string; caller_number: string | null; source: string | null; dial_status: string | null; answered: boolean | null; duration_seconds: number | null; processing_status: string; transcript: string | null; summary: string | null; outcome: string | null; caller_name: string | null; needs_followup: boolean | null };

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
      <div className="border-b border-slate-100 px-5 py-3"><div className="text-sm font-semibold text-slate-800">Phone calls: summaries &amp; transcripts</div><div className="text-xs text-slate-400">Recorded inbound calls, latest 25</div></div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.call_sid} className="px-5 py-3 text-sm">
            <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === r.call_sid ? null : r.call_sid)}>
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{r.caller_name || r.caller_number || 'Unknown'}</span>
                <span className="ml-2 text-xs text-slate-400">{new Date(r.started_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.duration_seconds ?? '—'}s · {r.answered === false ? 'missed' : r.source ?? ''}</span>
                <span className="mt-0.5 block text-slate-600">{r.summary || (r.processing_status === 'done' ? '' : `(${r.processing_status})`)}</span>
              </span>
              <span className="flex shrink-0 gap-1 text-xs">
                {r.outcome ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{r.outcome.replace(/_/g, ' ')}</span> : null}
                {r.needs_followup ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">follow up</span> : null}
              </span>
            </button>
            {open === r.call_sid && r.transcript ? <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{r.transcript}</pre> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
