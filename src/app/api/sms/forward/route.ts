/**
 * POST /api/sms/forward — Twilio SMS webhook for the ported main (440-8520) and Ransom (789-5955) lines.
 * Relays each inbound text (and MMS media) to the office (SMS_FORWARD_TO, default Liz) from the registered
 * Messaging Service. Never replies to the texter, never touches Jobber. X-Twilio-Signature is required.
 * Each text is also logged to sms_conversations so it shows on the dashboard Messages page (best effort).
 */
import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { EMPTY_TWIML, forwardMessagingServiceSid, mediaUrls, planForward } from '@/lib/sms-forward/forward';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';
const xml = (b: string, status = 200) => new NextResponse(b, { status, headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });

  const plan = planForward(params);
  const sent: Array<{ to: string; sid?: string; error?: string }> = [];
  if (plan.action === 'forward') {
    const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const token = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (sid && token) {
      const client = twilio(sid, token);
      for (const to of plan.to) {
        try {
          const m = await client.messages.create({
            to, body: plan.body, messagingServiceSid: forwardMessagingServiceSid(),
            ...(plan.mediaUrl.length ? { mediaUrl: plan.mediaUrl } : {}),
          });
          sent.push({ to, sid: m.sid });
        } catch (e) {
          const code = (e as { code?: unknown })?.code;
          console.error('[sms-forward] send failed', to.slice(-4), code ?? (e instanceof Error ? e.message : e));
          sent.push({ to, error: String(code ?? 'send_failed') });
        }
      }
    } else {
      console.error('[sms-forward] Twilio not configured');
    }
  } else {
    console.log('[sms-forward] skip', plan.reason, (params.To || '').slice(-4));
  }

  // Dashboard log (best effort; never blocks the forward).
  if (plan.action === 'forward' && params.From) {
    try {
      const db: any = optionalServiceClient();
      if (db) {
        const { data: existing } = await db.from('sms_conversations').select('messages').eq('phone_number', params.From).maybeSingle();
        const messages = Array.isArray(existing?.messages) ? existing.messages : [];
        messages.push({
          role: 'user', content: params.Body || '', timestamp: new Date().toISOString(), sid: params.MessageSid || null,
          to: params.To, line: plan.line.label, source: plan.line.source, media: mediaUrls(params),
          forwarded: sent.map((s) => ({ to_last4: s.to.slice(-4), sid: s.sid ?? null, error: s.error ?? null })),
        });
        await db.from('sms_conversations').upsert(
          { phone_number: params.From, messages, updated_at: new Date().toISOString() },
          { onConflict: 'phone_number' },
        );
      }
    } catch (e) { console.error('[sms-forward] log failed', e instanceof Error ? e.message : e); }
  }

  return xml(EMPTY_TWIML);
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'SCWS inbound text forward' });
}
