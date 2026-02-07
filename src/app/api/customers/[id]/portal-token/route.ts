import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * GET /api/customers/[id]/portal-token - Get or create a portal token for a customer
 * 
 * Returns the portal URL for the customer (requires auth)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServiceClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: customerId } = await params;

    // Verify customer exists
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Use service client to manage tokens (bypasses RLS)
    const serviceClient = createServiceClient();

    // Check for existing valid token
    const { data: existingToken } = await serviceClient
      .from('portal_tokens')
      .select('token, expires_at')
      .eq('customer_id', customerId)
      .is('expires_at', null) // Non-expiring tokens
      .or(`expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingToken) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
      return NextResponse.json({
        token: existingToken.token,
        portalUrl: `${baseUrl}/portal/${existingToken.token}`,
        expiresAt: existingToken.expires_at,
      });
    }

    // Generate new token
    const newToken = generateToken(32);
    
    const { data: createdToken, error: createError } = await serviceClient
      .from('portal_tokens')
      .insert({
        customer_id: customerId,
        token: newToken,
        created_by: user.id,
        // No expiration by default - can be set if needed
      })
      .select('token, expires_at')
      .single();

    if (createError) {
      console.error('Error creating portal token:', createError);
      return NextResponse.json(
        { error: 'Failed to create portal token' },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    return NextResponse.json({
      token: createdToken.token,
      portalUrl: `${baseUrl}/portal/${createdToken.token}`,
      expiresAt: createdToken.expires_at,
    });

  } catch (error) {
    console.error('Portal token API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customers/[id]/portal-token - Create a new portal token
 * 
 * Optionally set expiration
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServiceClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { id: customerId } = await params;
    const body = await request.json().catch(() => ({}));
    const { expiresInDays } = body;

    // Verify customer exists
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name')
      .eq('id', customerId)
      .single();

    if (customerError || !customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Use service client
    const serviceClient = createServiceClient();

    // Generate new token
    const newToken = generateToken(32);
    
    // Calculate expiration if specified
    let expiresAt = null;
    if (expiresInDays && expiresInDays > 0) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + expiresInDays);
      expiresAt = expDate.toISOString();
    }
    
    const { data: createdToken, error: createError } = await serviceClient
      .from('portal_tokens')
      .insert({
        customer_id: customerId,
        token: newToken,
        expires_at: expiresAt,
        created_by: user.id,
      })
      .select('token, expires_at')
      .single();

    if (createError) {
      console.error('Error creating portal token:', createError);
      return NextResponse.json(
        { error: 'Failed to create portal token' },
        { status: 500 }
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    return NextResponse.json({
      token: createdToken.token,
      portalUrl: `${baseUrl}/portal/${createdToken.token}`,
      expiresAt: createdToken.expires_at,
    });

  } catch (error) {
    console.error('Portal token POST API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Generate a secure random token
function generateToken(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}
