import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { checkRateLimit, rateLimitedResponse, getRateLimitHeaders } from '@/lib/rate-limit';
import { isCronApiPath, isOpsApiPath } from '@/lib/public-api';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Vercel Cron is cookie-less. Session auth here 401s it at edge-middleware
  // and can drop Authorization before the route sees Bearer CRON_SECRET.
  // Rate-limit only; the handler still requires CRON_SECRET.
  if (isCronApiPath(path) || isOpsApiPath(path)) {
    const rateLimitResult = checkRateLimit(request);
    if (!rateLimitResult.success) {
      return rateLimitedResponse(rateLimitResult);
    }
    const response = NextResponse.next();
    const headers = getRateLimitHeaders(rateLimitResult);
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    if (isOpsApiPath(path)) {
      response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
    return response;
  }
  
  // Apply rate limiting to API routes
  if (path.startsWith('/api/')) {
    const rateLimitResult = checkRateLimit(request);
    
    if (!rateLimitResult.success) {
      return rateLimitedResponse(rateLimitResult);
    }
    
    // Continue with request, add rate limit headers to response
    const response = await updateSession(request);
    
    // Add rate limit headers
    const headers = getRateLimitHeaders(rateLimitResult);
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    
    return response;
  }
  
  // Non-API routes just get session handling
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder assets
     * - sw.js (service worker)
     * - manifest.json (PWA manifest)
     */
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.json|icons/.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
