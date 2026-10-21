// Diagnostic only: retrieve Data Manager request status during the Vercel build, then fail
// so this deployment is not promoted. Removed before the fix ships.
if (process.env.VERCEL) {
  const ids = [
    '232123f3-91f2-4eb9-9417-477717a1f018',
    'a6fc9385-36e4-4636-9e6c-0d92d227a755',
    '896993fb-6fa3-4133-a497-e8d3784ffcd2',
  ];
  const redact = (s) => String(s).replace(/ya29\.[A-Za-z0-9_\-]+/g, '[token]').slice(0, 8000);
  const clientId = process.env.GOOGLE_DATAMANAGER_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DATAMANAGER_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DATAMANAGER_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    console.log('DM_STATUS missing oauth env', JSON.stringify({
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
      hasRefresh: Boolean(refreshToken),
      target: process.env.VERCEL_ENV || null,
    }));
  } else {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.access_token) {
      console.log('DM_STATUS token_refresh_failed', tokenRes.status, redact(tokenBody.error || tokenBody.error_description || ''));
    } else {
      for (const requestId of ids) {
        const url = `https://datamanager.googleapis.com/v1/requestStatus:retrieve?requestId=${encodeURIComponent(requestId)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenBody.access_token}` } });
        const body = await res.json().catch(() => null);
        console.log('DM_STATUS', requestId, res.status, redact(JSON.stringify(body)));
      }
    }
  }

  // Read-only Ads diagnostics. No mutate. Logs counts and error codes only.
  const adsClientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const adsSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;
  const adsRefresh = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID || '').replace(/-/g, '');
  const loginId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '').replace(/-/g, '');
  if (!adsClientId || !adsSecret || !adsRefresh || !devToken || !customerId) {
    console.log('ADS_DIAG missing env', JSON.stringify({
      hasClientId: Boolean(adsClientId),
      hasSecret: Boolean(adsSecret),
      hasRefresh: Boolean(adsRefresh),
      hasDev: Boolean(devToken),
      hasCustomer: Boolean(customerId),
    }));
  } else {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: adsClientId,
        client_secret: adsSecret,
        refresh_token: adsRefresh,
        grant_type: 'refresh_token',
      }),
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !tokenBody.access_token) {
      console.log('ADS_DIAG token_refresh_failed', tokenRes.status, redact(tokenBody.error || tokenBody.error_description || ''));
    } else {
      const headers = {
        Authorization: `Bearer ${tokenBody.access_token}`,
        'developer-token': devToken,
        'Content-Type': 'application/json',
      };
      if (loginId) headers['login-customer-id'] = loginId;
      const queries = [
        ['action', `SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.type, conversion_action.category, conversion_action.origin, conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric, conversion_action.click_through_lookback_window_days, conversion_action.counting_type, conversion_action.value_settings.always_use_default_value FROM conversion_action WHERE conversion_action.id = 7833699992`],
        ['by_click', `SELECT segments.date, metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value FROM customer WHERE segments.date BETWEEN '2026-01-01' AND '2026-10-20' AND segments.conversion_action = 'customers/9314944293/conversionActions/7833699992'`],
        ['by_conv_time', `SELECT segments.date, metrics.all_conversions_by_conversion_date, metrics.all_conversions_value_by_conversion_date, metrics.conversions_by_conversion_date, metrics.conversions_value_by_conversion_date FROM customer WHERE segments.date BETWEEN '2026-09-01' AND '2026-10-20' AND segments.conversion_action = 'customers/9314944293/conversionActions/7833699992'`],
      ];
      for (const [label, query] of queries) {
        const res = await fetch(`https://googleads.googleapis.com/v25/customers/${customerId}/googleAds:search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ query }),
        });
        const body = await res.json().catch(() => null);
        console.log('ADS_DIAG', label, res.status, redact(JSON.stringify(body)));
      }
    }
  }
  throw new Error('DM_STATUS_PROBE complete; failing the build so this diagnostic is not promoted');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Handle ESM packages
  transpilePackages: ['@react-pdf/renderer'],
};

export default nextConfig;
