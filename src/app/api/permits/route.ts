import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function GET() {
  try {
    const supabase = createServiceClient();
    
    const { data: permits, error } = await supabase
      .from('permits')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // Table might not exist yet
      if (error.code === '42P01') {
        return NextResponse.json({ permits: [], message: 'Permits table not yet created. Run migration.' });
      }
      throw error;
    }

    return NextResponse.json({ permits });
  } catch (error) {
    console.error('Error fetching permits:', error);
    return NextResponse.json({ error: 'Failed to fetch permits' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();

    const {
      permit_number,
      wp_number,
      county,
      address,
      city,
      state = 'CA',
      zip,
      customer_id,
      job_id,
      status = 'active',
      issue_date,
      expiration_date,
      permit_type = 'well',
      pdf_url,
      notes,
    } = body;

    const { data: permit, error } = await supabase
      .from('permits')
      .insert({
        permit_number,
        wp_number,
        county,
        address,
        city,
        state,
        zip,
        customer_id,
        job_id,
        status,
        issue_date,
        expiration_date,
        permit_type,
        pdf_url,
        notes,
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating permit:', error);
      return NextResponse.json({ error: 'Failed to create permit', details: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, permit });
  } catch (error) {
    console.error('Permits API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
