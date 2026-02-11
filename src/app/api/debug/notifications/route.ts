import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function GET() {
  const supabase = createServiceClient();

  const { data: notifications, error, count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(10);

  return NextResponse.json({
    count,
    error: error?.message,
    notifications: notifications?.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      read: n.read,
      created_at: n.created_at,
    })) || [],
  });
}
