/**
 * Server-side booking consent gate for Mike (voice receptionist).
 * book_job / bookJob / bookServiceCall must carry `callerYes`: the caller's exact words saying yes
 * to the specific slot. We refuse to book (test calls included) when:
 *  - callerYes is missing,
 *  - it is a question, a maybe/hedge, a "sooner?" ask, a "check with my wife", or a no,
 *  - it is a bare filler ("yeah", "okay", "sure") that Mike didn't confirm with a hold/lock-in question,
 *  - it doesn't match what the caller actually said in the live transcript (when Vapi sends one),
 *  - the caller's latest words in the transcript are a hedge, a "sooner?" ask or a no.
 * On refusal Mike is told to ask "Want me to hold [slot] for you?" and wait.
 */

export type ConsentTurn = { role: 'bot' | 'user'; text: string };

export type ConsentDecision =
  | { ok: true; callerYes: string }
  | { ok: false; code: ConsentRejectCode; result: Record<string, unknown> };

export type ConsentRejectCode =
  | 'missing_caller_yes'
  | 'question'
  | 'hedge_or_no'
  | 'not_a_yes'
  | 'unconfirmed_filler'
  | 'not_in_transcript'
  | 'latest_words_not_yes';

export const BOOK_TOOL_NAMES = new Set(['book_job', 'bookJob', 'bookServiceCall']);

const NEUTRAL_PHRASES = /\b(no problem|no worries|no rush|not a problem)\b/g;

