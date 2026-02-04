import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/invoices/[id] - Get a single invoice with details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select(`
        *,
        customer:customers (*),
        job:jobs (id, job_type, status, description),
        quote:quotes (id, quote_number, status),
        items:invoice_items (*),
        payments (*)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
      }
      console.error('Error fetching invoice:', error);
      return NextResponse.json(
        { error: 'Failed to fetch invoice', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/invoices/[id] - Update an invoice
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const body = await request.json();

    const {
      status,
      issue_date,
      due_date,
      tax_rate,
      notes,
      internal_notes,
      items, // If provided, replace all items
    } = body;

    // Build update object
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (status) updates.status = status;
    if (issue_date) updates.issue_date = issue_date;
    if (due_date) updates.due_date = due_date;
    if (tax_rate !== undefined) updates.tax_rate = tax_rate;
    if (notes !== undefined) updates.notes = notes;
    if (internal_notes !== undefined) updates.internal_notes = internal_notes;

    // If status changed to 'sent', record sent_at
    if (status === 'sent') {
      updates.sent_at = new Date().toISOString();
    }
    if (status === 'paid') {
      updates.paid_at = new Date().toISOString();
    }

    // If items provided, recalculate totals
    if (items && items.length > 0) {
      const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);
      const taxableSubtotal = items
        .filter((item: any) => item.taxable !== false)
        .reduce((sum: number, item: any) => sum + (item.quantity * item.unit_price), 0);
      const effectiveTaxRate = tax_rate ?? 8.75;
      const tax_amount = taxableSubtotal * (effectiveTaxRate / 100);
      
      updates.subtotal = subtotal;
      updates.tax_amount = tax_amount;
      updates.total = subtotal + tax_amount;

      // Delete existing items and insert new ones
      await supabase.from('invoice_items').delete().eq('invoice_id', id);

      const invoiceItems = items.map((item: any, index: number) => ({
        invoice_id: id,
        product_id: item.product_id || null,
        description: item.description,
        item_description: item.item_description || null,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.quantity * item.unit_price,
        item_type: item.item_type || null,
        taxable: item.taxable !== false,
        sort_order: index,
      }));

      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(invoiceItems);

      if (itemsError) {
        console.error('Error updating invoice items:', itemsError);
        return NextResponse.json(
          { error: 'Failed to update invoice items', details: itemsError.message },
          { status: 500 }
        );
      }
    }

    // Update the invoice
    const { data: invoice, error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', id)
      .select(`
        *,
        customer:customers (id, name, email, phone),
        items:invoice_items (*)
      `)
      .single();

    if (error) {
      console.error('Error updating invoice:', error);
      return NextResponse.json(
        { error: 'Failed to update invoice', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ invoice });
  } catch (error) {
    console.error('Update invoice error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/invoices/[id] - Delete an invoice (only drafts)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    // Check if invoice is a draft
    const { data: existing } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', id)
      .single();

    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });
    }

    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft invoices can be deleted. Void the invoice instead.' },
        { status: 400 }
      );
    }

    // Delete items first (cascade should handle this but being explicit)
    await supabase.from('invoice_items').delete().eq('invoice_id', id);

    // Delete the invoice
    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting invoice:', error);
      return NextResponse.json(
        { error: 'Failed to delete invoice', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete invoice error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
