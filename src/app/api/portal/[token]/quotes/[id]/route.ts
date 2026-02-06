import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/portal/[token]/quotes/[id] - Get quote details via portal token
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const { token, id: quoteId } = await params;
    
    if (!token || token.length < 20) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Validate portal token
    const { data: portalToken, error: tokenError } = await supabase
      .from('portal_tokens')
      .select('customer_id, expires_at')
      .eq('token', token)
      .single();

    if (tokenError || !portalToken) {
      return NextResponse.json({ error: 'Invalid or expired portal link' }, { status: 404 });
    }

    if (portalToken.expires_at && new Date(portalToken.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This portal link has expired' }, { status: 410 });
    }

    // Get quote with items - verify it belongs to this customer
    const { data: quote, error } = await supabase
      .from('quotes')
      .select(`
        *,
        customer:customers (id, name, email, phone),
        property:properties (address, city, state, zip),
        items:quote_items (*)
      `)
      .eq('id', quoteId)
      .eq('customer_id', portalToken.customer_id)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }

    // Update last used timestamp
    await supabase
      .from('portal_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token', token);

    return NextResponse.json({ quote });
  } catch (error) {
    console.error('Portal quote API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/portal/[token]/quotes/[id] - Approve quote with signature
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; id: string }> }
) {
  try {
    const { token, id: quoteId } = await params;
    const body = await request.json();
    const { signature, signerName } = body;

    if (!token || token.length < 20) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    if (!signature) {
      return NextResponse.json({ error: 'Signature required' }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Validate portal token
    const { data: portalToken, error: tokenError } = await supabase
      .from('portal_tokens')
      .select('customer_id, expires_at')
      .eq('token', token)
      .single();

    if (tokenError || !portalToken) {
      return NextResponse.json({ error: 'Invalid or expired portal link' }, { status: 404 });
    }

    if (portalToken.expires_at && new Date(portalToken.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This portal link has expired' }, { status: 410 });
    }

    // Get quote - verify it belongs to this customer
    const { data: quote, error } = await supabase
      .from('quotes')
      .select('id, status, customer_id')
      .eq('id', quoteId)
      .eq('customer_id', portalToken.customer_id)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }

    if (quote.status === 'approved') {
      return NextResponse.json({ error: 'Quote already approved' }, { status: 400 });
    }

    // Save signature
    const { error: sigError } = await supabase.from('signatures').insert({
      quote_id: quoteId,
      signer_name: signerName || 'Customer',
      signature_data: signature,
      signed_at: new Date().toISOString(),
      ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || null,
    });

    if (sigError) {
      console.error('Signature save error:', sigError);
      // Continue even if signature save fails - we'll still approve the quote
    }

    // Update quote status
    const { error: updateError } = await supabase
      .from('quotes')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
      })
      .eq('id', quoteId);

    if (updateError) {
      console.error('Quote update error:', updateError);
      return NextResponse.json({ error: 'Failed to approve quote' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Quote approved successfully',
    });
  } catch (error) {
    console.error('Portal quote approval error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