// Maybes, "sooner?" asks, deferrals and no's. Any of these means: not a yes to this slot.
const HEDGE_OR_NO =
  /\b(sooner|earlier|any ?way|anything (sooner|earlier)|could (some|any) ?one|can (some|any) ?one|is there|maybe|not sure|unsure|i think|i guess|i suppose|probably|possibly|perhaps|might|check with|talk (to|with)|ask (my|him|her)|run (it|that) by|let me|hold on|hang on|wait|don'?t|do not|not yet|not right now|no|nope|nah|call (you )?back|callback|husband|wife|spouse|partner|later|hmm+|um+|uh+ huh|hold off|think about)\b/;

const EXPLICIT_YES =
  /\b(yes|yeah|yea|yep|yup|sure|ok|okay|alright|all right|absolutely|definitely|perfect|sounds good|sounds great|that works|works for me|that'?ll work|book it|book me|book that|put me down|lock it in|go ahead|please do|do it|let'?s do it|that'?s fine|fine|correct|great)\b/;

const FILLER_WORDS = new Set([
  'yeah', 'yea', 'yep', 'yup', 'ok', 'okay', 'sure', 'alright', 'right', 'fine', 'uh', 'huh', 'uhhuh', 'mm', 'hmm', 'mhm', 'mmhmm', 'look', 'so', 'well', 'oh',
]);

// Mike's confirmation question that makes a following bare "yeah" a real yes.
const RECHECK_PHRASE = /(lock (that|it|this)? ?in|want me to hold|should i (hold|book|lock)|hold (that|it|the|wednesday|monday|tuesday|thursday|friday|saturday|sunday|this)[^.?!]* for you|book (that|it) for you|confirm (that|the) (slot|time|visit))/i;

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/uh-huh/g, 'uhhuh')
    .replace(/mm-hmm/g, 'mmhmm')
    .replace(/[^a-z0-9'?\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  return norm(s).replace(/\?/g, ' ').split(' ').filter(Boolean);
}

export function isHedgeOrNo(text: string): boolean {
  return HEDGE_OR_NO.test(norm(text).replace(NEUTRAL_PHRASES, ' '));
}

export function isBareFiller(text: string): boolean {
  const w = words(text);
  return w.length > 0 && w.every((x) => FILLER_WORDS.has(x));
}

/** Pull bot/user turns from a Vapi server message (tool-calls / function-call). */
export function consentTurnsFromVapiBody(body: any): ConsentTurn[] {
  const message = body?.message || body || {};
  const raw =
    message.artifact?.messages ||
    body?.artifact?.messages ||
    message.messages ||
    message.call?.messages ||
    body?.call?.messages ||
    [];
  if (!Array.isArray(raw)) return [];
  const out: ConsentTurn[] = [];
  for (const m of raw) {
    const role = m?.role;
    const text = typeof m?.message === 'string' ? m.message : typeof m?.content === 'string' ? m.content : '';
    if (!text) continue;
    if (role === 'user') out.push({ role: 'user', text });
    else if (role === 'bot' || role === 'assistant') out.push({ role: 'bot', text });
  }
  return out;
}

/** Caller text after Mike's last turn, plus Mike's last turn before it. */
function latestExchange(turns: ConsentTurn[]): { lastBot: string; latestUser: string } {
  let i = turns.length - 1;
  const user: string[] = [];
  while (i >= 0 && turns[i].role === 'user') { user.unshift(turns[i].text); i--; }
  // If the latest turn is Mike's (e.g. "1 moment" filler), step back to the caller's last words.
  if (user.length === 0) {
    while (i >= 0 && turns[i].role === 'bot') i--;
    while (i >= 0 && turns[i].role === 'user') { user.unshift(turns[i].text); i--; }
  }
  const bot: string[] = [];
  while (i >= 0 && turns[i].role === 'bot') { bot.unshift(turns[i].text); i--; }
  return { lastBot: bot.join(' '), latestUser: user.join(' ') };
}

export function slotLabel(startAt: unknown): string {
  const d = new Date(String(startAt || ''));
  if (Number.isNaN(d.getTime())) return 'that time';
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'America/Los_Angeles' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).format(d);
  return `${day} at ${time.replace(':00', '')}`;
}

function reject(code: ConsentRejectCode, startAt: unknown, why: string): ConsentDecision {
  const slot = slotLabel(startAt);
  return {
    ok: false,
    code,
    result: {
      booked: false,
      canConfirm: false,
      mayBook: false,
      consentRequired: true,
      reason: code,
      message:
        `NOT BOOKED (${why}). The caller has not clearly said yes to this slot. ` +
        `Ask: "Want me to hold ${slot} for you?" and wait for their answer. ` +
        `Call book_job again only after a clear yes ("yes", "yes, book it", "that works"), and pass their exact words in callerYes. ` +
        `If they say no, maybe, want sooner, or need to check with someone, don't book: make one office alert instead. ` +
        `Never say they're booked, set, or down for a time.`,
    },
  };
}

export function checkBookingConsent(params: Record<string, unknown>, turns: ConsentTurn[] = []): ConsentDecision {
  const startAt = params.startAt ?? params.slotId;
  const callerYes = String(params.callerYes ?? params.consent ?? params.callerConsent ?? '').trim();
  if (!callerYes) return reject('missing_caller_yes', startAt, 'no callerYes words were sent');

  const n = norm(callerYes);
  if (n.includes('?')) return reject('question', startAt, 'the caller asked a question');
  if (isHedgeOrNo(n)) return reject('hedge_or_no', startAt, 'the caller hedged, asked for sooner, or said no');
  if (!EXPLICIT_YES.test(n)) return reject('not_a_yes', startAt, 'those words are not a yes');

  const haveTranscript = turns.some((t) => t.role === 'user');
  const { lastBot, latestUser } = haveTranscript ? latestExchange(turns) : { lastBot: '', latestUser: '' };

  if (isBareFiller(callerYes) && !(haveTranscript && RECHECK_PHRASE.test(lastBot))) {
    return reject('unconfirmed_filler', startAt, 'a bare "yeah"/"okay" is not confirmed yet');
  }

  if (haveTranscript) {
    if (isHedgeOrNo(latestUser) || !EXPLICIT_YES.test(norm(latestUser))) {
      return reject('latest_words_not_yes', startAt, "the caller's latest words were not a yes");
    }
    const said = new Set(words(latestUser));
    const yesWords = words(callerYes);
    const hits = yesWords.filter((w) => said.has(w)).length;
    if (yesWords.length && hits / yesWords.length < 0.6) {
      return reject('not_in_transcript', startAt, "callerYes doesn't match what the caller said");
    }
    if (isBareFiller(latestUser) && !RECHECK_PHRASE.test(lastBot)) {
      return reject('unconfirmed_filler', startAt, 'a bare "yeah"/"okay" is not confirmed yet');
    }
  }
  return { ok: true, callerYes };
}
