import type { Metadata } from 'next';

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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Southern California Well Service — internal
            </p>
            <h1 className="text-lg font-bold text-slate-900">Office ops</h1>
          </div>
          <p className="text-xs text-slate-500">Not customer-facing. Not indexed.</p>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
