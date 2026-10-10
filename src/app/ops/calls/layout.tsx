import type { Metadata } from 'next';

/** Call-tracking dashboard. Auth: CRM session or office key (QUOTES_GP_KEY / ADMIN_SECRET). TV: /ops/calls/tv?key=… (cookie keeps it signed in 30 days). */
export const metadata: Metadata = {
  title: 'Call tracking — SCWS internal',
  robots: { index: false, follow: false, nocache: true },
};

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
