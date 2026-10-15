const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Ring the shop numbers (simultaneously) with dual-channel recording from answer.
 * Mike says the recording disclosure himself when the call reaches him. */
export function buildInboundTwiml(opts: { shopNumbers: string[]; baseUrl: string; timeout?: number; callerId?: string; actionQuery?: string }): string {
  const base = opts.baseUrl.replace(/\/$/, '');
  const numbers = opts.shopNumbers.map((n) => `<Number>${esc(n)}</Number>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${opts.callerId ? ` callerId="${esc(opts.callerId)}"` : ''} timeout="${opts.timeout ?? 30}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${esc(base)}/api/calls/inbound/recording" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST" action="${esc(base)}/api/calls/inbound/status${esc(opts.actionQuery ?? '')}" method="POST">${numbers}</Dial>
</Response>`;
}

export const EMPTY_RESPONSE = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

/** Test-only simulated shop answer (used when a test number rings itself). */
export function buildSimulatorTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Southern California Well Service, this is the test shop line. How can I help you?</Say>
  <Pause length="9"/>
  <Say voice="Polly.Matthew">Okay, I can have a technician out to Ramona on Thursday morning to look at the pressure tank. We will call you Wednesday to confirm. Thanks for calling.</Say>
  <Pause length="3"/>
</Response>`;
}

/** Voicemail fallback when the forward target doesn't answer (ported lines only). Recording goes through the same pipeline. */
export function buildVoicemailTwiml(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry we missed you. You have reached Southern California Well Service. Please leave your name, number and address after the tone and we will call you back.</Say>
  <Record maxLength="180" playBeep="true" timeout="6" recordingStatusCallback="${esc(base)}/api/calls/inbound/recording" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"/>
  <Say voice="Polly.Joanna">We did not get a message. Goodbye.</Say>
</Response>`;
}
