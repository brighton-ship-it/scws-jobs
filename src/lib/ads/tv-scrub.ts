/**
 * TV mode can run on a shop screen techs see. It must never carry collections or payment info,
 * so the API strips it server-side for ?view=tv (not just hidden in the page).
 */
const PAYMENT_KEYS = new Set(['paid', 'cash', 'cashCount', 'paidClients', 'paidValue', 'multiplePaid', 'partPaid', 'balance', 'totalOwed', 'pastDue', 'notDue', 'collectionEmails', 'daysPastDue', 'invoiceNumber']);
const DROP_KEYS = new Set(['invoiceFollowUp', 'gaps', 'sources', 'method', 'debug']);

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEYS.has(k)) continue;
    if (PAYMENT_KEYS.has(k)) { out[k] = typeof v === 'boolean' ? false : null; continue; }
    out[k] = scrub(v);
  }
  return out;
}

export function scrubForTv<T extends Record<string, unknown>>(dash: T): T {
  return scrub(dash) as T;
}
