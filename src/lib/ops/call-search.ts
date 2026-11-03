/** Calls-dashboard search: full number in any format (last 10 digits), 3+ digit partials (last 4 = suffix), or name text. */
export type CallSearchFields = { name?: string | null; phones?: Array<string | null | undefined> };

const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');
const fold = (s: string | null | undefined) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** National 10 digits when a leading US 1 is present ("19515913295" -> "9515913295"). */
const national = (d: string) => (d.length === 11 && d.startsWith('1') ? d.slice(1) : d.length > 10 ? d.slice(-10) : d);

export function matchesCallSearch(fields: CallSearchFields, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const isNumeric = /^[\s\d()+\-.•]+$/.test(q);
  if (isNumeric) {
    let qd = digits(q);
    if (qd.length < 3) return false;
    const phones = (fields.phones ?? []).map(digits).filter(Boolean);
    if (qd.length >= 10) {
      const want = national(qd).slice(-10);
      return phones.some((p) => p.length >= 10 && national(p).slice(-10) === want);
    }
    // "1 951 591" style partials: drop a leading 1 country code.
    if (qd.length > 3 && qd.startsWith('1') && /^\s*\+?1[\s\-.(]/.test(q)) qd = qd.slice(1);
    if (qd.length === 4) return phones.some((p) => p.endsWith(qd));
    return phones.some((p) => (p.length >= 10 ? national(p) : p).includes(qd));
  }
  const name = fold(fields.name);
  return !!name && name.includes(fold(q));
}
