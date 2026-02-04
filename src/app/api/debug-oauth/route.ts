import { NextResponse } from 'next/server';

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';

export const dynamic = 'force-dynamic';

export async function GET() {
  const clientId = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  
  const params = new URLSearchParams({
    client_id: clientId || 'MISSING',
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirectUri || 'MISSING',
    state: 'test123',
  });

  const authUrl = `${QBO_AUTH_URL}?${params.toString()}`;

  return NextResponse.json({
    clientId: clientId?.substring(0, 15) + '...',
    redirectUri,
    generatedUrl: authUrl,
  });
}
