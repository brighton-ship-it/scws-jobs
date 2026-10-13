/**
 * Lead channel for web forms (where the visitor came from). Pure; shared by /api/booking and /api/leads/create.
 * Order: Google Ads (click id / cpc) > explicit site_source from scwellservice.com (first-party, first touch)
 * > UTM source/medium > referrer host > direct. Values:
 *   google_ads | gbp (Google Business Profile / Maps) | seo (organic search) | yelp | apple_maps | referral | direct
 */
export type LeadChannel = 'google_ads' | 'gbp' | 'seo' | 'yelp' | 'apple_maps' | 'referral' | 'direct';
export const LEAD_CHANNELS: LeadChannel[] = ['google_ads', 'gbp', 'seo', 'yelp', 'apple_maps', 'referral', 'direct'];

const s = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

export function channelFromUtm(source: string, medium: string): LeadChannel | null {
  if (/^(cpc|ppc|paid|paidsearch|paid_search)$/.test(medium) && (!source || /google|adwords/.test(source))) return 'google_ads';
  if (/^(gbp|gmb|google_business|googlebusiness|google_my_business|googlemybusiness|business_profile|maps)$/.test(source) || /^(gbp|gmb|maps|local)$/.test(medium)) return 'gbp';
  if (/yelp/.test(source)) return 'yelp';
  if (/^(apple|apple_maps|applemaps|apple_business|maps\.apple\.com)$/.test(source)) return 'apple_maps';
  if (medium === 'organic' || (/^(google|bing|yahoo|duckduckgo)$/.test(source) && !medium)) return 'seo';
  if (source || medium) return 'referral';
  return null;
}

export function channelFromReferrer(referrer: string): LeadChannel | null {
  if (!referrer || referrer === 'direct') return null;
  let host = '', path = '';
  try { const u = new URL(referrer); host = u.hostname.toLowerCase(); path = u.pathname.toLowerCase(); } catch { return null; }
  if (/(^|\.)scwellservice\.com$/.test(host)) return null; // internal navigation
  if (host === 'maps.apple.com' || host.endsWith('.maps.apple.com')) return 'apple_maps';
  if (/(^|\.)yelp\.[a-z.]+$/.test(host)) return 'yelp';
  if (/^maps\.google\./.test(host) || (/(^|\.)google\.[a-z.]+$/.test(host) && path.startsWith('/maps')) || host === 'business.google.com' || host === 'g.page') return 'gbp';
  if (/(^|\.)(google|bing|yahoo|duckduckgo|ecosia|search\.brave)\.[a-z.]+$/.test(host)) return 'seo';
  return 'referral';
}

/** body: the inbound form JSON (any shape). googleAds: inboundAdsFields already decided this was an ad click. */
export function leadChannel(body: Record<string, unknown>, googleAds = false): LeadChannel {
  if (googleAds) return 'google_ads';
  const site = s(body.site_source);
  if ((LEAD_CHANNELS as string[]).includes(site)) return site as LeadChannel;
  const utm = channelFromUtm(s(body.utm_source), s(body.utm_medium));
  if (utm) return utm;
  const ref = channelFromReferrer(String(body.first_referrer || body.referrer || body.referrer_url || ''));
  if (ref) return ref;
  return 'direct';
}

/** Short, PII-free attribution tag for booking notes: host+path only (no query strings). */
export function pathOnly(url: unknown): string | null {
  if (typeof url !== 'string' || !url || url === 'direct') return null;
  try { const u = new URL(url); return `${u.hostname}${u.pathname}`.slice(0, 160); } catch { return null; }
}

/** Test submissions (verification only): never notify staff, never count on dashboards. */
export function isTestLead(body: Record<string, unknown>): boolean {
  return body.scws_test === '1' || body.scws_test === true || body.scws_test === 1;
}
