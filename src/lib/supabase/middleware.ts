import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isCronApiPath, isPublicApiRoute } from '@/lib/public-api';

// Check if we're in demo mode (no Supabase credentials)
const isDemoMode = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                   process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

export async function updateSession(request: NextRequest) {
  // In demo mode, skip all auth checks
  if (isDemoMode) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value,
            ...options,
          });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          response.cookies.set({
            name,
            value: '',
            ...options,
          });
        },
      },
    }
  );

  // Refresh session if expired
  const { data: { user } } = await supabase.auth.getUser();

  // Protected routes - redirect to login if not authenticated
  const pathname = request.nextUrl.pathname;
  const isAuthPage = pathname.startsWith('/login');
  const isApi = pathname.startsWith('/api');
  const isPublicPage =
    pathname.startsWith('/tech') ||  // Tech PWA - handles own auth
    pathname.startsWith('/portal') ||
    pathname.startsWith('/book') ||
    pathname.startsWith('/pay') ||
    pathname.startsWith('/unsubscribe');

  if (isApi) {
    // Vercel Cron must not 401 here. /api/cron/* checks CRON_SECRET itself.
    if (isCronApiPath(pathname) || isPublicApiRoute(request.method, pathname) || user) {
      return response;
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isProtectedRoute = !isAuthPage && !isPublicPage;

  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (isAuthPage && user) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return response;
}
