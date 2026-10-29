/**
 * POST /api/sms/forward — Twilio SMS webhook for every SCWS line except toll-free (main, Ransom, 823-7963 and the tracking lines).
 * Relays each inbound text (and MMS media) to the office (SMS_FORWARD_TO, default Liz) from the registered
 * Messaging Service. Never replies to the texter, never touches Jobber. X-Twilio-Signature is required.
 * Each text is also logged to sms_conversations so it shows on the dashboard Messages page (best effort).
 */
import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { EMPTY_TWIML, forwardMessagingServiceSid, mediaUrls, planForward } from '@/lib/sms-forward/forward';
import { optionalServiceClient } from '@/lib/supabase/service';
import { textConfig } from '@/lib/receptionist/missed-call-text';
import { handleTextReply, sendOfficeText, type ReplyOutcome } from '@/lib/receptionist/missed-call-text-run';
import { recordInboundSms } from '@/lib/receptionist/missed-call-inbound';
import type { TextAgentTools } from '@/lib/receptionist/text-agent';
import { handleLookupCustomer } from '@/lib/receptionist/lookup-customer';
import { checkServiceArea } from '@/lib/receptionist/service-area';
import { handleCheckSchedule } from '@/lib/receptionist/check-schedule';
import { handleBookServiceCall } from '@/lib/receptionist/book-service-call';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Mike's booking tools for the AI text thread (missed-call follow-up). */
function textAgentTools(db: any): TextAgentTools {
  return {
    lookupCustomer: (phone) => handleLookupCustomer(phone),
    checkServiceArea: async (location) => checkServiceArea(location),
    checkSchedule: ({ phone, city, address }) => handleCheckSchedule({ phone, city, address, intent: 'book' }),
    bookJob: ({ phone, name, address, city, startAt, notes }) => handleBookServiceCall({ phone, name, address, city, startAt, notes }),
    handOff: async ({ phone, reason, urgent, summary }) => {
      const last4 = phone.replace(/\D/g, '').slice(-4);
      try {
        await db?.from('booking_requests').insert({
          service_type: urgent ? 'Emergency' : 'Callback', customer_name: `Texter: (${phone.slice(-10, -7)}) ${phone.slice(-7, -4)}-${last4}`,
          phone: phone.replace(/\D/g, ''), address: '', city: '', status: 'pending', source: 'sms_ai',
          notes: `💬 Missed-call text thread: ${reason}. ${summary}`.slice(0, 2000),
        });
      } catch (e) { console.error('[missed-call-text] handoff row failed', e instanceof Error ? e.message : e); }
      await sendOfficeText(`${urgent ? 'URGENT ' : ''}Text follow-up needs you: ${phone} - ${reason}. ${summary}`, process.env);
      return { ok: true, message: 'The office has it and will reach out.' };
    },
  };
}
const xml = (b: string, status = 200) => new NextResponse(b, { status, headers: { 'Content-Type': 'text/xml' } });

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });

  const plan = planForward(params);
  const now = new Date();
  // Missed-call text thread (flag off = skipped without any read). Liz still gets every text below.
  let ai: ReplyOutcome | null = null;
  if (textConfig().mode !== 'off' && params.From && plan.action === 'forward') {
    try {
      const db: any = optionalServiceClient();
      if (db) ai = await handleTextReply({ db, from: params.From, body: params.Body || '', env: process.env, now, tools: textAgentTools(db) });
    } catch (e) { console.error('[missed-call-text] reply failed', e instanceof Error ? e.message : e); }
    if (ai?.handled && ai.label) plan.body = `[${ai.label}] ${plan.body}`.slice(0, 1500);
  }
  // When the text agent answers, it already stored this reply on the thread. Store it here
  // only when that did not happen (flag off, thread closed, HELP, no model). Does not send.
  if (plan.action === 'forward' && params.From && !ai?.handled) {
    const text = (params.Body || '').trim();
    const photos = mediaUrls(params).length;
    const inbound = text || (photos ? `(${photos} photo${photos === 1 ? '' : 's'})` : '');
    if (inbound) {
      try {
        const db: any = optionalServiceClient();
        if (db) await recordInboundSms(db, { from: params.From, body: inbound, sid: params.MessageSid || null, now });
      } catch (e) { console.error('[missed-call-text] inbound log failed', e instanceof Error ? e.message : e); }
    }
  }
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
        if (ai?.handled && ai.reply) messages.push({ role: 'assistant', content: ai.reply, timestamp: new Date().toISOString(), source: 'missed_call_text_ai' });
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
