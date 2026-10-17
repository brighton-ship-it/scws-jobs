'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

export const OPS_TABS = [
  { tab: 'today', label: 'Today', href: '/ops/calls' },
  { tab: 'sales', label: 'Sales', href: '/ops/calls#sales' },
  { tab: 'ads', label: 'Ads & leads', href: '/ops/calls#ads' },
  { tab: 'collections', label: 'Collections (office)', href: '/ops/calls#collections' },
  { tab: 'metrics', label: 'Business metrics', href: '/ops/metrics' },
  { tab: 'quotes-gp', label: 'Quote GP', href: '/ops/quotes-gp' },
] as const;

/** Shared office ops navigation. The dashboard is one page (every card once); Sales / Ads & leads / Collections jump to its sections. Keeps the period (?range=). */
export function OpsNav() {
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  if (pathname.startsWith('/ops/calls/tv')) return null;
  const range = params?.get('range');
  const active = (t: (typeof OPS_TABS)[number]) => (t.tab === 'today' ? pathname === '/ops/calls' : !t.href.startsWith('/ops/calls') && pathname.startsWith(t.href));
  const withRange = (href: string) => {
    if (!range || !href.startsWith('/ops/calls')) return href;
    const [path, hash] = href.split('#');
    return `${path}?range=${encodeURIComponent(range)}${hash ? `#${hash}` : ''}`;
  };
  return (
    <nav className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-4" aria-label="Office ops">
      {OPS_TABS.map((t) => (
        <Link key={t.tab} href={withRange(t.href)} scroll={!t.href.includes('#') ? false : undefined} aria-current={active(t) ? 'page' : undefined}
          className={`shrink-0 whitespace-nowrap border-b-[3px] px-3 py-2.5 text-sm font-semibold transition-colors ${active(t) ? 'border-emerald-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {t.label}
        </Link>
      ))}
      <a href={`/ops/calls/tv${range === 'month' ? '?range=month' : ''}`} className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700">TV mode ↗</a>
    </nav>
  );
}
