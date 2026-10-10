'use client';

import type { SeriesDay } from '@/lib/ads/call-dashboard';
import type { WeekRow } from '@/lib/ads/weekly-sales';

/** Design tokens shared by the call dashboard (light) and TV wall (dark). */
export const palette = {
  answered: '#10b981', missed: '#f43f5e', spend: '#f59e0b', revenue: '#6366f1',
  booked: '#0ea5e9', paid: '#14b8a6', ink: '#0f172a', muted: '#64748b', grid: '#e2e8f0',
};

export const usd = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: d }).format(n);
import { compactUsd } from '@/lib/ads/format-usd';
export { compactUsd };
export const mult = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}x`);
export const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
};

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function Sparkline({ values, color, dark = false, height = 36 }: { values: number[]; color: string; dark?: boolean; height?: number }) {
  const w = 120;
  if (values.length < 2) return <div style={{ height }} aria-hidden />;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const id = `sg-${color.replace('#', '')}${dark ? 'd' : 'l'}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity={dark ? 0.35 : 0.22} /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Axis({ max, w, h, pad, fmt, dark }: { max: number; w: number; h: number; pad: { l: number; r: number; t: number; b: number }; fmt: (n: number) => string; dark?: boolean }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g>
      {ticks.map((t) => {
        const y = pad.t + (h - pad.t - pad.b) * (1 - t);
        return (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke={dark ? '#1e293b' : palette.grid} strokeWidth="1" strokeDasharray={t === 0 ? undefined : '3 4'} />
            <text x={pad.l - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill={dark ? '#64748b' : palette.muted}>{fmt(max * t)}</text>
          </g>
        );
      })}
    </g>
  );
}

function XLabels({ days, w, pad, h, dark }: { days: string[]; w: number; pad: { l: number; r: number; t: number; b: number }; h: number; dark?: boolean }) {
  const n = days.length;
  const step = Math.max(1, Math.ceil(n / 8));
  const inner = w - pad.l - pad.r;
  return (
    <g>
      {days.map((d, i) => i % step === 0 ? (
        <text key={d} x={pad.l + (inner * (i + 0.5)) / n} y={h - 8} textAnchor="middle" fontSize="10" fill={dark ? '#64748b' : palette.muted}>{shortDay(d)}</text>
      ) : null)}
    </g>
  );
}

const W = 640, H = 240, PAD = { l: 48, r: 10, t: 12, b: 26 };

export function CallsPerDayChart({ series }: { series: SeriesDay[] }) {
  const max = niceMax(Math.max(...series.map((d) => d.answered + d.missed), 1));
  const inner = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const bw = Math.min(28, (inner / series.length) * 0.66);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Calls per day, answered and missed">
      <Axis max={max} w={W} h={H} pad={PAD} fmt={(n) => String(Math.round(n))} />
      {series.map((d, i) => {
        const cx = PAD.l + (inner * (i + 0.5)) / series.length;
        const ha = (d.answered / max) * ih, hm = (d.missed / max) * ih;
        const yBase = PAD.t + ih;
        return (
          <g key={d.date} className="cd-bar" style={{ animationDelay: `${Math.min(i * 12, 400)}ms` }}>
            <title>{`${shortDay(d.date)} · ${d.answered} answered · ${d.missed} missed`}</title>
            <rect x={cx - bw / 2} y={yBase - ha} width={bw} height={ha} rx={ha > 3 ? 2 : 0} fill={palette.answered} />
            <rect x={cx - bw / 2} y={yBase - ha - hm} width={bw} height={hm} rx={hm > 3 ? 2 : 0} fill={palette.missed} />
            <rect x={cx - inner / series.length / 2} y={PAD.t} width={inner / series.length} height={ih} fill="transparent" />
          </g>
        );
      })}
      <XLabels days={series.map((d) => d.date)} w={W} pad={PAD} h={H} />
    </svg>
  );
}

export function SpendRevenueChart({ series }: { series: SeriesDay[] }) {
  const hasSpend = series.some((d) => d.spend != null);
  const max = niceMax(Math.max(...series.map((d) => Math.max(d.invoiced, d.spend ?? 0)), 1));
  const inner = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (inner * (i + 0.5)) / series.length;
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const path = (pick: (d: SeriesDay) => number) => series.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`).join(' ');
  const area = (pick: (d: SeriesDay) => number) => `${path(pick)} L${x(series.length - 1)},${PAD.t + ih} L${x(0)},${PAD.t + ih} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ad spend versus invoiced revenue per day">
      <defs>
        <linearGradient id="g-rev" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={palette.revenue} stopOpacity="0.25" /><stop offset="1" stopColor={palette.revenue} stopOpacity="0" /></linearGradient>
      </defs>
      <Axis max={max} w={W} h={H} pad={PAD} fmt={compactUsd} />
      <path d={area((d) => d.invoiced)} fill="url(#g-rev)" />
      <path className="cd-line" d={path((d) => d.invoiced)} fill="none" stroke={palette.revenue} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
      {hasSpend ? <path className="cd-line" d={path((d) => d.spend ?? 0)} fill="none" stroke={palette.spend} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" /> : null}
      {series.map((d, i) => (
        <g key={d.date}>
          <title>{`${shortDay(d.date)} · invoiced ${usd(d.invoiced)} · spend ${usd(d.spend)}`}</title>
          <rect x={x(i) - inner / series.length / 2} y={PAD.t} width={inner / series.length} height={ih} fill="transparent" />
        </g>
      ))}
      <XLabels days={series.map((d) => d.date)} w={W} pad={PAD} h={H} />
    </svg>
  );
}

