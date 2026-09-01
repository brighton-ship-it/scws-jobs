/**
 * Public API allowlist.
 *
 * Middleware treats every /api route as callable without a session unless
 * it matches one of these rules. Keep this list tight: marketing-site
 * intake, customer portal/pay, inbound webhooks, OAuth callback, and cron.
 */

type PublicApiRule = {
  method?: 'GET' | 'POST' | 'OPTIONS' | '*';
  path: string;
  match?: 'exact' | 'prefix';
};

const PUBLIC_API_RULES: PublicApiRule[] = [
  // Marketing site + embed booking widget
  { method: 'POST', path: '/api/booking', match: 'exact' },
  { method: 'POST', path: '/api/leads/create', match: 'exact' },
  { method: '*', path: '/api/chat', match: 'exact' },
  { method: 'GET', path: '/api/gbp-ratings', match: 'exact' },

  // Customer portal (token in path) and public pay lookup
  { method: '*', path: '/api/portal/', match: 'prefix' },
  { method: 'GET', path: '/api/pay/lookup', match: 'exact' },

  // Email/SMS unsubscribe
  { method: '*', path: '/api/marketing/unsubscribe', match: 'exact' },

  // Inbound provider webhooks
  { method: 'POST', path: '/api/sms/inbound', match: 'exact' },
  { method: 'POST', path: '/api/calls/webhook', match: 'exact' },
  { method: 'POST', path: '/api/calls/status', match: 'exact' },
  { method: 'POST', path: '/api/receptionist/webhook', match: 'exact' },
  { method: 'POST', path: '/api/receptionist/sarah', match: 'exact' },

  // QuickBooks OAuth return + token refresh cron
  { method: '*', path: '/api/quickbooks/callback', match: 'exact' },
  { method: '*', path: '/api/quickbooks/refresh', match: 'exact' },

  // Vercel Cron (x-vercel-cron + Authorization Bearer CRON_SECRET).
  // Middleware must not 401 these; the route still requires CRON_SECRET.
  { method: '*', path: '/api/cron/', match: 'prefix' },

  // Jobber unsent quote drafts — route still requires Bearer CRON_SECRET.
  { method: 'POST', path: '/api/jobber/tech-note-quote', match: 'exact' },
  { method: 'POST', path: '/api/jobber/drill-quote', match: 'exact' },

  // Browser push setup (public key only)
  { method: 'GET', path: '/api/push/vapid-key', match: 'exact' },
];

/** Cookie-less Vercel Cron — never 401 in Next.js middleware. Route checks CRON_SECRET. */
export function isCronApiPath(pathname: string): boolean {
  return pathname === '/api/cron' || pathname.startsWith('/api/cron/');
}

/**
 * Internal ops APIs authenticate themselves (CRM session or QUOTES_GP_KEY).
 * Middleware must not 401 before the route sees the office key.
 */
export function isOpsApiPath(pathname: string): boolean {
  return pathname === '/api/ops' || pathname.startsWith('/api/ops/');
}

export function isOpsPagePath(pathname: string): boolean {
  return pathname === '/ops' || pathname.startsWith('/ops/');
}

export function isPublicApiRoute(method: string, pathname: string): boolean {
  if (method === 'OPTIONS') {
    return true;
  }

  if (isCronApiPath(pathname)) {
    return true;
  }

  if (isOpsApiPath(pathname)) {
    return true;
  }

  return PUBLIC_API_RULES.some((rule) => {
    if (rule.method && rule.method !== '*' && rule.method !== method) {
      return false;
    }
    if (rule.match === 'prefix') {
      return pathname.startsWith(rule.path);
    }
    return pathname === rule.path;
  });
}
