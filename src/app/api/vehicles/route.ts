import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const dueSoon = searchParams.get('dueSoon') === 'true';
    const daysAhead = parseInt(searchParams.get('daysAhead') || '60');
    
    let query = supabase
      .from('vehicles')
      .select(`
        *,
        assigned_user:users!vehicles_assigned_user_id_fkey(id, name, email, phone)
      `)
      .order('registration_due_date', { ascending: true, nullsFirst: false });
    
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    
    if (search) {
      query = query.or(`name.ilike.%${search}%,license_plate.ilike.%${search}%,make.ilike.%${search}%,model.ilike.%${search}%`);
    }
    
    if (dueSoon) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysAhead);
      query = query.lte('registration_due_date', futureDate.toISOString().split('T')[0]);
    }
    
    const { data: vehicles, error } = await query;
    
    if (error) {
      console.error('Error fetching vehicles:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    // Add computed registration status to each vehicle
    const today = new Date();
    const vehiclesWithStatus = (vehicles || []).map(vehicle => {
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
      
      return {
        ...vehicle,
        registration_status,
        days_until_due,
      };
    });
    
    return NextResponse.json({ vehicles: vehiclesWithStatus });
  } catch (error) {
    console.error('Vehicles API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const body = await request.json();
    
    const {
      name,
      license_plate,
      vin,
      year,
      make,
      model,
      registration_due_date,
      insurance_expiry_date,
      assigned_user_id,
      status = 'active',
      notes,
    } = body;
    
    if (!name) {
      return NextResponse.json({ error: 'Vehicle name is required' }, { status: 400 });
    }
    
    const { data: vehicle, error } = await supabase
      .from('vehicles')
      .insert({
        name,
        license_plate: license_plate || null,
        vin: vin || null,
        year: year || null,
        make: make || null,
        model: model || null,
        registration_due_date: registration_due_date || null,
        insurance_expiry_date: insurance_expiry_date || null,
        assigned_user_id: assigned_user_id || null,
        status,
        notes: notes || null,
      })
      .select(`
        *,
        assigned_user:users!vehicles_assigned_user_id_fkey(id, name, email, phone)
      `)
      .single();
    
    if (error) {
      console.error('Error creating vehicle:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (error) {
    console.error('Vehicles API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
