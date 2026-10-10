import { RECORDING_NOTICE } from './config.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Announce, then ring the shop numbers (simultaneously) with dual-channel recording from answer. */
export function buildInboundTwiml(opts: { shopNumbers: string[]; baseUrl: string; timeout?: number }): string {
  const base = opts.baseUrl.replace(/\/$/, '');
  const numbers = opts.shopNumbers.map((n) => `<Number>${esc(n)}</Number>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${esc(RECORDING_NOTICE)}</Say>
  <Dial timeout="${opts.timeout ?? 30}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${esc(base)}/api/calls/inbound/recording" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST" action="${esc(base)}/api/calls/inbound/status" method="POST">${numbers}</Dial>
</Response>`;
}

export const EMPTY_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
