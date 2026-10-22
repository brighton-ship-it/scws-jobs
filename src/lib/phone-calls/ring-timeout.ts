/**
 * Business-hours shop ring before Mike.
 *
 * Twilio adds about 5 seconds on top of <Dial timeout> ("a timeout value of 10
 * seconds" rings closer to 15). The value below is how long the caller should
 * hear the shop ring. The TwiML attribute is that minus the buffer.
 *
 * PHONE_CALL_RING_TIMEOUT and the voice URL ?timeout= are this same caller-facing
 * number. The live voice URLs pass timeout=15, which used to be copied straight
 * into TwiML and rang about 20 seconds.
 */
export const BUSINESS_HOURS_RING_SECONDS = 15;
/** Observed on the 7:29 AM ads call: the recording notice ends and the shop leg starts 5s later. */
export const RECORDING_NOTICE_SECONDS = 5;
export const TWILIO_DIAL_TIMEOUT_BUFFER_SECONDS = 5;

export function desiredRingSeconds(queryTimeout: string | null | undefined, env: NodeJS.ProcessEnv = process.env): number {
  const raw = (queryTimeout ?? '').trim() || env.PHONE_CALL_RING_TIMEOUT || String(BUSINESS_HOURS_RING_SECONDS);
  const t = parseInt(raw, 10);
  const n = Number.isFinite(t) ? t : BUSINESS_HOURS_RING_SECONDS;
  return Math.min(Math.max(n, 10), 120);
}

/** Attribute to put on <Dial timeout>. Twilio's buffer brings the real ring up to desiredRingSeconds. */
export function dialTimeoutAttribute(desiredSeconds: number): number {
  return Math.max(5, desiredSeconds - TWILIO_DIAL_TIMEOUT_BUFFER_SECONDS);
}
