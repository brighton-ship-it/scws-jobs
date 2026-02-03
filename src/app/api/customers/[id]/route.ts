import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/customers/[id] - Get a single customer with properties
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const { data: customer, error } = await supabase
      .from('customers')
      .select(`
        *,
        properties (*)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Customer not found' },
          { status: 404 }
        );
      }
      console.error('Error fetching customer:', error);
      return NextResponse.json(
        { error: 'Failed to fetch customer', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ customer });
  } catch (error) {
    console.error('Get customer API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/customers/[id] - Update a customer
 * Body: { name?, email?, phone?, billing_address?, notes? }
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    const body = await request.json();
    const { name, email, phone, billing_address, notes } = body;

    // Build update object with only provided fields
    const updates: Record<string, string | null> = {};
    if (name !== undefined) updates.name = name?.trim() || null;
    if (email !== undefined) updates.email = email?.trim() || null;
    if (phone !== undefined) updates.phone = phone?.trim() || null;
    if (billing_address !== undefined) updates.billing_address = billing_address?.trim() || null;
    if (notes !== undefined) updates.notes = notes?.trim() || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Validate name if being updated
    if (updates.name === null || updates.name === '') {
      return NextResponse.json(
        { error: 'Customer name cannot be empty' },
        { status: 400 }
      );
    }

    const { data: customer, error } = await supabase
      .from('customers')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        properties (*)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Customer not found' },
          { status: 404 }
        );
      }
      console.error('Error updating customer:', error);
      return NextResponse.json(
        { error: 'Failed to update customer', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ customer });
  } catch (error) {
    console.error('Update customer API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customers/[id] - Delete a customer
 * Note: This will cascade delete associated properties due to FK constraints
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = await createClient();
    const { id } = await params;

    // First check if customer exists
    const { data: existing, error: checkError } = await supabase
      .from('customers')
      .select('id')
      .eq('id', id)
      .single();

    if (checkError || !existing) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      );
    }

    // Delete the customer (properties should cascade delete via FK)
    const { error } = await supabase
      .from('customers')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting customer:', error);
      return NextResponse.json(
        { error: 'Failed to delete customer', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Customer deleted' });
  } catch (error) {
    console.error('Delete customer API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
