import { NextRequest, NextResponse } from 'next/server';
import { authorizeCollectionsRequest } from '@/lib/collections/batch-auth';
import { loadCollectionsInvoice } from '@/lib/collections/pay-link-sms';
import { runCollectionsSmsBatch, type SmsBatchInput } from '@/lib/collections/sms-batch';
import { createSupabaseCollectionsStore } from '@/lib/collections/supabase-store';
import { listCollectionsOptOuts, sendViaMessagingService } from '@/lib/collections/twilio-send';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/collections/sms-batch
 * Auth: Bearer ADMIN_API_KEY or CRON auth.
 * dryRun defaults to true. Live sends use the collections Messaging Service.
 */
export async function POST(request: NextRequest) {
  const auth = authorizeCollectionsRequest(request, process.env);
  if (!auth.ok) {
    console.warn('[collections] sms-batch unauthorized');
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: SmsBatchInput = {};
  try {
    body = (await request.json()) as SmsBatchInput;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  try {
    const result = await runCollectionsSmsBatch(body, {
      loadInvoice: (ref) => loadCollectionsInvoice(ref),
      store: createSupabaseCollectionsStore(),
      sendSms: async (input) => {
        const sent = await sendViaMessagingService({ to: input.to, body: input.body });
        if (sent.ok) return { sid: sent.sid };
        return { error: sent.error, errorCode: sent.errorCode };
      },
      listTwilioOptOuts: () => listCollectionsOptOuts(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    const status = result.ok ? 200 : result.reason === 'missing_invoices' ? 400 : 503;
    return NextResponse.json(result, { status });
  } catch (error) {
    console.error('[collections] sms-batch failed', error instanceof Error ? error.message : 'error');
    return NextResponse.json({ ok: false, error: 'batch_failed' }, { status: 500 });
  }
}
