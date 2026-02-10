import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Temporary debug endpoint - check notifications table
export async function GET() {
  try {
    const supabase = createServiceClient();
    
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('id, type, title, message, read, created_at, user_id')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      count: notifications?.length || 0,
      notifications: notifications || []
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
