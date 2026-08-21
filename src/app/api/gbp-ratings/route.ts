import { NextRequest, NextResponse } from 'next/server';
import { gbpCorsHeaders, gbpRatingsHttp } from '@/lib/gbp';

export const dynamic = 'force-dynamic';

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: gbpCorsHeaders(request),
  });
}

/**
 * GET /api/gbp-ratings
 * Public JSON for the marketing site. Rating + count only — no review text.
 */
export async function GET(request: NextRequest) {
  const result = await gbpRatingsHttp(request);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
