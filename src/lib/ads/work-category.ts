/**
 * Drilling vs pump/service split for Jobber quotes, jobs and invoices (by title).
 * Rule (documented on the dashboard under Sources & definitions):
 *   drilling     = title mentions drill / new well / deepen / well destruction / abandon / pilot or test hole
 *   service_call = title starts with "Service call" (the $200 diagnostic visit; Jobber auto-creates these quotes when a job is booked)
 *   pump         = everything else (pump, motor, booster, tank, filter, pressure tank, pull & inspect, video survey, repairs)
 */
export type WorkCategory = 'drilling' | 'pump' | 'service_call';
export const WORK_CATEGORIES: WorkCategory[] = ['drilling', 'pump', 'service_call'];
export const WORK_CATEGORY_LABEL: Record<WorkCategory, string> = { drilling: 'Drilling', pump: 'Pump & service', service_call: 'Service calls' };

const DRILLING = /\b(drill\w*|new well|deepen\w*|well destruction|destroy|abandon\w*|pilot hole|test hole|well construction)\b/i;
const SERVICE_CALL = /^\s*service\s*call\b/i;

/** Site walks / site visits / walk-throughs: an estimate visit, not booked work. Counted apart from jobs booked. */
const SITE_VISIT = /\b(site\s*walk|site\s*visit|walk[-\s]?through|job\s*walk)\b/i;
export function isSiteVisit(title: string | null | undefined): boolean { return SITE_VISIT.test(title ?? ''); }

/** Pump work whose title contains a drilling keyword: "New Well Pump System" (a pump for a well), "Deepen Pump Setting" (lowering the pump). */
const PUMP_PHRASES = /\bnew\s+well\s+pump\b|\bdeepen\w*\s+(the\s+)?pump(\s+setting)?\b/gi;

export function workCategory(title: string | null | undefined): WorkCategory {
  // "Pull … with Drill Rig" / fishing jobs use the rig but are pump work.
  const t = (title ?? '').trim().replace(/\b(with|using|w\/)\s+(the\s+|a\s+)?drill\s*rig\b/gi, '').replace(PUMP_PHRASES, 'pump');
  if (DRILLING.test(t)) return 'drilling';
  if (SERVICE_CALL.test(t)) return 'service_call';
  return 'pump';
}

export const WORK_CATEGORY_RULE =
  'Drilling vs pump: classified from the Jobber title (quote title; for invoices and jobs, the job title). Drilling = title mentions drill, new well, deepening, well destruction/abandonment, pilot or test hole ("New Well Pump System" and "Deepen Pump Setting" are pump work). Invoices with no job use the invoice subject. Service calls = title starts with "Service call" (the $200 diagnostic visit; Jobber auto-creates these quotes when a job is booked, so they are shown separately and not mixed into quote dollars). The Service calls card counts Jobber jobs titled "Service call…" created in the range (booked) and completed in the range; service-call quotes are not counted there. Pump & service = everything else (pumps, motors, boosters, tanks, filters, pull & inspect, video survey, and pulls/fishing done "with drill rig"). Site walks / site visits / walk-throughs are estimate visits: they are not counted as jobs booked or completed in the type cards (shown as "+N site walks"); the headline Jobs booked counts every other Jobber job created. Internal, training, and test jobs are excluded from every type card (the brighton test client, and titles such as training, shop meeting, practice, or a job titled only "test"); water test, pump test, flow test, and test hole jobs still count.';
