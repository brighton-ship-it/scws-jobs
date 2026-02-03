import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens, getOAuthConfig } from '@/lib/quickbooks/oauth';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const realmId = searchParams.get('realmId');
  const error = searchParams.get('error');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const redirectUrl = new URL('/settings/integrations', baseUrl);

  if (error) {
    redirectUrl.searchParams.set('qb_error', error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !realmId) {
    redirectUrl.searchParams.set('qb_error', 'Missing authorization code or realm ID');
    return NextResponse.redirect(redirectUrl);
  }

  try {
    // Validate state (CSRF protection)
    const storedState = request.cookies.get('qb_oauth_state')?.value;
    if (!storedState || storedState !== state) {
      redirectUrl.searchParams.set('qb_error', 'Invalid state parameter');
      return NextResponse.redirect(redirectUrl);
    }

    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      redirectUrl.searchParams.set('qb_error', 'Not authenticated');
      return NextResponse.redirect(redirectUrl);
    }

    // Exchange code for tokens
    const config = getOAuthConfig();
    const tokens = await exchangeCodeForTokens({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
    });

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    
    // Determine environment based on realmId format or config
    // In production, you might want to set this via env var
    const environment = process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

    // Upsert connection (replace existing if any)
    const { error: upsertError } = await supabase
      .from('quickbooks_connections')
      .upsert({
        user_id: user.id,
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: tokenExpiresAt.toISOString(),
        environment,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (upsertError) {
      console.error('Failed to save QuickBooks connection:', upsertError);
      redirectUrl.searchParams.set('qb_error', 'Failed to save connection');
      return NextResponse.redirect(redirectUrl);
    }

    // Clear state cookie and redirect with success
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete('qb_oauth_state');
    redirectUrl.searchParams.set('qb_success', 'true');
    
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error('QuickBooks callback error:', err);
    redirectUrl.searchParams.set('qb_error', 'Failed to complete QuickBooks connection');
    return NextResponse.redirect(redirectUrl);
  }
}
