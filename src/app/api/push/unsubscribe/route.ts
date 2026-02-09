import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, endpoint } = body;

    const supabase = createServiceClient();
    
    // Delete by user ID or endpoint
    let query = supabase.from('push_subscriptions').delete();
    
    if (endpoint) {
      query = query.eq('endpoint', endpoint);
    } else if (userId) {
      query = query.eq('user_id', userId);
    } else {
      return NextResponse.json({ error: 'Missing userId or endpoint' }, { status: 400 });
    }

    const { error } = await query;

    if (error) {
      console.error('[Push] Unsubscribe error:', error);
      return NextResponse.json({ error: 'Failed to unsubscribe' }, { status: 500 });
    }

    console.log('[Push] Unsubscribed:', userId || endpoint);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Push] Unsubscribe error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
