import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quote GP tracker — SCWS internal',
  robots: { index: false, follow: false, nocache: true },
};

export default function QuotesGpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
