import { NextResponse } from 'next/server';
import { refreshAccessToken, getOAuthConfig } from '@/lib/quickbooks/oauth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get connection
    const { data: connection, error: connError } = await supabase
      .from('quickbooks_connections')
      .select('*')
      .limit(1)
      .single();

    if (connError || !connection) {
      return NextResponse.json({ 
        error: 'No connection found',
        detail: connError?.message 
      });
    }

    const config = getOAuthConfig();
    
    // Try to refresh the token
    let refreshResult;
    try {
      refreshResult = await refreshAccessToken({
        refreshToken: connection.refresh_token,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
      });
    } catch (refreshErr) {
      return NextResponse.json({
        error: 'Token refresh failed',
        detail: refreshErr instanceof Error ? refreshErr.message : 'Unknown error',
        connection: {
          realm_id: connection.realm_id,
          environment: connection.environment,
          connected_at: connection.connected_at,
          token_expires_at: connection.token_expires_at,
          refresh_token_preview: connection.refresh_token?.substring(0, 20) + '...',
        },
        config: {
          clientId_preview: config.clientId.substring(0, 10) + '...',
          redirectUri: config.redirectUri,
        }
      }, { status: 400 });
    }

    // Update token in DB
    await supabase
      .from('quickbooks_connections')
      .update({
        access_token: refreshResult.access_token,
        refresh_token: refreshResult.refresh_token,
        token_expires_at: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', connection.id);

    // Try BOTH environments to find which works
    const environments = [
      { name: 'production', url: 'https://quickbooks.api.intuit.com' },
      { name: 'sandbox', url: 'https://sandbox-quickbooks.api.intuit.com' },
    ];

    const results: any[] = [];
    
    for (const env of environments) {
      try {
        const testResponse = await fetch(
          `${env.url}/v3/company/${connection.realm_id}/companyinfo/${connection.realm_id}`,
          {
            headers: {
              'Authorization': `Bearer ${refreshResult.access_token}`,
              'Accept': 'application/json',
            },
          }
        );

        if (testResponse.ok) {
          const companyInfo = await testResponse.json();
          
          // Update the environment in database if it was wrong
          if (connection.environment !== env.name) {
            await supabase
              .from('quickbooks_connections')
              .update({ environment: env.name, updated_at: new Date().toISOString() })
              .eq('id', connection.id);
          }
          
          return NextResponse.json({
            success: true,
            message: `Token refreshed and API test passed on ${env.name}`,
            company: companyInfo.CompanyInfo?.CompanyName,
            realm_id: connection.realm_id,
            detectedEnvironment: env.name,
            storedEnvironment: connection.environment,
            environmentFixed: connection.environment !== env.name,
            new_token_expires: new Date(Date.now() + refreshResult.expires_in * 1000).toISOString(),
          });
        } else {
          const errText = await testResponse.text();
          results.push({ env: env.name, status: testResponse.status, error: errText.substring(0, 200) });
        }
      } catch (e) {
        results.push({ env: env.name, error: e instanceof Error ? e.message : 'Unknown' });
      }
    }

    return NextResponse.json({
      error: 'API test failed on both environments',
      tokenRefreshWorked: true,
      realm_id: connection.realm_id,
      storedEnvironment: connection.environment,
      results,
    }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ 
      error: 'Debug failed',
      detail: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
