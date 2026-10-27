/** Shop-leg answering-machine result. A person stays on the shop line. A machine hangs up so Mike can be dialed. */
import { NextRequest, NextResponse } from 'next/server';
import { parseTwilio } from '@/lib/phone-calls/auth';
import { handleShopAmd } from '@/lib/phone-calls/shop-amd';
import { optionalServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { params, valid } = await parseTwilio(req);
  if (!valid) return new NextResponse('Forbidden', { status: 403 });
  const result = await handleShopAmd({
    answeredBy: params.AnsweredBy,
    parentCallSid: params.ParentCallSid,
    childCallSid: params.CallSid,
    db: optionalServiceClient(),
    env: process.env,
  });
  return new NextResponse('', { status: result.httpStatus });
}
