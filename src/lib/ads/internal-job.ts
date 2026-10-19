/**
 * Jobs that are SCWS practicing on itself, not customer work.
 * Checked against Jobber on 2026-10-19 before the rule was chosen:
 *   - Test client "brighton scala" / company "sc well service" holds the training jobs,
 *     shop meetings, and a "Service Call" that is not a customer diagnostic.
 *   - A different client "Brighton scala" (no company) has a real "New Well Drilling" quote.
 *     Only its job titled exactly "test" (#3634) is internal.
 *   - "Sc Well Service" (the company as its own client) has real shop work (water heater, concrete).
 *   - Customer titles that merely contain "test" are paid work: "Flow test", "Pump Test",
 *     "Water sample & flow test", "Test Pump", "test hole". Those stay in the dashboards.
 *   - Warranty jobs ("Warranty Pump install") are real customer work. "Meeting with cheryl" is not a shop meeting.
 */

export const INTERNAL_EXCLUSION_NOTE =
  'Internal, training, and test jobs are excluded (SCWS\'s own brighton test client, and titles such as training, shop meeting, practice, or a job titled only "test"), along with their invoices, payments, quotes, and visits. Customer jobs whose titles merely contain "test" (water test, pump test, flow test, test hole) still count.';

const INTERNAL_TITLE =
  /\b(?:shop|staff|team|crew|safety|company|all[- ]hands|weekly|monthly|tech|office)\s+meeting\b|\bmeeting\s*[-:\u2013]\s*(?:anza|ramona|shop)\b|\binternal\b|\btraining\b|\bshop\s+(?:day|clean[- ]?up|work)\b|\btime\s+off\b|\bPTO\b|\bwarranty admin\b/i;

/** Whole title only. "Pump test" / "Flow test" / "test hole" must not match. */
const BARE_INTERNAL_TITLE = /^(?:test|testing|practice)(?:\s+job)?$/i;

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isScwsCompany(companyName: string | null | undefined): boolean {
  const company = norm(companyName).replace(/\b(inc|llc|co|company)\b/g, '').replace(/\s+/g, ' ').trim().replace(/\bs c\b/g, 'sc');
  return company === 'sc well service' || company === 'scws' || company === 'southern california well service';
}

/**
 * SCWS's own test client. "brighton scala" alone is not enough: a personal Brighton Scala
 * record (no SC Well Service company) is a real client. A one-word name "brighton" is the test client.
 */
export function isInternalClientName(name?: string | null, companyName?: string | null): boolean {
  const n = norm(name);
  if (n === 'brighton') return true;
  if (n !== 'brighton scala') return false;
  return isScwsCompany(companyName);
}

export function isInternalJobTitle(title: string | null | undefined): boolean {
  const raw = String(title ?? '').trim();
  if (!raw) return false;
  if (INTERNAL_TITLE.test(raw)) return true;
  if (/\bpractice\b/i.test(raw) && !/\bbest\s+practice\b/i.test(raw)) return true;
  const bare = norm(raw);
  return BARE_INTERNAL_TITLE.test(bare);
}

export interface InternalWork {
  title?: string | null;
  subject?: string | null;
  clientName?: string | null;
  companyName?: string | null;
  client?: { name?: string | null; companyName?: string | null } | null;
  jobs?: { nodes?: Array<{ title?: string | null } | null> | null } | null;
}

/** True when this job, quote, invoice, or payment belongs to internal/training/test work. */
export function isInternalJob(record: InternalWork | null | undefined): boolean {
  if (!record) return false;
  const name = record.clientName ?? record.client?.name;
  const company = record.companyName ?? record.client?.companyName;
  if (isInternalClientName(name, company)) return true;
  const titles = [record.title, ...(record.jobs?.nodes ?? []).map((job) => job?.title)].filter(
    (title): title is string => typeof title === 'string' && title.trim() !== ''
  );
  if (titles.some((title) => isInternalJobTitle(title))) return true;
  // Invoice subject only when no job title is present (a $5 test invoice can be titled "For Services Rendered").
  if (!titles.length && isInternalJobTitle(record.subject)) return true;
  return false;
}
