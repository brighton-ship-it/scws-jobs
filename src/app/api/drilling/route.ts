import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { data: projects, error } = await supabase
      .from('drilling_projects')
      .select('*')
      .order('quote_date', { ascending: false });

    if (error) throw error;

    // Calculate days in stage for each project
    const projectsWithDays = (projects || []).map(p => {
      const stageDate = p.stage_changed_at || p.created_at;
      const daysInStage = Math.floor(
        (Date.now() - new Date(stageDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      return { ...p, days_in_stage: daysInStage };
    });

    return NextResponse.json({ projects: projectsWithDays });
  } catch (error) {
    console.error('Error fetching drilling projects:', error);
    return NextResponse.json({ error: 'Failed to fetch projects' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { data, error } = await supabase
      .from('drilling_projects')
      .insert({
        quote_id: body.quote_id,
        quote_number: body.quote_number,
        customer_name: body.customer_name,
        customer_id: body.customer_id,
        property_address: body.property_address,
        total: body.total,
        quote_date: body.quote_date,
        stage: body.stage || 'deposit',
        notes: body.notes
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ project: data });
  } catch (error) {
    console.error('Error creating drilling project:', error);
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 });
  }
}
