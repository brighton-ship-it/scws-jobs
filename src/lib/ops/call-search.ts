/** Calls-dashboard search: full number in any format (last 10 digits), last 4 digits, or name text. */
export type CallSearchFields = { name?: string | null; phones?: Array<string | null | undefined> };

const digits = (s: string | null | undefined) => String(s ?? '').replace(/\D/g, '');

export function matchesCallSearch(fields: CallSearchFields, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const qd = digits(q);
  const phones = (fields.phones ?? []).map(digits).filter(Boolean);
  if (qd.length >= 10) {
    const want = qd.slice(-10);
    if (phones.some((p) => p.length >= 10 && p.slice(-10) === want)) return true;
  } else if (qd.length === 4 && /^[\s\d()+\-.•]*$/.test(q)) {
    if (phones.some((p) => p.endsWith(qd))) return true;
  } else if (qd.length > 0 && qd.length < 10 && /^[\s\d()+\-.]*$/.test(q)) {
    if (phones.some((p) => p.length >= 10 && p.slice(-10).includes(qd))) return true;
  }
  const name = String(fields.name ?? '').toLowerCase();
  return !!name && /[a-z]/i.test(q) && name.includes(q.toLowerCase());
}
