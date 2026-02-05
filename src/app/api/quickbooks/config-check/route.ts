import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const clientId = process.env.QBO_CLIENT_ID || '';
  const clientSecret = process.env.QBO_CLIENT_SECRET || '';
  const redirectUri = process.env.QBO_REDIRECT_URI || '';
  const environment = process.env.QBO_ENVIRONMENT || '';

  return NextResponse.json({
    clientId_first10: clientId.substring(0, 10),
    clientId_last5: clientId.substring(clientId.length - 5),
    clientId_length: clientId.length,
    secret_first10: clientSecret.substring(0, 10),
    secret_length: clientSecret.length,
    redirectUri,
    environment,
    timestamp: new Date().toISOString(),
  });
}
