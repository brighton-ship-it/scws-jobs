/**
 * POST /api/sms/status — Twilio delivery receipt for a missed-call auto-text.
 * Updates delivery_status on missed_call_texts. Never sends a message.
 * X-Twilio-Signature is required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { saveDeliveryStatus } from '@/lib/receptionist/missed-call-inbound';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const sid = params.MessageSid || params.SmsSid || '';
  const status = params.MessageStatus || '';
  if (sid && status) {
    try {
      const db: any = optionalServiceClient();
      if (db) await saveDeliveryStatus(db, { sid, status, error: params.ErrorCode || null, now: new Date() });
    } catch (e) {
      console.error('[missed-call-text] delivery log failed', e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true });
}
