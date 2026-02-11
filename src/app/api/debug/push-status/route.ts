import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function GET() {
  const supabase = createServiceClient();

  // Get all push subscriptions
  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select('id, user_id, endpoint, user_agent, created_at, last_used_at')
    .order('created_at', { ascending: false });

  // Get users with their roles
  const { data: users } = await supabase
    .from('users')
    .select('id, email, role')
    .in('role', ['admin', 'office']);

  // Check VAPID config
  const vapidConfigured = !!(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

  return NextResponse.json({
    vapidConfigured,
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? 'Set ✅' : 'Missing ❌',
    privateKey: process.env.VAPID_PRIVATE_KEY ? 'Set ✅' : 'Missing ❌',
    adminUsers: users?.length || 0,
    subscriptions: subscriptions?.length || 0,
    subscriptionDetails: subscriptions?.map(s => ({
      id: s.id,
      user_id: s.user_id,
      endpoint: s.endpoint?.slice(0, 80) + '...',
      user_agent: s.user_agent?.slice(0, 50),
      created: s.created_at,
      last_used: s.last_used_at,
    })) || [],
    error: error?.message,
  });
}
