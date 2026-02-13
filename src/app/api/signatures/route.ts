import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { headers } from 'next/headers';
import type { Signature } from '@/types/database';

/**
 * GET /api/signatures?quote_id=xxx - Get signature for a quote
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const quoteId = searchParams.get('quote_id');

    if (!quoteId) {
      return NextResponse.json(
        { error: 'quote_id is required' },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('signatures')
      .select('*')
      .eq('quote_id', quoteId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[Signatures] Fetch error:', error);
      return NextResponse.json({ signature: null });
    }

    return NextResponse.json({ signature: data || null });
  } catch (error) {
    console.error('[Signatures] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/signatures - Create a new signature
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const headersList = await headers();

    // Validate required fields
    if (!body.quote_id || !body.signature_data || !body.signer_name) {
      return NextResponse.json(
        { error: 'Missing required fields: quote_id, signature_data, signer_name' },
        { status: 400 }
      );
    }

    // Get client info
    const forwardedFor = headersList.get('x-forwarded-for');
    const realIp = headersList.get('x-real-ip');
    const ipAddress = forwardedFor?.split(',')[0]?.trim() || realIp || 'unknown';
    const userAgent = headersList.get('user-agent') || null;

    const signatureData: Omit<Signature, 'id' | 'created_at'> = {
      quote_id: body.quote_id,
      signature_data: body.signature_data,
      signer_name: body.signer_name,
      signer_email: body.signer_email || null,
      ip_address: ipAddress,
      user_agent: userAgent,
      signed_at: new Date().toISOString(),
    };

    const supabase = createServiceClient();

    // Check if already signed
    const { data: existing } = await supabase
      .from('signatures')
      .select('id')
      .eq('quote_id', body.quote_id)
      .single();

    if (existing) {
      return NextResponse.json(
        { error: 'This quote has already been signed' },
        { status: 400 }
      );
    }

    // Insert signature
    const { data, error } = await supabase
      .from('signatures')
      .insert(signatureData)
      .select()
      .single();

    if (error) {
      console.error('[Signatures] Create error:', error);
      return NextResponse.json(
        { error: 'Failed to save signature' },
        { status: 500 }
      );
    }

    // Update quote status to accepted
    await supabase
      .from('quotes')
      .update({ 
        status: 'accepted', 
        accepted_at: new Date().toISOString() 
      })
      .eq('id', body.quote_id);

    return NextResponse.json({ signature: data }, { status: 201 });
  } catch (error) {
    console.error('[Signatures] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
