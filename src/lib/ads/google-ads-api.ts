/**
 * Read-only Google Ads search, plus the one upload this project is allowed
 * to make: offline click conversions. Campaigns, keywords, budgets, and
 * conversion-action settings are never mutated here.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ADS_HOST = 'https://googleads.googleapis.com';

export const DEFAULT_GOOGLE_ADS_API_VERSION = 'v18';

export const CALL_VIEW_GAQL = `
SELECT
  call_view.resource_name,
  call_view.call_duration_seconds,
  call_view.start_call_date_time,
  call_view.end_call_date_time,
  call_view.caller_country_code,
  call_view.caller_area_code,
  call_view.call_status,
  call_view.call_tracking_display_location,
  call_view.type,
  campaign.id,
  campaign.name,
  ad_group.id,
  ad_group.name
FROM call_view
WHERE call_view.start_call_date_time DURING LAST_30_DAYS
`.trim();

export const KEYWORD_COST_GAQL = `
SELECT
  campaign.name,
  ad_group_criterion.keyword.text,
  metrics.cost_micros
FROM keyword_view
WHERE segments.date DURING LAST_7_DAYS
`.trim();

export const CAMPAIGN_COST_GAQL = `
SELECT
  campaign.name,
  metrics.cost_micros
FROM campaign
WHERE segments.date DURING LAST_7_DAYS
  AND campaign.status != 'REMOVED'
`.trim();

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  loginCustomerId: string | null;
  apiVersion: string;
  conversionAction: string | null;
}

export function googleAdsConfig(env: Record<string, string | undefined> = process.env): GoogleAdsConfig | null {
  const developerToken = env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || '';
  const clientId = env.GOOGLE_ADS_CLIENT_ID?.trim() || '';
  const clientSecret = env.GOOGLE_ADS_CLIENT_SECRET?.trim() || '';
  const refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN?.trim() || '';
  const customerId = (env.GOOGLE_ADS_CUSTOMER_ID?.trim() || '').replace(/-/g, '');
  if (!developerToken || !clientId || !clientSecret || !refreshToken || !customerId) {
    return null;
  }
  return {
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    customerId,
    loginCustomerId: (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() || '').replace(/-/g, '') || null,
    apiVersion: env.GOOGLE_ADS_API_VERSION?.trim() || DEFAULT_GOOGLE_ADS_API_VERSION,
    conversionAction: env.GOOGLE_ADS_OFFLINE_CONVERSION_ACTION?.trim() || null,
  };
}

/** Rejects anything that is not a single read-only SELECT. */
export function assertReadOnlyGaql(query: string): string {
  const trimmed = query.trim().replace(/;+\s*$/g, '');
  if (!/^select\b/i.test(trimmed)) {
    throw new Error('Google Ads query must be a read-only SELECT');
  }
  if (trimmed.includes(';')) {
    throw new Error('Google Ads query must be a single SELECT');
  }
  if (/\b(update|delete|insert|create|mutate|remove)\b/i.test(trimmed)) {
    throw new Error('Google Ads query must be read-only');
  }
  return trimmed;
}

export function costMicrosToUsd(micros: unknown): number {
  const value = typeof micros === 'string' ? Number(micros) : typeof micros === 'number' ? micros : NaN;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round((value / 1_000_000) * 100) / 100;
}

export async function refreshGoogleAccessToken(
  config: Pick<GoogleAdsConfig, 'clientId' | 'clientSecret' | 'refreshToken'>,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  });
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  if (!response.ok) {
    throw new Error(`Google OAuth token refresh failed (${response.status})`);
  }
  const json = (await response.json()) as { access_token?: unknown };
  if (typeof json.access_token !== 'string' || !json.access_token) {
    throw new Error('Google OAuth token refresh returned no access_token');
  }
  return json.access_token;
}

function adsHeaders(config: GoogleAdsConfig, accessToken: string): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken,
    'Content-Type': 'application/json',
  };
  if (config.loginCustomerId) headers['login-customer-id'] = config.loginCustomerId;
  return headers;
}

