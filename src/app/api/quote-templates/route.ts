import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceClient();
    const { data: templates, error } = await supabase
      .from('quote_templates')
      .select('*')
      .eq('active', true)
      .order('name');

    if (error) throw error;
    return NextResponse.json({ templates: templates || [] });
  } catch (error) {
    console.error('Failed to fetch quote templates:', error);
    return NextResponse.json({ error: 'Failed to fetch templates' }, { status: 500 });
  }
}
