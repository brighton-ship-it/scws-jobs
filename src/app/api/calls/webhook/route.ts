import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { finalStatusPatch } from '@/lib/phone-calls/final-status';
import { confirmedAbandon, notifyMissedInboundCall } from '@/lib/phone-calls/missed-alert';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Tracking number to source mapping
const TRACKING_NUMBERS: Record<string, string> = {
  '+17604630493': 'seo',
  '+17608914264': 'yelp',
  '+17604540365': 'apple_maps',
  '+17603312502': 'google_ads',
  '+17608250520': 'google_ads_drilling',
  '+17608256285': 'google_ads_weekend',
  '+17602791262': 'gbp_ramona',
  '+19516510957': 'gbp_anza',
  '+17604937719': 'direct',
  '+17608238910': 'direct_mail',
  '+18773863995': 'toll_free',
  '+17608237963': 'line_7963',
  '+17604408520': 'main_line',
  '+17607895955': 'ransom_line',
};

export async function POST(request: NextRequest) {
  try {
    const { params, valid } = await parseTwilio(request);

    // Extract Twilio webhook data
    const callSid = params.CallSid;
    const calledNumber = params.Called || params.To;
    const callerNumber = params.From;
    const callStatus = params.CallStatus;

    // Final-status callback (every number's StatusCallback points here). Close out recorded-line rows that
    // never got a dial result (hung up during the notice, or the dial action never arrived). Rows that already
    // have a dial status, and answered calls whose dial result lands during a short wait, are left alone.
    const patch = valid ? finalStatusPatch(params) : null;
    if (patch && callSid) {
      const db: any = optionalServiceClient();
      if (db) {
        try {
          const { data: existing } = await db.from('inbound_call_recordings')
            .select('call_sid, caller_number, tracking_number, source, started_at, dial_status, processing_status')
            .eq('call_sid', callSid).maybeSingle();
          const decision = await confirmedAbandon({
            params,
            row: existing ?? null,
            reread: async () => {
              const again = await db.from('inbound_call_recordings').select('dial_status, processing_status').eq('call_sid', callSid).maybeSingle();
              return again?.data ?? null;
            },
          });
          if (!decision.closeOut) {
            console.log(`[calls/webhook] final ${callStatus} ${callSid}: ${decision.reason === 'dial-arrived' ? 'dial result arrived, no missed alert' : existing ? `left as is (dial=${existing.dial_status} processing=${existing.processing_status})` : 'no recorded-line row'}`);
          } else {
            const { data, error } = await db.from('inbound_call_recordings').update({ ...patch, summary: decision.summary || patch.summary })
              .eq('call_sid', callSid).is('dial_status', null).eq('processing_status', 'pending')
              .select('call_sid, caller_number, tracking_number, source, started_at');
            if (error) console.error('[calls/webhook] final status update failed', error.message);
            else if (data?.length) {
              console.log(`[calls/webhook] final ${callStatus} ${callSid}: closed as missed before Mike (${decision.phase})`);
              const row = data[0];
              const length = parseInt(params.CallDuration || '', 10);
              try {
                await notifyMissedInboundCall({
                  callSid,
                  caller: row.caller_number || callerNumber,
                  called: row.tracking_number || calledNumber,
                  source: row.source,
                  startedAt: row.started_at,
                  phase: decision.phase,
                  noticePlayed: decision.noticePlayed,
                  ringSeconds: decision.ringSeconds,
                  callLengthSeconds: Number.isFinite(length) ? length : null,
                }, db);
              } catch (err) { console.error('[calls/webhook] missed alert failed', err instanceof Error ? err.message : err); }
            } else {
              console.log(`[calls/webhook] final ${callStatus} ${callSid}: dial result arrived before close-out`);
            }
          }
        } catch (e) { console.error('[calls/webhook] final status update failed', e instanceof Error ? e.message : e); }
      }
      return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', { headers: { 'Content-Type': 'text/xml' } });
    }
    
    // Determine source from tracking number
    const source = TRACKING_NUMBERS[calledNumber] || 'unknown';
    
    // No database write here. The old write targeted public.calls, which no longer exists, so every call
    // logged a PGRST205 error. This line only bridges the caller to Mike; Mike's own webhook
    // (/api/receptionist/webhook) records the call in receptionist_calls, which the dashboard reads.
    console.log(`[calls/webhook] ${callStatus || 'ringing'} ${source} ${callSid || ''}`);

    // Bridge to Mike (AI receptionist, Vapi line). Live routing for any number whose Voice URL is this route.
    const MIKE_VAPI_NUMBER = '+17604915348';

    // Ensure caller ID is properly formatted (E.164)
    // Note: + in URL form data decodes as space, so we handle that
    let formattedCallerId = callerNumber?.trim() || '';
    // Strip non-digits and re-add +
    const digits = formattedCallerId.replace(/\D/g, '');
    formattedCallerId = digits ? `+${digits}` : '';
    // Fallback to tracking number if caller ID is invalid
    if (!formattedCallerId || digits.length < 10) {
      formattedCallerId = calledNumber;
    }
    
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${formattedCallerId}" timeout="60">
    <Number>${MIKE_VAPI_NUMBER}</Number>
  </Dial>
</Response>`;
    
    return new NextResponse(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('Call webhook error:', error);
    // Always return valid TwiML even on error so the caller still reaches Mike.
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30">
    <Number>+17604915348</Number>
  </Dial>
</Response>`;
    return new NextResponse(fallbackTwiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

// GET endpoint for testing
export async function GET() {
  return NextResponse.json({ 
    status: 'ok', 
    service: 'SCWS Call Tracking Webhook',
    tracking_numbers: TRACKING_NUMBERS,
  });
}
