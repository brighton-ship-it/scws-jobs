import { Suspense } from 'react';
import { CallsLivePage } from '@/components/ops/CallDashboard';

/** Calls list only, for office staff. Auth: CRM session or ?key=<office key>, same as /ops/calls. */
export default function CallsLive() {
  return <Suspense fallback={null}><CallsLivePage /></Suspense>;
}
