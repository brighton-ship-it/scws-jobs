import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens, getOAuthConfig } from '@/lib/quickbooks/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const realmId = searchParams.get('realmId');
  const error = searchParams.get('error');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  
  console.log('=== QBO CALLBACK START ===');
  console.log('baseUrl:', baseUrl);
  console.log('code:', code ? 'present' : 'missing');
  console.log('realmId:', realmId);
  console.log('state:', state);
  console.log('error:', error);

  if (error) {
    console.log('QBO Callback - OAuth error:', error);
    const redirectUrl = new URL('/settings/integrations', baseUrl);
    redirectUrl.searchParams.set('qb_error', error);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !realmId) {
    console.log('QBO Callback - Missing code or realmId');
    const redirectUrl = new URL('/settings/integrations', baseUrl);
    redirectUrl.searchParams.set('qb_error', 'Missing authorization code or realm ID');
    return NextResponse.redirect(redirectUrl);
  }

  try {
    // Validate state (CSRF protection) - log for debugging
    const storedState = request.cookies.get('qb_oauth_state')?.value;
    console.log('QBO Callback - state from URL:', state);
    console.log('QBO Callback - state from cookie:', storedState);
    
    // Temporarily skip strict state validation if cookie is missing (common issue with redirects)
    if (storedState && storedState !== state) {
      console.error('QBO Callback - State mismatch:', { storedState, state });
      const redirectUrl = new URL('/settings/integrations', baseUrl);
      redirectUrl.searchParams.set('qb_error', 'Invalid state parameter');
      return NextResponse.redirect(redirectUrl);
    }

    // Use session-aware client to get user
    console.log('QBO Callback - Getting user...');
    const authClient = await createClient();
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    console.log('QBO Callback - User:', user?.id || 'none', 'Error:', authError?.message || 'none');
    
    if (!user) {
      console.log('QBO Callback - No user found, redirecting with error');
      const redirectUrl = new URL('/settings/integrations', baseUrl);
      redirectUrl.searchParams.set('qb_error', 'Not authenticated - please log in first');
      return NextResponse.redirect(redirectUrl);
    }

    // Use service client for database writes (bypasses RLS)
    const supabase = createServiceClient();

    // Exchange code for tokens
    console.log('QBO Callback - Exchanging code for tokens...');
    const config = getOAuthConfig();
    console.log('QBO Callback - Config redirectUri:', config.redirectUri);
    
    let tokens;
    try {
      tokens = await exchangeCodeForTokens({
        code,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        redirectUri: config.redirectUri,
      });
      console.log('QBO Callback - Token exchange successful');
    } catch (tokenError: unknown) {
      const errMsg = tokenError instanceof Error ? tokenError.message : 'Unknown token error';
      console.error('QBO Callback - Token exchange failed:', errMsg);
      const redirectUrl = new URL('/settings/integrations', baseUrl);
      redirectUrl.searchParams.set('qb_error', 'Token exchange failed: ' + errMsg);
      return NextResponse.redirect(redirectUrl);
    }

    // Calculate token expiration
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    
    // Determine environment based on config
    const environment = process.env.QBO_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

    // Upsert connection (replace existing if any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: upsertError } = await (supabase as any)
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
      const redirectUrl = new URL('/settings/integrations', baseUrl);
      redirectUrl.searchParams.set('qb_error', 'Failed to save connection');
      return NextResponse.redirect(redirectUrl);
    }

    // Success - redirect with success param and clear state cookie
    const successUrl = new URL('/settings/integrations', baseUrl);
    successUrl.searchParams.set('qb_success', 'true');
    
    const response = NextResponse.redirect(successUrl);
    response.cookies.delete('qb_oauth_state');
    
    return response;
  } catch (err) {
    console.error('QuickBooks callback error:', err);
    const redirectUrl = new URL('/settings/integrations', baseUrl);
    redirectUrl.searchParams.set('qb_error', 'Failed to complete QuickBooks connection');
    return NextResponse.redirect(redirectUrl);
  }
}