export function Funnel({ stages }: { stages: Array<{ label: string; value: number | null; color: string }> }) {
  const top = Math.max(stages[0]?.value ?? 0, 1);
  return (
    <ul className="space-y-3">
      {stages.map((s, i) => {
        const v = s.value;
        const pct = v == null ? 0 : Math.max(v > 0 ? 3 : 0, (v / top) * 100);
        const prev = i > 0 ? stages[i - 1].value : null;
        const conv = v != null && prev ? Math.round((v / prev) * 100) : null;
        return (
          <li key={s.label}>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="font-medium text-slate-600">{s.label}</span>
              <span className="tabular-nums text-slate-900"><b className="text-sm">{v ?? '—'}</b>{conv != null ? <span className="ml-2 text-slate-400">{conv}% of prior</span> : null}</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: s.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Semicircle gauge, 0x–6x. Ticks mark 1x (break-even) and 5x (goal). */
export function Gauge({ value, label, dark = false }: { value: number | null; label?: string; dark?: boolean }) {
  const MAX = 6, cx = 100, cy = 100, r = 80;
  const pt = (v: number, rad = r) => {
    const a = Math.PI * (1 - Math.min(Math.max(v, 0), MAX) / MAX);
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)] as const;
  };
  const arc = (a: number, b: number) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; };
  const color = value == null ? '#94a3b8' : value >= 5 ? '#10b981' : value >= 3 ? '#84cc16' : value >= 1 ? '#f59e0b' : '#f43f5e';
  const track = dark ? '#1e293b' : '#e2e8f0';
  return (
    <svg viewBox="0 0 200 124" className="mx-auto w-full max-w-[280px]" role="img" aria-label={`Return multiple ${mult(value)}`}>
      <path d={arc(0, MAX)} fill="none" stroke={track} strokeWidth="14" strokeLinecap="round" />
      {value != null && value > 0 ? <path d={arc(0, Math.min(value, MAX))} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" className="cd-gauge" /> : null}
      {[1, 5].map((t) => { const [x1, y1] = pt(t, r - 12), [x2, y2] = pt(t, r + 12); const [lx, ly] = pt(t, r + 20); return (<g key={t}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={dark ? '#94a3b8' : '#475569'} strokeWidth="1.5" /><text x={lx} y={ly + 3} textAnchor="middle" fontSize="9" fill={dark ? '#94a3b8' : '#64748b'}>{t}x</text></g>); })}
      <text x={cx} y={cy - 8} textAnchor="middle" fontSize="30" fontWeight="800" fill={dark ? '#fff' : palette.ink}>{mult(value)}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill={dark ? '#94a3b8' : palette.muted} letterSpacing="1">{(label ?? 'RETURN').toUpperCase()}</text>
    </svg>
  );
}

/** Weekly invoiced (bar) with paid (inner bar). Flex layout, so it never overflows horizontally. */
export function WeeklyBars({ weeks, dark = false, height = 96 }: { weeks: WeekRow[]; dark?: boolean; height?: number }) {
  const max = Math.max(1, ...weeks.map((w) => w.invoiced ?? 0));
  return (
    <div className="flex w-full min-w-0 items-end gap-1 sm:gap-1.5" style={{ height: height + 16 }} role="img" aria-label="Weekly invoiced sales, oldest to newest">
      {weeks.map((w) => {
        const h = Math.max(2, Math.round(((w.invoiced ?? 0) / max) * height));
        const ph = Math.round(((w.paid ?? 0) / max) * height);
        return (
          <div key={w.weekStart} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${w.label}: invoiced ${usd(w.invoiced)} · paid ${usd(w.paid)}`}>
            <span className={`mb-0.5 max-w-full truncate text-[9px] tabular-nums ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{compactUsd(w.invoiced)}</span>
            <div className="cd-bar relative w-full overflow-hidden rounded-t" style={{ height: h, background: w.current ? palette.revenue : dark ? '#475569' : '#c7d2fe' }}>
              <div className="absolute inset-x-0 bottom-0" style={{ height: ph, background: palette.paid, opacity: 0.9 }} />
            </div>
            <span className={`mt-0.5 text-[9px] ${w.current ? 'font-bold' : ''} ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{shortDay(w.weekStart)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Weekly cash collected (by payment received date), one bar per week. */
export function WeeklyCashBars({ weeks, dark = false, height = 56 }: { weeks: WeekRow[]; dark?: boolean; height?: number }) {
  const max = Math.max(1, ...weeks.map((w) => w.cash ?? 0));
  return (
    <div className="flex w-full min-w-0 items-end gap-1 sm:gap-1.5" style={{ height: height + 16 }} role="img" aria-label="Weekly cash collected by payment date, oldest to newest">
      {weeks.map((w) => {
        const h = Math.max(2, Math.round((Math.max(0, w.cash ?? 0) / max) * height));
        return (
          <div key={w.weekStart} className="flex min-w-0 flex-1 flex-col items-center justify-end" title={`${w.label}: cash collected ${usd(w.cash)}`}>
            <span className={`mb-0.5 max-w-full truncate text-[9px] tabular-nums ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{compactUsd(w.cash)}</span>
            <div className="cd-bar w-full rounded-t" style={{ height: h, background: w.current ? palette.paid : dark ? '#475569' : '#99f6e4' }} />
            <span className={`mt-0.5 text-[9px] ${w.current ? 'font-bold' : ''} ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{shortDay(w.weekStart)}</span>
          </div>
        );
      })}
    </div>
  );
}
