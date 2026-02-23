import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: jobTypes, error } = await supabase
      .from('job_types')
      .select('id, name, default_duration, description')
      .order('name');

    if (error) {
      console.error('Error fetching job types:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform duration to friendly format
    const formattedJobTypes = (jobTypes || []).map((jt) => ({
      id: jt.id,
      name: jt.name,
      default_duration: jt.default_duration || '2 hours',
      description: jt.description,
    }));

    return NextResponse.json({ jobTypes: formattedJobTypes });
  } catch (error) {
    console.error('Error in job-types API:', error);
    return NextResponse.json(
      { error: 'Failed to fetch job types' },
      { status: 500 }
    );
  }
}
