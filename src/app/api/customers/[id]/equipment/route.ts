import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/customers/[id]/equipment - Get all equipment for a customer
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id } = await params;

    const { data: equipment, error } = await supabase
      .from('customer_equipment')
      .select(`
        *,
        property:properties(id, address, city)
      `)
      .eq('customer_id', id)
      .order('equipment_type')
      .order('install_date', { ascending: false });

    if (error) {
      console.error('Error fetching customer equipment:', error);
      return NextResponse.json(
        { error: 'Failed to fetch equipment', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ equipment });
  } catch (error) {
    console.error('Get customer equipment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customers/[id]/equipment - Add new equipment
 * Body: { equipment_type, manufacturer?, model?, serial_number?, install_date?, warranty_expires?, notes?, property_id? }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const supabase = createServiceClient();
    const { id: customerId } = await params;
    const body = await request.json();

    // Validate required fields
    if (!body.equipment_type?.trim()) {
      return NextResponse.json(
        { error: 'Equipment type is required' },
        { status: 400 }
      );
    }

    const { data: equipment, error } = await supabase
      .from('customer_equipment')
      .insert({
        customer_id: customerId,
        property_id: body.property_id || null,
        equipment_type: body.equipment_type.trim(),
        manufacturer: body.manufacturer?.trim() || null,
        model: body.model?.trim() || null,
        serial_number: body.serial_number?.trim() || null,
        install_date: body.install_date || null,
        warranty_expires: body.warranty_expires || null,
        notes: body.notes?.trim() || null,
      })
      .select(`
        *,
        property:properties(id, address, city)
      `)
      .single();

    if (error) {
      console.error('Error creating equipment:', error);
      return NextResponse.json(
        { error: 'Failed to create equipment', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ equipment }, { status: 201 });
  } catch (error) {
    console.error('Create equipment API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
