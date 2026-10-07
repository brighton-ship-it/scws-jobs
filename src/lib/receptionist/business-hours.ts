/**
 * Office hours published on scwellservice.com (verified Oct 2026):
 * Monday–Friday 7 AM–5 PM Pacific, closed weekends, emergencies after hours.
 * Do not promise a callback clock time.
 */

export const BUSINESS_HOURS_SPOKEN =
  'Monday–Friday 7 AM–5 PM Pacific; closed weekends; emergencies handled after hours.';

export function getBusinessHours() {
  return {
    result: {
      hours: 'Monday–Friday 7 AM–5 PM Pacific',
      weekends: 'Closed weekends',
      emergency: 'Emergencies are handled after hours.',
      note: BUSINESS_HOURS_SPOKEN,
    },
  };
}
