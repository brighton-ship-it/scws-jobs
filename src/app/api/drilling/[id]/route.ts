import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();
    const { data: project, error } = await supabase
      .from('drilling_projects')
      .select('*')
      .eq('id', params.id)
      .single();

    if (error) throw error;

    return NextResponse.json({ project });
  } catch (error) {
    console.error('Error fetching drilling project:', error);
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();
    const body = await request.json();
    
    const updates: any = {
      updated_at: new Date().toISOString()
    };

    // Handle stage change
    if (body.stage) {
      updates.stage = body.stage;
      updates.stage_changed_at = new Date().toISOString();
      
      // Auto-set dates based on stage
      switch (body.stage) {
        case 'deposit':
          if (body.deposit_amount) updates.deposit_amount = body.deposit_amount;
          if (!updates.deposit_date) updates.deposit_date = new Date().toISOString();
          break;
        case 'site_visit':
          if (!updates.site_visit_date) updates.site_visit_date = new Date().toISOString();
          break;
        case 'submitted':
          if (!updates.permit_submitted_date) updates.permit_submitted_date = new Date().toISOString();
          break;
        case 'approved':
          if (!updates.county_approved_date) updates.county_approved_date = new Date().toISOString();
          break;
        case 'scheduled':
          if (body.scheduled_date) updates.scheduled_date = body.scheduled_date;
          break;
      }
    }

    // Handle other updates
    if (body.deposit_amount !== undefined) updates.deposit_amount = body.deposit_amount;
    if (body.deposit_date) updates.deposit_date = body.deposit_date;
    if (body.site_visit_date) updates.site_visit_date = body.site_visit_date;
    if (body.permit_submitted_date) updates.permit_submitted_date = body.permit_submitted_date;
    if (body.county_tracking_number) updates.county_tracking_number = body.county_tracking_number;
    if (body.county_approved_date) updates.county_approved_date = body.county_approved_date;
    if (body.scheduled_date) updates.scheduled_date = body.scheduled_date;
    if (body.notes !== undefined) updates.notes = body.notes;

    const { data, error } = await supabase
      .from('drilling_projects')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ project: data });
  } catch (error) {
    console.error('Error updating drilling project:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase
      .from('drilling_projects')
      .delete()
      .eq('id', params.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting drilling project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
