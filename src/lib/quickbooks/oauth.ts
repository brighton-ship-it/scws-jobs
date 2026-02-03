/**
 * QuickBooks OAuth 2.0 Helper
 */

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

export function getAuthorizationUrl({ 
  clientId, 
  redirectUri, 
  state 
}: { 
  clientId: string; 
  redirectUri: string; 
  state?: string;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri,
    state: state || 'default',
  });

  return `${QBO_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens({ 
  code, 
  clientId, 
  clientSecret, 
  redirectUri 
}: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

export async function refreshAccessToken({ 
  refreshToken, 
  clientId, 
  clientSecret 
}: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<TokenResponse> {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

export function getOAuthConfig(): OAuthConfig {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing QuickBooks OAuth configuration. Set QBO_CLIENT_ID, QBO_CLIENT_SECRET, and QBO_REDIRECT_URI.');
  }

  return { clientId, clientSecret, redirectUri };
}
