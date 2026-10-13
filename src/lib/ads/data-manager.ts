/**
 * Google Data Manager API (events:ingest) for offline won-job conversions.
 * Google Ads' uploadClickConversions rejects new integrations with
 * CUSTOMER_NOT_ALLOWLISTED_FOR_THIS_FEATURE, so uploads go here instead.
 * Needs an OAuth token with https://www.googleapis.com/auth/datamanager.
 * Fast-fail: if any event fails validation, Google rejects the whole request.
 */
import type { ClickConversion } from './offline-conversion.ts';
import type { GoogleAdsConfig } from './google-ads-api.ts';

export const DATA_MANAGER_HOST = 'https://datamanager.googleapis.com';
export const DATA_MANAGER_SCOPE = 'https://www.googleapis.com/auth/datamanager';

/** "customers/123/conversionActions/456" or "456" -> "456". */
export function conversionActionId(resource: string): string {
  const m = /(\d+)\s*$/.exec(resource.trim());
  if (!m) throw new Error(`Cannot read a conversion action id from "${resource}"`);
  return m[1];
}

/** "2026-09-18 22:03:00+00:00" -> "2026-09-18T22:03:00+00:00" (RFC 3339). */
export function rfc3339(adsDateTime: string): string {
  const out = adsDateTime.trim().replace(' ', 'T');
  if (Number.isNaN(Date.parse(out))) throw new Error(`invalid conversion time "${adsDateTime}"`);
  return out;
}

export interface DataManagerEvent {
  transactionId: string;
  eventTimestamp: string;
  eventSource: 'WEB';
  conversionValue: number;
  currency: string;
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  userData?: { userIdentifiers: Array<{ emailAddress?: string; phoneNumber?: string }> };
}

export function toDataManagerEvent(c: ClickConversion): DataManagerEvent {
  const event: DataManagerEvent = {
    transactionId: c.order_id, // dedupe key: Jobber job id
    eventTimestamp: rfc3339(c.conversion_date_time),
    eventSource: 'WEB',
    conversionValue: c.conversion_value,
    currency: c.currency_code,
  };
  if (c.gclid) event.adIdentifiers = { gclid: c.gclid };
  else if (c.gbraid) event.adIdentifiers = { gbraid: c.gbraid };
  else if (c.wbraid) event.adIdentifiers = { wbraid: c.wbraid };
  const ids: Array<{ emailAddress?: string; phoneNumber?: string }> = [];
  for (const u of c.user_identifiers ?? []) {
    if (u.hashed_email) ids.push({ emailAddress: u.hashed_email });
    else if (u.hashed_phone_number) ids.push({ phoneNumber: u.hashed_phone_number });
  }
  if (ids.length) event.userData = { userIdentifiers: ids };
  return event;
}

export function buildIngestRequest(
  config: Pick<GoogleAdsConfig, 'customerId' | 'loginCustomerId' | 'conversionAction'>,
  conversions: ClickConversion[],
  options: { validateOnly?: boolean } = {}
): Record<string, unknown> {
  if (!config.conversionAction) throw new Error('GOOGLE_ADS_OFFLINE_CONVERSION_ACTION is not set');
  const destination: Record<string, unknown> = {
    operatingAccount: { accountType: 'GOOGLE_ADS', accountId: config.customerId },
    productDestinationId: conversionActionId(config.conversionAction),
  };
  if (config.loginCustomerId && config.loginCustomerId !== config.customerId) {
    destination.loginAccount = { accountType: 'GOOGLE_ADS', accountId: config.loginCustomerId };
  }
  return {
    destinations: [destination],
    events: conversions.map(toDataManagerEvent),
    encoding: 'HEX', // offline-conversion.ts hashes as lowercase SHA-256 hex
    validateOnly: Boolean(options.validateOnly),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Same result shape as uploadClickConversions so runOfflineImport is unchanged. */
export async function ingestEvents(
  config: Pick<GoogleAdsConfig, 'customerId' | 'loginCustomerId' | 'conversionAction'>,
  conversions: ClickConversion[],
  fetchImpl: typeof fetch,
  accessToken: string,
  options: { validateOnly?: boolean } = {}
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetchImpl(`${DATA_MANAGER_HOST}/v1/events:ingest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildIngestRequest(config, conversions, options)),
  });
  return { ok: response.ok, status: response.status, body: await readJson(response) };
}

/** Diagnostics for a past ingest (SUCCESS / PROCESSING / PARTIAL_SUCCESS / FAILED). */
export async function retrieveRequestStatus(
  requestId: string,
  fetchImpl: typeof fetch,
  accessToken: string
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const url = `${DATA_MANAGER_HOST}/v1/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`;
  const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { ok: response.ok, status: response.status, body: await readJson(response) };
}

/** A short error string for a rejected ingest (whole request fails together). */
export function ingestErrorMessage(status: number, body: unknown): string {
  const err = (body as { error?: { status?: string; message?: string } } | null)?.error;
  return `Data Manager ingest HTTP ${status}${err?.status ? ` ${err.status}` : ''}${err?.message ? `: ${err.message}` : ''}`.slice(0, 500);
}
