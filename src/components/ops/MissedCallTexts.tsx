'use client';

import type { MissedCallTextRow, MissedCallTextView } from '@/lib/ads/missed-call-text-feed';

const TONE = {
  ok: 'bg-emerald-50 text-emerald-800',
  wait: 'bg-slate-100 text-slate-700',
  bad: 'bg-rose-50 text-rose-800',
} as const;

function pct(rate: number | null): string {
  return rate == null ? '—' : `${Math.round(rate * 100)}%`;
}

function SummaryTile({ label, value, sub, metric, metricValue }: { label: string; value: string; sub: string; metric: string; metricValue: number | string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3" data-metric={metric} data-value={metricValue}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums leading-none text-slate-900">{value}</p>
      <p className="mt-1 text-xs leading-snug text-slate-500">{sub}</p>
    </div>
  );
}

function TextCard({ row }: { row: MissedCallTextRow }) {
  const who = row.name || row.phoneDisplay;
  const tel = row.phone.length === 10 ? `tel:+1${row.phone}` : undefined;
  return (
    <article data-missed-text={row.id} className="min-w-0 border-t border-slate-200 py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold text-slate-900">{row.timeLabel}</p>
        <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[row.deliveryTone]}`}>{row.delivery}</span>
      </div>
      <p className="mt-1 break-words text-sm text-slate-600">{row.line}</p>
      <p className="mt-1 break-words font-semibold text-slate-900">
        {tel ? <a href={tel} className="underline decoration-slate-300 underline-offset-2">{who}</a> : who}
      </p>
      {row.name && tel ? <p className="break-words text-sm text-slate-600"><a href={tel} className="underline decoration-slate-300 underline-offset-2">{row.phoneDisplay}</a></p> : null}
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{row.body}</p>
      {row.replies.length ? (
        <ul className="mt-2 space-y-2">
          {row.replies.map((reply, i) => (
            <li key={`${reply.at}-${i}`} className="min-w-0 rounded-xl bg-sky-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-800">Reply · {reply.timeLabel}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{reply.body}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-slate-500">No reply yet</p>}
      <p className="mt-2 text-sm text-slate-700">
        {row.booked ? (
          <>
            <span className="font-semibold text-emerald-800">Booked over text</span>
            {row.jobUrl ? <> · <a href={row.jobUrl} target="_blank" rel="noreferrer" className="font-semibold text-sky-800 underline">{row.jobLabel || 'Jobber job'}</a></> : row.jobLabel ? <> · {row.jobLabel}</> : null}
          </>
        ) : <span>No booking from this text</span>}
      </p>
    </article>
  );
}

export function MissedCallTextsCard({ view, rangeLabel }: { view: MissedCallTextView | null; rangeLabel: string }) {
  const rate = view?.replyRate ?? null;
  return (
    <section id="missed-texts" data-section="missed-call-texts" aria-label="Missed-call texts" className="min-w-0 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,.04),0_8px_24px_-12px_rgba(15,23,42,.1)]">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-semibold tracking-tight text-slate-900">Missed-call texts</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            Auto-texts after a missed call · {rangeLabel} · Pacific time
            {view && view.failed > 0 ? ` · ${view.failed} failed to send` : ''}
          </p>
        </div>
      </div>
      {view ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
            <SummaryTile label="Texts sent" value={String(view.sent)} sub={rangeLabel} metric="texts-sent" metricValue={view.sent} />
            <SummaryTile label="Reply rate" value={pct(rate)} sub={view.sent ? `${view.replied} of ${view.sent} got a reply` : 'No texts sent'} metric="reply-rate" metricValue={rate == null ? '' : Math.round(rate * 100)} />
            <SummaryTile label="Booked from text" value={String(view.booked)} sub="Mike booked in the text thread" metric="booked-from-text" metricValue={view.booked} />
          </div>
          {view.hidden > 0 ? <p className="mt-3 text-xs text-slate-500">Showing the latest {view.rows.length}. {view.hidden} older texts are in this period.</p> : null}
          {view.rows.length === 0 ? <p className="mt-3 text-sm text-slate-500">No missed-call texts in this period.</p> : (
            <div className="mt-2">
              {view.rows.map((row) => <TextCard key={row.id} row={row} />)}
            </div>
          )}
        </>
      ) : <p className="mt-3 text-sm text-slate-500">Missed-call texts did not load.</p>}
    </section>
  );
}
