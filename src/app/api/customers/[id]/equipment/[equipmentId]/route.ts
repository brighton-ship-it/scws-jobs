import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string; equipmentId: string }>;
}

/**
 * GET /api/customers/[id]/equipment/[equipmentId] - Get single equipment
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: customerId, equipmentId } = await params;

    const { data: equipment, error } = await supabase
      .from('customer_equipment')
      .select(`
        *,
        property:properties(id, address, city)
      `)
      .eq('id', equipmentId)
      .eq('customer_id', customerId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Equipment not found' },
          { status: 404 }
        );
      }
      console.error('Error fetching equipment:', error);
      return NextResponse.json(
        { error: 'Failed to fetch equipment', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ equipment });
  } catch (error) {
    console.error('Get equipment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/customers/[id]/equipment/[equipmentId] - Update equipment
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: customerId, equipmentId } = await params;
    const body = await request.json();

    const updates: Record<string, unknown> = {};
    
    if (body.equipment_type !== undefined) updates.equipment_type = body.equipment_type?.trim() || null;
    if (body.manufacturer !== undefined) updates.manufacturer = body.manufacturer?.trim() || null;
    if (body.model !== undefined) updates.model = body.model?.trim() || null;
    if (body.serial_number !== undefined) updates.serial_number = body.serial_number?.trim() || null;
    if (body.install_date !== undefined) updates.install_date = body.install_date || null;
    if (body.warranty_expires !== undefined) updates.warranty_expires = body.warranty_expires || null;
    if (body.notes !== undefined) updates.notes = body.notes?.trim() || null;
    if (body.property_id !== undefined) updates.property_id = body.property_id || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    // Validate equipment_type if being updated
    if (updates.equipment_type === null || updates.equipment_type === '') {
      return NextResponse.json(
        { error: 'Equipment type cannot be empty' },
        { status: 400 }
      );
    }

    const { data: equipment, error } = await supabase
      .from('customer_equipment')
      .update(updates)
      .eq('id', equipmentId)
      .eq('customer_id', customerId)
      .select(`
        *,
        property:properties(id, address, city)
      `)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Equipment not found' },
          { status: 404 }
        );
      }
      console.error('Error updating equipment:', error);
      return NextResponse.json(
        { error: 'Failed to update equipment', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ equipment });
  } catch (error) {
    console.error('Update equipment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customers/[id]/equipment/[equipmentId] - Delete equipment
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: customerId, equipmentId } = await params;

    // Check if exists
    const { data: existing, error: checkError } = await supabase
      .from('customer_equipment')
      .select('id')
      .eq('id', equipmentId)
      .eq('customer_id', customerId)
      .single();

    if (checkError || !existing) {
      return NextResponse.json(
        { error: 'Equipment not found' },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from('customer_equipment')
      .delete()
      .eq('id', equipmentId)
      .eq('customer_id', customerId);

    if (error) {
      console.error('Error deleting equipment:', error);
      return NextResponse.json(
        { error: 'Failed to delete equipment', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: 'Equipment deleted' });
  } catch (error) {
    console.error('Delete equipment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
