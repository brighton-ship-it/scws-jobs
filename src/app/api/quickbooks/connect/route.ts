import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthorizationUrl, getOAuthConfig } from '@/lib/quickbooks/oauth';
import { randomBytes } from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  console.log('=== QBO CONNECT START ===');
  console.log('baseUrl:', baseUrl);
  
  try {
    console.log('QBO Connect - Creating supabase client...');
    const supabase = await createClient();
    
    console.log('QBO Connect - Getting user...');
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    console.log('QBO Connect - User:', user?.id || 'none', 'Error:', authError?.message || 'none');
    
    if (!user) {
      console.log('QBO Connect - No user, redirecting to login');
      return NextResponse.redirect(new URL('/login', baseUrl));
    }

    console.log('QBO Connect - Getting OAuth config...');
    const config = getOAuthConfig();
    console.log('QBO Connect - Config loaded, clientId starts with:', config.clientId?.substring(0, 10));
    
    // Generate state token for CSRF protection
    const state = randomBytes(16).toString('hex');
    
    // Store state in session (we'll validate it in callback)
    // Using a simple cookie for now
    const authUrl = getAuthorizationUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    });

    const response = NextResponse.redirect(authUrl);
    
    // Set state cookie for validation in callback
    response.cookies.set('qb_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 600, // 10 minutes
    });

    return response;
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('QuickBooks connect error:', errMsg);
    console.error('Full error:', error);
    const errorUrl = new URL('/settings/integrations', baseUrl);
    errorUrl.searchParams.set('qb_error', 'Connect failed: ' + errMsg);
    return NextResponse.redirect(errorUrl);
  }
}
