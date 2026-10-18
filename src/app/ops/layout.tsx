import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OpsNav } from '@/components/ops/OpsNav';

/**
 * Internal ops pages (office only).
 *
 * Quote GP tracker: /ops/quotes-gp
 * Auth env: QUOTES_GP_KEY (fallback ADMIN_SECRET), or a logged-in CRM session.
 * Open: https://<this-app>/ops/quotes-gp
 *   or  https://<this-app>/ops/quotes-gp?key=<QUOTES_GP_KEY>
 * Not on the public marketing site. robots noindex. Read-only.
 */

export const dynamic = 'force-dynamic';
export const revalidate = false;

export const metadata: Metadata = {
  title: 'SCWS Internal Ops',
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="h-1 bg-emerald-700" />
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-end justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Southern California Well Service
            </p>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Office ops</h1>
          </div>
          <p className="text-xs text-slate-500">Internal · not indexed</p>
        </div>
        <Suspense fallback={null}><OpsNav /></Suspense>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
