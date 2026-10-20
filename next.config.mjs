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
