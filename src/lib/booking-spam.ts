/**
 * Gibberish check for /api/booking (bots submit random strings like "xKzqTvbWpLmR").
 * Only letters count: digits, ZIP codes, punctuation and common street abbreviations
 * (St, Rd, Hwy, Ln, Blvd, Dr, Ct, Pkwy, N/S/E/W, Apt, Ste...) are ignored, so short real
 * addresses like "123 Hwy 79" or "1077 Main St 92065" pass.
 */
const ABBR = /\b(st|rd|hwy|ln|blvd|dr|ct|cir|pkwy|pl|trl|ter|sq|hts|mtn|mt|n|s|e|w|ne|nw|se|sw|apt|ste|unit|po|box|ca|us|sr|jr|ii|iii|iv)\b\.?/gi;
export function isGibberish(text: unknown, kind: 'name' | 'address' = 'name'): boolean {
  if (typeof text !== 'string') return false;
  const t = kind === 'address' ? text.replace(ABBR, ' ') : text;
  const letters = t.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 8) return false;
  const vowels = (letters.match(/[aeiouyAEIOUY]/g) || []).length;
  if (vowels / letters.length < 0.15) return true;
  if (/[bcdfghjklmnpqrstvwxz]{6,}/i.test(letters.replace(/(sch|tch|ght|str|nch|rth|ngst)/gi, ''))) return true;
  const caps = text.match(/[a-z][A-Z][a-z]/g);
  return !!caps && caps.length > 2;
}
