import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import { authorizeCronRequest, cronUnauthorizedLog } from '@/lib/cron-auth';
import { OFFICE_ALERT_EMAILS } from '@/lib/receptionist/office-callback';
import { buildCallEmail, type CallOutcome } from '@/lib/receptionist/call-email';
import {
  FALLBACK_MARKER,
  FALLBACK_MAX_AGE_MS,
  FALLBACK_MIN_AGE_MS,
  isFallbackCandidate,
} from '@/lib/receptionist/alert-fallback';

/**
 * Mike's mid-call emergency/callback tools no longer email; the end-of-call
 * report sends the single office email. If that report never arrives (no
 * receptionist_calls row for the call), page the office once from the saved
 * booking_requests row so an emergency is never silent.
 */
export async function POST(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (!cronAuth.ok) {
    cronUnauthorizedLog(cronAuth.reason);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const now = Date.now();
  const since = new Date(now - FALLBACK_MAX_AGE_MS).toISOString();
  const { data: rows, error } = await supabase
    .from('booking_requests')
    .select('id, service_type, customer_name, phone, email, address, city, notes, vapi_call_id, created_at')
    .not('vapi_call_id', 'is', null)
    .in('service_type', ['Emergency', 'Callback'])
    .gte('created_at', since);
  if (error) {
    console.error('[AlertFallback] lookup failed:', error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const sent: string[] = [];
  for (const row of (rows || []) as any[]) {
    if (!isFallbackCandidate(row, now)) continue;
    const { data: callRow } = await supabase
      .from('receptionist_calls')
      .select('id')
      .eq('vapi_call_id', row.vapi_call_id)
      .maybeSingle();
    if (callRow) continue; // end-of-call report arrived and sent the email

    // Claim first so a retry or overlapping run cannot send twice.
    const { data: claimed } = await (supabase as any)
      .from('booking_requests')
      .update({ notes: `${row.notes || ''}\n${FALLBACK_MARKER}`.trim() } as any)
      .eq('id', row.id)
      .not('notes', 'ilike', `%${FALLBACK_MARKER}%`)
      .select('id');
    if (!claimed || claimed.length === 0) continue;

    const emergency = row.service_type === 'Emergency';
    const outcome: CallOutcome = {
      kind: emergency ? 'emergency' : 'callback',
      emergency,
      callback: !emergency,
      booked: false,
      name: String(row.customer_name || '').startsWith('Caller:') ? '' : String(row.customer_name || ''),
      phone: String(row.phone || ''),
      email: String(row.email || ''),
      address: String(row.address || ''),
      city: String(row.city || ''),
      issue: String((String(row.notes || '').match(/Reason: (.+)/) || [])[1] || ''),
      window: '',
      windowShort: '',
      technician: '',
      jobberUrl: '',
      jobId: '',
    };
    const built = buildCallEmail({
      outcome,
      summary: 'The call-ended report from the phone system never arrived. This alert comes from what Mike saved during the call. Check the call log for the full transcript.',
      appUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app',
    });
    for (const to of OFFICE_ALERT_EMAILS) {
      try {
        await sendEmail({ to, subject: built.subject, text: built.text, html: textToHtml(built.text) });
      } catch (err) {
        console.error(`[AlertFallback] email to ${to} failed:`, err);
      }
    }
    sent.push(row.id);
  }

  return NextResponse.json({ ok: true, minAgeMs: FALLBACK_MIN_AGE_MS, sent });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
