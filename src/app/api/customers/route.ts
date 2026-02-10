import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/customers - List customers with optional search
 * Query params:
 *   - search: Filter by name, email, or phone
 *   - limit: Max results (default 50)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    const searchParams = request.nextUrl.searchParams;
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    let query = supabase
      .from('customers')
      .select(`
        *,
        properties (*),
        lead_source,
        lead_stage
      `)
      .order('name', { ascending: true })
      .limit(limit);

    // Apply search filter if provided
    if (search && search.trim()) {
      const searchTerm = `%${search.trim()}%`;
      query = query.or(`name.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm}`);
    }

    const { data: customers, error } = await query;

    if (error) {
      console.error('Error fetching customers:', error);
      return NextResponse.json(
        { error: 'Failed to fetch customers', details: error.message },
        { status: 500 }
      );
    }

    // Get total count
    let total = customers?.length || 0;
    if (!search) {
      const { count } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true });
      total = count || 0;
    }

    return NextResponse.json({ customers, total });
  } catch (error) {
    console.error('Customers API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customers - Create a new customer with properties
 * Body: { customer: {...}, properties: [{...}] }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();

    const body = await request.json();
    const { customer, properties } = body;

    // Validate required fields
    if (!customer?.name?.trim()) {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }

    // Validate at least one property with an address
    const validProperties = properties?.filter((p: { address?: string }) => p.address?.trim());
    if (!validProperties || validProperties.length === 0) {
      return NextResponse.json(
        { error: 'At least one property with an address is required' },
        { status: 400 }
      );
    }

    // Insert customer with lead source tracking
    const { data: newCustomer, error: customerError } = await supabase
      .from('customers')
      .insert({
        name: customer.name.trim(),
        email: customer.email?.trim() || null,
        phone: customer.phone?.trim() || null,
        billing_address: customer.billing_address?.trim() || null,
        billing_city: customer.billing_city?.trim() || null,
        billing_state: customer.billing_state?.trim() || null,
        billing_zip: customer.billing_zip?.trim() || null,
        notes: customer.notes?.trim() || null,
        // Lead tracking fields
        lead_source: customer.lead_source || null,
        lead_source_detail: customer.lead_source_detail?.trim() || null,
        utm_source: customer.utm_source?.trim() || null,
        utm_medium: customer.utm_medium?.trim() || null,
        utm_campaign: customer.utm_campaign?.trim() || null,
        utm_term: customer.utm_term?.trim() || null,
        utm_content: customer.utm_content?.trim() || null,
        referrer_url: customer.referrer_url?.trim() || null,
        lead_stage: customer.lead_stage || 'lead',
      } as any)
      .select()
      .single();

    if (customerError) {
      console.error('Error creating customer:', customerError);
      return NextResponse.json(
        { error: 'Failed to create customer', details: customerError.message },
        { status: 500 }
      );
    }

    // Insert properties
    const propertiesToInsert = validProperties.map((p: {
      address: string;
      city?: string;
      county?: string;
      zip?: string;
      access_notes?: string;
      lat?: number;
      lng?: number;
    }) => ({
      customer_id: newCustomer.id,
      address: p.address.trim(),
      city: p.city?.trim() || null,
      county: p.county?.trim() || null,
      zip: p.zip?.trim() || null,
      access_notes: p.access_notes?.trim() || null,
      lat: p.lat || null,
      lng: p.lng || null,
    }));

    const { data: newProperties, error: propertiesError } = await supabase
      .from('properties')
      .insert(propertiesToInsert)
      .select();

    if (propertiesError) {
      console.error('Error creating properties:', propertiesError);
      // Customer was created but properties failed - still return the customer
      return NextResponse.json({
        customer: newCustomer,
        properties: [],
        warning: 'Customer created but some properties failed to save',
        details: propertiesError.message,
      });
    }

    return NextResponse.json({
      customer: newCustomer,
      properties: newProperties,
    });
  } catch (error) {
    console.error('Create customer API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
