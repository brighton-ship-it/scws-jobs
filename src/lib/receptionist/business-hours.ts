/**
 * Office hours published on scwellservice.com and Google (Oct 18 2026):
 * open 7 days, Monday–Sunday 7 AM–5 PM Pacific, emergencies after hours.
 * Do not promise a callback clock time.
 */

export const BUSINESS_HOURS_SPOKEN =
  'Open 7 days a week, 7 AM–5 PM Pacific, Saturday and Sunday included; emergencies handled after hours.';

export function getBusinessHours() {
  return {
    result: {
      hours: 'Monday–Sunday 7 AM–5 PM Pacific (open 7 days)',
      weekends: 'Open Saturday and Sunday, 7 AM–5 PM Pacific',
      emergency: 'Emergencies are handled after hours.',
      note: BUSINESS_HOURS_SPOKEN,
    },
  };
}
