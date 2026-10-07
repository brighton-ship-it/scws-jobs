import { NextRequest, NextResponse } from 'next/server';
import { collectionsAutoreplyEnabled } from '@/lib/collections/policy';
import { handleCollectionsInbound, publicWebhookUrl, twilioParamsFromBody } from '@/lib/collections/inbound';
import { createSupabaseCollectionsStore } from '@/lib/collections/supabase-store';
import { sendViaMessagingService } from '@/lib/collections/twilio-send';

export const dynamic = 'force-dynamic';

/**
 * POST /api/sms/collections-inbound
 * Twilio signature required. Auto-reply is off unless COLLECTIONS_AUTOREPLY_ENABLED=true.
 * A valid request always returns empty TwiML so Twilio keeps the message for the poll routine.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const params = twilioParamsFromBody(raw);
  const result = await handleCollectionsInbound(
    {
      signature: request.headers.get('x-twilio-signature'),
      url: publicWebhookUrl(request),
      params,
      authToken: process.env.TWILIO_AUTH_TOKEN?.trim() || null,
    },
    {
      store: createSupabaseCollectionsStore(),
      autoreplyEnabled: collectionsAutoreplyEnabled(),
      sendSms: async (input) => {
        const sent = await sendViaMessagingService({ to: input.to, body: input.body });
        if (sent.ok) return { sid: sent.sid };
        return { error: sent.error, errorCode: sent.errorCode };
      },
    }
  );

  return new NextResponse(result.body, {
    status: result.status,
    headers: { 'Content-Type': result.contentType },
  });
}
