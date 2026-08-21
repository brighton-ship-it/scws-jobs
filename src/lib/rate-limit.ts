/**
 * Simple in-memory rate limiter for API routes
 * For production, consider using Upstash Redis or Vercel KV
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store (resets on cold start, but good enough for basic protection)
const rateLimitStore = new Map<string, RateLimitEntry>();

interface RateLimitConfig {
  windowMs: number;  // Time window in milliseconds
  max: number;       // Max requests per window
}

const defaultConfig: RateLimitConfig = {
  windowMs: 60 * 1000,  // 1 minute
  max: 100,             // 100 requests per minute
};

// Different limits for different endpoints
export const rateLimitConfigs: Record<string, RateLimitConfig> = {
  // Auth endpoints - stricter limits
  '/api/auth': { windowMs: 60 * 1000, max: 10 },
  '/api/portal': { windowMs: 60 * 1000, max: 30 },

  // Public marketing-site intake — tighter than the default 100/min
  '/api/booking': { windowMs: 15 * 60 * 1000, max: 15 },
  '/api/leads': { windowMs: 15 * 60 * 1000, max: 10 },
  '/api/chat': { windowMs: 60 * 1000, max: 20 },
  '/api/pay/lookup': { windowMs: 60 * 1000, max: 10 },
  
  // Payment endpoints - moderate limits
  '/api/payments': { windowMs: 60 * 1000, max: 20 },
  '/api/quickbooks': { windowMs: 60 * 1000, max: 30 },
  
  // Cron endpoints - very limited
  '/api/cron': { windowMs: 60 * 1000, max: 5 },
  
  // General API - standard limits
  default: defaultConfig,
};

function getClientIdentifier(request: Request): string {
  // Try to get real IP from headers (for proxied requests)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  if (realIp) {
    return realIp;
  }
  
  // Fallback to a hash of user agent + accept-language (not great but something)
  const ua = request.headers.get('user-agent') || 'unknown';
  const lang = request.headers.get('accept-language') || 'unknown';
  return `${ua}-${lang}`.slice(0, 100);
}

function getConfigForPath(path: string): RateLimitConfig {
  for (const [prefix, config] of Object.entries(rateLimitConfigs)) {
    if (prefix !== 'default' && path.startsWith(prefix)) {
      return config;
    }
  }
  return rateLimitConfigs.default;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

export function checkRateLimit(request: Request): RateLimitResult {
  const url = new URL(request.url);
  const path = url.pathname;
  const clientId = getClientIdentifier(request);
  const config = getConfigForPath(path);
  
  const key = `${clientId}:${path}`;
  const now = Date.now();
  
  let entry = rateLimitStore.get(key);
  
  // Clean up expired entries occasionally
  if (Math.random() < 0.01) {
    cleanupExpiredEntries();
  }
  
  if (!entry || entry.resetAt < now) {
    // New window
    entry = {
      count: 1,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
    
    return {
      success: true,
      remaining: config.max - 1,
      resetAt: entry.resetAt,
      limit: config.max,
    };
  }
  
  // Existing window
  entry.count++;
  
  if (entry.count > config.max) {
    return {
      success: false,
      remaining: 0,
      resetAt: entry.resetAt,
      limit: config.max,
    };
  }
  
  return {
    success: true,
    remaining: config.max - entry.count,
    resetAt: entry.resetAt,
    limit: config.max,
  };
}

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

/**
 * Rate limit headers to include in response
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': result.limit.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
  };
}

/**
 * Create a rate-limited response
 */
export function rateLimitedResponse(result: RateLimitResult): Response {
  return new Response(
    JSON.stringify({
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...getRateLimitHeaders(result),
        'Retry-After': Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
      },
    }
  );
}
