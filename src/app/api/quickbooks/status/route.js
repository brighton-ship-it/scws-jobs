/**
 * GET /api/quickbooks/status
 * Returns QuickBooks connection status
 */

import { createClient } from '@/lib/supabase/server';
import { QuickBooksClient } from '@/lib/quickbooks/client';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Get QuickBooks connection
    const { data: connection, error } = await supabase
      .from('quickbooks_connections')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error || !connection) {
      return Response.json({ 
        connected: false,
        message: 'QuickBooks not connected'
      });
    }

    // Check if token is expired
    const isExpired = new Date(connection.token_expires_at) < new Date();
    
    // Try to get company info to verify connection works
    let companyInfo = null;
    if (!isExpired) {
      try {
        const qb = new QuickBooksClient({
          accessToken: connection.access_token,
          realmId: connection.realm_id,
          environment: connection.environment,
        });
        companyInfo = await qb.getCompanyInfo();
      } catch (e) {
        console.error('Failed to get company info:', e);
      }
    }

    return Response.json({
      connected: true,
      realmId: connection.realm_id,
      environment: connection.environment,
      connectedAt: connection.connected_at,
      tokenExpired: isExpired,
      companyName: companyInfo?.CompanyName,
    });

  } catch (error) {
    console.error('Status check error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/quickbooks/status
 * Disconnects QuickBooks
 */
export async function DELETE() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    await supabase
      .from('quickbooks_connections')
      .delete()
      .eq('user_id', user.id);

    return Response.json({ success: true, message: 'QuickBooks disconnected' });

  } catch (error) {
    console.error('Disconnect error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
