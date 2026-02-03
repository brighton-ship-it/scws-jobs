import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { checkRateLimit, rateLimitedResponse, getRateLimitHeaders } from '@/lib/rate-limit';

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  
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
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
