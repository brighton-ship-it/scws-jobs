/**
 * GET /api/quickbooks/callback
 * Handles QuickBooks OAuth callback
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { exchangeCodeForTokens } from '@/lib/quickbooks/oauth';

export async function GET(request) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) {
    return redirect('/settings/integrations?qb_error=' + encodeURIComponent(error));
  }

  if (!code || !realmId) {
    return redirect('/settings/integrations?qb_error=missing_params');
  }

  // Decode user ID from state
  let userId = null;
  try {
    if (state) {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userId = decoded.userId;
    }
  } catch (e) {
    console.error('Failed to decode state:', e);
  }

  if (!userId) {
    return redirect('/settings/integrations?qb_error=invalid_state');
  }

  try {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || 'https://scws-jobs.vercel.app/api/quickbooks/callback';

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens({
      code,
      clientId,
      clientSecret,
      redirectUri,
    });

    // Save directly to database using service role via direct insert
    const supabase = await createClient();

    // Upsert QuickBooks connection
    const { error: dbError } = await supabase
      .from('quickbooks_connections')
      .upsert({
        user_id: userId,
        realm_id: realmId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        environment: process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox',
        connected_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (dbError) {
      console.error('Failed to save QuickBooks connection:', dbError);
      return new Response(`
        <html>
          <body style="font-family: sans-serif; padding: 40px;">
            <h1>Database Save Error</h1>
            <p style="color: red;">${dbError.message}</p>
            <p><a href="/settings/integrations">Back to Settings</a></p>
            <pre>${JSON.stringify(dbError, null, 2)}</pre>
          </body>
        </html>
      `, { 
        status: 500,
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return redirect('/settings/integrations?qb_success=true');

  } catch (err) {
    // Don't catch Next.js redirect errors
    if (err.message === 'NEXT_REDIRECT') {
      throw err;
    }
    console.error('QuickBooks callback error:', err);
    // Show error page instead of redirecting so user can see it
    return new Response(`
      <html>
        <body style="font-family: sans-serif; padding: 40px;">
          <h1>QuickBooks Connection Error</h1>
          <p style="color: red;">${err.message}</p>
          <p><a href="/settings/integrations">Back to Settings</a></p>
          <pre>${err.stack}</pre>
        </body>
      </html>
    `, { 
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}
