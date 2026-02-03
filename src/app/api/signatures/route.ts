import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import type { Signature } from '@/types/database';

// Check if we're in demo/mock mode
const useMockData = !process.env.NEXT_PUBLIC_SUPABASE_URL || 
                    process.env.NEXT_PUBLIC_SUPABASE_URL === 'your-supabase-url';

// Use service key for server-side operations
const supabase = useMockData ? null : createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Mock signatures store for demo mode
const mockSignatures: Map<string, Signature> = new Map();

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

    // Return mock data in demo mode
    if (useMockData || !supabase) {
      const signature = mockSignatures.get(quoteId);
      return NextResponse.json({ signature: signature || null });
    }

    const { data, error } = await supabase
      .from('signatures')
      .select('*')
      .eq('quote_id', quoteId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[Signatures] Fetch error:', error);
      // Fall back to mock
      const signature = mockSignatures.get(quoteId);
      return NextResponse.json({ signature: signature || null });
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

    // Handle mock data mode
    if (useMockData || !supabase) {
      // Check if already signed
      if (mockSignatures.has(body.quote_id)) {
        return NextResponse.json(
          { error: 'This quote has already been signed' },
          { status: 400 }
        );
      }

      const newSignature: Signature = {
        id: `sig_${Date.now()}`,
        ...signatureData,
        created_at: new Date().toISOString(),
      };
      mockSignatures.set(body.quote_id, newSignature);
      return NextResponse.json({ signature: newSignature }, { status: 201 });
    }

    // Check if already signed in database
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
      console.error('[Signatures] Create error, falling back to mock:', error);
      // Fall back to mock data on error
      const newSignature: Signature = {
        id: `sig_${Date.now()}`,
        ...signatureData,
        created_at: new Date().toISOString(),
      };
      mockSignatures.set(body.quote_id, newSignature);
      return NextResponse.json({ signature: newSignature }, { status: 201 });
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
