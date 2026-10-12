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

export function workCategory(title: string | null | undefined): WorkCategory {
  const t = (title ?? '').trim();
  if (DRILLING.test(t)) return 'drilling';
  if (SERVICE_CALL.test(t)) return 'service_call';
  return 'pump';
}

export const WORK_CATEGORY_RULE =
  'Drilling vs pump: classified from the Jobber title (quote title; for invoices and jobs, the job title). Drilling = title mentions drill, new well, deepening, well destruction/abandonment, pilot or test hole. Service calls = title starts with "Service call" (the $200 diagnostic visit; Jobber auto-creates these quotes when a job is booked, so they are shown separately and not mixed into quote dollars). Pump & service = everything else (pumps, motors, boosters, tanks, filters, pull & inspect, video survey).';
