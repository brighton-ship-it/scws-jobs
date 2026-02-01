// Force dynamic rendering for all dashboard pages
export const dynamic = 'force-dynamic';
export const revalidate = false;

import { DashboardProviders } from '@/components/providers/DashboardProviders';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardProviders>{children}</DashboardProviders>;
}
