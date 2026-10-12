import type { Metadata } from 'next';

/** Business metrics (LTV, CAC, margin, …). Auth: CRM session or office key, same as /ops/calls. */
export const metadata: Metadata = {
  title: 'Metrics — SCWS internal',
  robots: { index: false, follow: false, nocache: true },
};

export default function MetricsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
