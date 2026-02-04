import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { refreshAccessToken, getOAuthConfig } from '@/lib/quickbooks/oauth';

export const dynamic = 'force-dynamic';

// Proactively refresh QBO token (call via cron every 45 min)
export async function POST(request: NextRequest) {
  try {
    const apiKey = request.headers.get('x-api-key') || request.nextUrl.searchParams.get('api_key');
    if (apiKey !== process.env.ADMIN_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get current connection from Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!
    );

    const { data: connection, error } = await supabase
      .from('quickbooks_connections')
      .select('*')
      .single();

    if (error || !connection) {
      return NextResponse.json({ error: 'No QBO connection found' }, { status: 404 });
    }

    // Refresh the token
    const config = getOAuthConfig();
    const tokens = await refreshAccessToken({
      refreshToken: connection.refresh_token,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });

    // Update in database
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    
    await supabase
      .from('quickbooks_connections')
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id);

    return NextResponse.json({
      success: true,
      expiresAt,
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    const message = error instanceof Error ? error.message : 'Failed to refresh token';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
