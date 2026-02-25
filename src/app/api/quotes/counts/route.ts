import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceClient();
    
    const statuses = ['draft', 'sent', 'accepted', 'declined', 'expired', 'completed'];
    const counts: Record<string, number> = {};
    
    for (const status of statuses) {
      const { count, error } = await supabase
        .from('quotes')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      
      if (!error && count !== null) {
        counts[status] = count;
      }
    }
    
    return NextResponse.json({ counts });
  } catch (error) {
    console.error('Counts API error:', error);
    return NextResponse.json({ error: 'Failed to fetch counts' }, { status: 500 });
  }
}
