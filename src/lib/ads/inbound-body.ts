/**
 * Public form posts. Browsers with JavaScript send JSON. No-JS forms send
 * application/x-www-form-urlencoded. request.json() throws on that body and
 * the booking route was turning it into a 500.
 */

import {
  attributionFromCookieHeader,
  attributionFromRecord,
  campaignAndKeyword,
  isGoogleAdsTouch,
  mergeAttribution,
  type AdsAttribution,
} from './attribution.ts';
import { extractAdsClickIds, type AdsClickIds } from './click-ids.ts';
import { extractBookingUtms, type BookingUtms } from '../booking-source.ts';

export class InboundBodyError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'InboundBodyError';
    this.status = status;
  }
}

export function recordFromUrlEncoded(text: string): Record<string, unknown> {
  const params = new URLSearchParams(text);
  const record: Record<string, unknown> = {};
  params.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export async function readInboundRecord(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const record: Record<string, unknown> = {};
    for (const [key, value] of Array.from(form.entries())) {
      if (typeof value === 'string') record[key] = value;
    }
    return record;
  }

  const text = await request.text();
  if (!text.trim()) return {};

  if (contentType.includes('application/x-www-form-urlencoded')) {
    return recordFromUrlEncoded(text);
  }

  const looksLikeJson =
    contentType.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[');

  if (looksLikeJson && !contentType.includes('application/x-www-form-urlencoded')) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new InboundBodyError('JSON body must be an object');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof InboundBodyError) throw error;
      if (contentType.includes('json')) throw new InboundBodyError('Invalid JSON body');
    }
  }

  if (text.includes('=')) return recordFromUrlEncoded(text);
  throw new InboundBodyError('Unsupported request body');
}

export function effectiveAttribution(
  body: Record<string, unknown>,
  cookieHeader: string | null,
  requestUrl: string,
  now: Date = new Date()
): AdsAttribution {
  const fromCookie = attributionFromCookieHeader(cookieHeader, now);
  let fromQuery: AdsAttribution | null = null;
  try {
    fromQuery = attributionFromRecord(
      Object.fromEntries(new URL(requestUrl).searchParams.entries())
    );
  } catch {
    fromQuery = null;
  }
  const fromBody = attributionFromRecord(body);
  return mergeAttribution(mergeAttribution(fromCookie, fromQuery, now), fromBody, now);
}

export interface InboundAdsFields {
  body: Record<string, unknown>;
  attribution: AdsAttribution;
  clickIds: AdsClickIds;
  utms: BookingUtms;
  lead_source: 'google_ads' | null;
  campaign: string | null;
  keyword: string | null;
}

function textField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Fill empty click-id / UTM fields from the 90-day cookie or the request URL.
 * Body values win. lead_source becomes google_ads when a click id, a cpc/ppc
 * medium, or an explicit google_ads label is present.
 */
export function inboundAdsFields(
  body: Record<string, unknown>,
  cookieHeader: string | null,
  requestUrl: string,
  now?: Date
): InboundAdsFields {
  const attribution = effectiveAttribution(body, cookieHeader, requestUrl, now);
  const merged: Record<string, unknown> = { ...body };
  for (const [key, value] of Object.entries(attribution)) {
    if (key === 'captured_at' || !value) continue;
    const current = merged[key];
    if (typeof current === 'string' && current.trim()) continue;
    if (current != null && typeof current !== 'string') continue;
    merged[key] = value;
  }

  const clickIds = extractAdsClickIds(merged);
  const utms = extractBookingUtms(merged);
  const label = textField(merged, 'lead_source') || textField(merged, 'source');
  const googleAds = isGoogleAdsTouch({
    gclid: clickIds.gclid,
    gbraid: clickIds.gbraid,
    wbraid: clickIds.wbraid,
    utm_medium: utms.utm_medium,
    leadSourceLabel: label,
  });
  const names = campaignAndKeyword({
    utm_campaign: utms.utm_campaign,
    utm_term: utms.utm_term,
  });

  if (googleAds && !textField(merged, 'lead_source')) {
    merged.lead_source = 'google_ads';
  }

  return {
    body: merged,
    attribution,
    clickIds,
    utms,
    lead_source: googleAds ? 'google_ads' : null,
    campaign: names.campaign,
    keyword: names.keyword,
  };
}
