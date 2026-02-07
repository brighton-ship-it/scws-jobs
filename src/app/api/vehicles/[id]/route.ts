import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServiceClient();
    const { id } = await params;
    
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .select(`
        *,
        assigned_user:users!vehicles_assigned_user_id_fkey(id, name, email, phone)
      `)
      .eq('id', id)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
      }
      console.error('Error fetching vehicle:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Add computed registration status
    const today = new Date();
    let registration_status = 'current';
    let days_until_due = null;
    
    if (vehicle.registration_due_date) {
      const dueDate = new Date(vehicle.registration_due_date);
      days_until_due = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      if (days_until_due < 0) {
        registration_status = 'expired';
      } else if (days_until_due <= 30) {
        registration_status = 'due_soon';
      } else if (days_until_due <= 60) {
        registration_status = 'upcoming';
      }
    }
    
    // Get vehicle reminders history
    const { data: reminders } = await supabase
      .from('vehicle_reminders')
      .select('*')
      .eq('vehicle_id', id)
      .order('sent_at', { ascending: false })
      .limit(20);
    
    return NextResponse.json({
      vehicle: {
        ...vehicle,
        registration_status,
        days_until_due,
      },
      reminders: reminders || [],
    });
  } catch (error) {
    console.error('Vehicle API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServiceClient();
    const { id } = await params;
    const body = await request.json();
    
    // Filter out undefined values
    const updateData: Record<string, any> = {};
    const allowedFields = [
      'name', 'license_plate', 'vin', 'year', 'make', 'model',
      'registration_due_date', 'insurance_expiry_date',
      'assigned_user_id', 'status', 'notes'
    ];
    
    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field] || null;
      }
    }
    
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }
    
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        assigned_user:users!vehicles_assigned_user_id_fkey(id, name, email, phone)
      `)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
      }
      console.error('Error updating vehicle:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ vehicle });
  } catch (error) {
    console.error('Vehicle API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createServiceClient();
    const { id } = await params;
    
    const { error } = await supabase
      .from('vehicles')
      .delete()
      .eq('id', id);
    
    if (error) {
      console.error('Error deleting vehicle:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Vehicle API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