export async function googleAdsSearch(
  config: GoogleAdsConfig,
  query: string,
  fetchImpl: typeof fetch,
  accessToken: string,
  pageToken?: string | null
): Promise<unknown> {
  const gaql = assertReadOnlyGaql(query);
  const url = `${ADS_HOST}/${config.apiVersion}/customers/${config.customerId}/googleAds:search`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: adsHeaders(config, accessToken),
    body: JSON.stringify({ query: gaql, pageToken: pageToken || undefined }),
  });
  if (!response.ok) {
    throw new Error(`Google Ads search failed (${response.status})`);
  }
  return response.json();
}

export function searchResultRows(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== 'object') return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(number) ? number : null;
}

export interface AdsCallDraft {
  resourceName: string;
  startedAt: string | null;
  durationSeconds: number | null;
  campaignId: string | null;
  campaignName: string | null;
  adGroupName: string | null;
  keyword: string | null;
  callerAreaCode: string | null;
  callStatus: string | null;
  callSource: string | null;
}

export function parseCallViewRow(row: Record<string, unknown>): AdsCallDraft | null {
  const call = asRecord(row.callView) || asRecord(row.call_view);
  const campaign = asRecord(row.campaign);
  const adGroup = asRecord(row.adGroup) || asRecord(row.ad_group);
  const resourceName = asString(call?.resourceName) || asString(call?.resource_name);
  if (!resourceName) return null;
  return {
    resourceName,
    startedAt: asString(call?.startCallDateTime) || asString(call?.start_call_date_time),
    durationSeconds: asNumber(call?.callDurationSeconds ?? call?.call_duration_seconds),
    campaignId: asString(campaign?.id),
    campaignName: asString(campaign?.name),
    adGroupName: asString(adGroup?.name),
    keyword: null,
    callerAreaCode: asString(call?.callerAreaCode) || asString(call?.caller_area_code),
    callStatus: asString(call?.callStatus) || asString(call?.call_status),
    callSource:
      asString(call?.callTrackingDisplayLocation) || asString(call?.call_tracking_display_location),
  };
}

export interface AdCostRow {
  campaign: string;
  keyword: string;
  costUsd: number;
}

export function parseKeywordCostRow(row: Record<string, unknown>): AdCostRow | null {
  const campaign = asString(asRecord(row.campaign)?.name);
  const criterion = asRecord(row.adGroupCriterion) || asRecord(row.ad_group_criterion);
  const keyword = asString(asRecord(criterion?.keyword)?.text) || '';
  const metrics = asRecord(row.metrics);
  const costUsd = costMicrosToUsd(metrics?.costMicros ?? metrics?.cost_micros);
  if (!campaign || costUsd <= 0) return null;
  return { campaign, keyword, costUsd };
}

export function parseCampaignCostRow(row: Record<string, unknown>): AdCostRow | null {
  const campaign = asString(asRecord(row.campaign)?.name);
  const metrics = asRecord(row.metrics);
  const costUsd = costMicrosToUsd(metrics?.costMicros ?? metrics?.cost_micros);
  if (!campaign || costUsd <= 0) return null;
  return { campaign, keyword: '', costUsd };
}

/**
 * Keyword rows carry their own cost. Campaign cost fills a blank-keyword row
 * only for spend that keyword rows did not already explain.
 */
export function allocateAdCosts(keywordCosts: AdCostRow[], campaignCosts: AdCostRow[]): AdCostRow[] {
  const rows = keywordCosts.filter((row) => row.costUsd > 0);
  const byCampaign = new Map<string, number>();
  for (const row of rows) {
    byCampaign.set(row.campaign, (byCampaign.get(row.campaign) ?? 0) + row.costUsd);
  }
  for (const campaign of campaignCosts) {
    const covered = byCampaign.get(campaign.campaign) ?? 0;
    const remainder = Math.round((campaign.costUsd - covered) * 100) / 100;
    if (remainder > 0.009) {
      rows.push({ campaign: campaign.campaign, keyword: '', costUsd: remainder });
    }
  }
  return rows;
}

export async function uploadClickConversions(
  config: GoogleAdsConfig,
  conversions: unknown[],
  fetchImpl: typeof fetch,
  accessToken: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!config.conversionAction) {
    throw new Error('GOOGLE_ADS_OFFLINE_CONVERSION_ACTION is not set');
  }
  const url = `${ADS_HOST}/${config.apiVersion}/customers/${config.customerId}:uploadClickConversions`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: adsHeaders(config, accessToken),
    body: JSON.stringify({ conversions, partialFailure: true }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}
