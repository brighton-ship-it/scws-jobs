/**
 * Google Workspace Voice audit log. Optional. Missing credentials leave
 * ads calls stored without a caller phone. This does not place calls and
 * does not change the shop number or Sarah.
 */

import { refreshGoogleAccessToken, type GoogleAdsConfig } from './google-ads-api.ts';

const REPORTS_URL = 'https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/voice';

export interface VoiceLogConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function voiceLogConfig(env: NodeJS.ProcessEnv = process.env): VoiceLogConfig | null {
  const clientId = env.GOOGLE_VOICE_CLIENT_ID?.trim() || env.GOOGLE_ADS_CLIENT_ID?.trim() || '';
  const clientSecret = env.GOOGLE_VOICE_CLIENT_SECRET?.trim() || env.GOOGLE_ADS_CLIENT_SECRET?.trim() || '';
  const refreshToken = env.GOOGLE_VOICE_REFRESH_TOKEN?.trim() || '';
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

export async function fetchVoiceActivityPayload(
  config: VoiceLogConfig,
  fetchImpl: typeof fetch,
  startTime: string
): Promise<unknown> {
  const token = await refreshGoogleAccessToken(config, fetchImpl);
  const items: unknown[] = [];
  let pageToken: string | null = null;
  // The report returns newest first, 500 per page (about 4 days). Page through the window.
  for (let page = 0; page < 40; page += 1) {
    const url = new URL(REPORTS_URL);
    url.searchParams.set('startTime', startTime);
    url.searchParams.set('maxResults', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`Google Voice report failed (${response.status})`);
    }
    const body = (await response.json()) as { items?: unknown[]; nextPageToken?: string };
    if (Array.isArray(body.items)) items.push(...body.items);
    pageToken = body.nextPageToken || null;
    if (!pageToken) break;
  }
  return { items };
}

export function sheetsConfig(env: NodeJS.ProcessEnv = process.env): {
  spreadsheetId: string;
  oauth: Pick<GoogleAdsConfig, 'clientId' | 'clientSecret' | 'refreshToken'>;
} | null {
  const spreadsheetId = env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim() || '';
  const clientId = env.GOOGLE_SHEETS_CLIENT_ID?.trim() || env.GOOGLE_ADS_CLIENT_ID?.trim() || '';
  const clientSecret = env.GOOGLE_SHEETS_CLIENT_SECRET?.trim() || env.GOOGLE_ADS_CLIENT_SECRET?.trim() || '';
  const refreshToken = env.GOOGLE_SHEETS_REFRESH_TOKEN?.trim() || '';
  if (!spreadsheetId || !clientId || !clientSecret || !refreshToken) return null;
  return { spreadsheetId, oauth: { clientId, clientSecret, refreshToken } };
}

export async function appendSheetValues(
  config: NonNullable<ReturnType<typeof sheetsConfig>>,
  values: string[][],
  fetchImpl: typeof fetch
): Promise<void> {
  const token = await refreshGoogleAccessToken(config.oauth, fetchImpl);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent('Closed loop!A1')}:append?valueInputOption=USER_ENTERED`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values }),
  });
  if (!response.ok) {
    throw new Error(`Google Sheets append failed (${response.status})`);
  }
}
