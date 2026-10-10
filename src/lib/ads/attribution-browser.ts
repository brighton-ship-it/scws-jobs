'use client';

import {
  attributionCookieAssignment,
  attributionFromCookieHeader,
  attributionFromRecord,
  gaClientIdFromCookie,
  gaSessionCookieValue,
  gaSessionIdFromCookie,
  mergeAttribution,
  type AdsAttribution,
} from './attribution';

/** Read the landing URL, `_ga`, and the 90-day cookie, then refresh the cookie. */
export function collectPageAttribution(): AdsAttribution {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return attributionFromRecord(null);
  }
  const header = document.cookie;
  const stored = attributionFromCookieHeader(header);
  const fromQuery = attributionFromRecord(Object.fromEntries(new URLSearchParams(window.location.search).entries()));
  const gaClient = gaClientIdFromCookie(header.split(';').map((part) => part.trim()).find((part) => part.startsWith('_ga='))?.slice(4));
  const gaSession = gaSessionIdFromCookie(gaSessionCookieValue(header));
  const next = mergeAttribution(mergeAttribution(stored, fromQuery), {
    ga_client_id: gaClient,
    ga_session_id: gaSession,
  });
  document.cookie = attributionCookieAssignment(next, { secure: window.location.protocol === 'https:' });
  return next;
}

export function attributionPostFields(value: AdsAttribution): Record<string, string> {
  const fields: Record<string, string> = {};
  const entries: Array<[string, string | null]> = [
    ['gclid', value.gclid],
    ['gbraid', value.gbraid],
    ['wbraid', value.wbraid],
    ['ga_client_id', value.ga_client_id],
    ['ga_session_id', value.ga_session_id],
    ['utm_source', value.utm_source],
    ['utm_medium', value.utm_medium],
    ['utm_campaign', value.utm_campaign],
    ['utm_term', value.utm_term],
    ['utm_content', value.utm_content],
  ];
  for (const [key, field] of entries) {
    if (field) fields[key] = field;
  }
  return fields;
}
