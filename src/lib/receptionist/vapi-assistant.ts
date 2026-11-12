/**
 * Speech timing for the live Vapi assistant "SCWS Receptionist".
 *
 * The assistant JSON is not stored in this repo (there is no Vapi PATCH path).
 * This value is what to set after merge:
 * startSpeakingPlan.transcriptionEndpointingPlan.onNoPunctuationSeconds
 *
 * The previous wait was one and a half seconds. 1.0 lets Mike take a turn when a caller pauses without
 * punctuation, which is how a voicemail-style monologue (Tim Hixson, Nov 9)
 * ran 47 seconds with no reply. Voice, greeting, and routing are not here.
 * This file does not call Vapi.
 */

export const NO_PUNCTUATION_ENDPOINT_SECONDS = 1.0;

export const VAPI_TRANSCRIPTION_ENDPOINTING_PLAN = {
  onNoPunctuationSeconds: NO_PUNCTUATION_ENDPOINT_SECONDS,
} as const;
