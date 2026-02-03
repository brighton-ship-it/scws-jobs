/**
 * GET /api/quickbooks/connect
 * Initiates QuickBooks OAuth flow
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAuthorizationUrl } from '@/lib/quickbooks/oauth';

export async function GET() {
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const redirectUri = process.env.QUICKBOOKS_REDIRECT_URI || 'https://scws-jobs.vercel.app/api/quickbooks/callback';
  
  if (!clientId) {
    return Response.json({ error: 'QuickBooks not configured' }, { status: 500 });
  }

  // Get current user ID to pass through OAuth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    return redirect('/login?error=must_login_first');
  }

  // Encode user ID in state parameter so we can retrieve it in callback
  const state = Buffer.from(JSON.stringify({ userId: user.id })).toString('base64');
  
  const authUrl = getAuthorizationUrl({
    clientId,
    redirectUri,
    state,
  });

  return redirect(authUrl);
}
