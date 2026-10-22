const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Child-leg callback so we know whether the shop or Mike picked up. `answered` fires when they do. */
function numberNoun(base: string, number: string, party: 'shop' | 'mike'): string {
  const cb = `${base}/api/calls/inbound/leg?party=${party}`;
  return `<Number statusCallback="${esc(cb)}" statusCallbackEvent="answered completed" statusCallbackMethod="POST">${esc(number)}</Number>`;
}

/** Ring the shop, then Mike.
 * `nextNumber` is Mike's Vapi line. It is the next <Number> in the same <Dial sequential>,
 * so Twilio dials him the moment the shop leg times out. He is not behind the Google Voice
 * ring group's own forward, and there is no second webhook before his phone rings.
 * The notice plays before any ringing. Mike still says it himself when the call reaches him. */
export function buildInboundTwiml(opts: { shopNumbers: string[]; baseUrl: string; timeout?: number; callerId?: string; actionQuery?: string; notice?: string; nextNumber?: string | null }): string {
  const base = opts.baseUrl.replace(/\/$/, '');
  const numbers = [
    ...opts.shopNumbers.map((n) => numberNoun(base, n, 'shop')),
    ...(opts.nextNumber && !opts.shopNumbers.includes(opts.nextNumber) ? [numberNoun(base, opts.nextNumber, 'mike')] : []),
  ].join('');
  const sequential = opts.nextNumber && !opts.shopNumbers.includes(opts.nextNumber) ? ' sequential="true"' : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${opts.notice ? `<Say voice="Polly.Joanna-Neural">${esc(opts.notice)}</Say>` : ''}<Dial${opts.callerId ? ` callerId="${esc(opts.callerId)}"` : ''} timeout="${opts.timeout ?? 30}"${sequential} answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${esc(base)}/api/calls/inbound/recording" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST" action="${esc(base)}/api/calls/inbound/status${esc(opts.actionQuery ?? '')}" method="POST">${numbers}</Dial>
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

/** No-answer handoff to the AI receptionist. Recorded through the same pipeline.
 * Pass an action query of rolled=1 so the follow-up callback does not dial Mike again. */
export function buildAiHandoffTwiml(aiNumber: string, baseUrl: string, actionQuery?: string): string {
  const base = baseUrl.replace(/\/$/, '');
  const action = actionQuery ? ` action="${esc(base)}/api/calls/inbound/status${esc(actionQuery)}" method="POST"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="30" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${esc(base)}/api/calls/inbound/recording" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST"${action}>${numberNoun(base, aiNumber, 'mike')}</Dial>
</Response>`;
}

/** After hours: recording notice, then straight to the AI receptionist (no ring group). Recorded through the same
 * pipeline; the <Dial action> logs how the leg ended (no ai=1 on it, so no second handoff). */
export function buildAfterHoursAiTwiml(opts: { aiNumber: string; baseUrl: string; notice?: string; actionQuery?: string }): string {
  const base = opts.baseUrl.replace(/\/$/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${opts.notice ? `<Say voice="Polly.Joanna-Neural">${esc(opts.notice)}</Say>` : ''}<Dial timeout="30" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${esc(base)}/api/calls/inbound/recording" recordingStatusCallbackEvent="completed" recordingStatusCallbackMethod="POST" action="${esc(base)}/api/calls/inbound/status${esc(opts.actionQuery ?? '')}" method="POST">${numberNoun(base, opts.aiNumber, 'mike')}</Dial>
</Response>`;
}
