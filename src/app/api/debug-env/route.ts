import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    hasClientId: !!process.env.QBO_CLIENT_ID,
    hasClientSecret: !!process.env.QBO_CLIENT_SECRET,
    hasRedirectUri: !!process.env.QBO_REDIRECT_URI,
    clientIdPrefix: process.env.QBO_CLIENT_ID?.substring(0, 10) || 'NOT SET',
    redirectUri: process.env.QBO_REDIRECT_URI || 'NOT SET',
  });
}
