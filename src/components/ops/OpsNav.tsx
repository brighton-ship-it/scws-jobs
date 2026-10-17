'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export const OPS_TABS = [
  { tab: 'today', label: 'Today', href: '/ops/calls' },
  { tab: 'sales', label: 'Sales', href: '/ops/calls?tab=sales' },
  { tab: 'ads', label: 'Ads & leads', href: '/ops/calls?tab=ads' },
  { tab: 'collections', label: 'Collections (office)', href: '/ops/calls?tab=collections' },
  { tab: 'metrics', label: 'Business metrics', href: '/ops/metrics' },
  { tab: 'quotes-gp', label: 'Quote GP', href: '/ops/quotes-gp' },
] as const;
export type CallsTab = 'today' | 'sales' | 'ads' | 'collections';
export const CALLS_TABS: CallsTab[] = ['today', 'sales', 'ads', 'collections'];

/** Shared office ops navigation: the dashboard tabs plus Metrics, Quote GP and TV. Keeps the period (?range=) across dashboard tabs. */
export function OpsNav() {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  if (pathname.startsWith('/ops/calls/tv')) return null;
  const range = params?.get('range');
  const tab = params?.get('tab') ?? 'today';
  const active = (t: (typeof OPS_TABS)[number]) =>
    t.href.startsWith('/ops/calls') ? pathname === '/ops/calls' && (CALLS_TABS.includes(tab as CallsTab) ? tab : 'today') === t.tab : pathname.startsWith(t.href);
  const withRange = (href: string) => {
    if (!range || !href.startsWith('/ops/calls')) return href;
    return `${href}${href.includes('?') ? '&' : '?'}range=${encodeURIComponent(range)}`;
  };
  return (
    <nav className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4" aria-label="Office ops">
      {OPS_TABS.map((t) => (
        <Link key={t.tab} href={withRange(t.href)} scroll={false} aria-current={active(t) ? 'page' : undefined}
          className={`shrink-0 whitespace-nowrap border-b-[3px] px-3 py-2.5 text-sm font-semibold transition-colors ${active(t) ? 'border-emerald-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
        </Link>
      ))}
      <a href={`/ops/calls/tv${range === 'month' ? '?range=month' : ''}`} className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">TV mode ↗</a>
    </nav>
  );
}
