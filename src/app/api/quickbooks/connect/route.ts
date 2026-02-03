import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getAuthorizationUrl, getOAuthConfig } from '@/lib/quickbooks/oauth';
import { randomBytes } from 'crypto';

export async function GET() {
  try {
    const supabase = await createClient();
    
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL));
    }

    const config = getOAuthConfig();
    
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
  } catch (error) {
    console.error('QuickBooks connect error:', error);
    const errorUrl = new URL('/settings/integrations', process.env.NEXT_PUBLIC_APP_URL);
    errorUrl.searchParams.set('qb_error', 'Failed to start QuickBooks connection');
    return NextResponse.redirect(errorUrl);
  }
}
