import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;

webpush.setVapidDetails(
  'mailto:brighton@scwellservice.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

export async function POST() {
  try {
    const supabase = createServiceClient();
    
    // Get all subscriptions
    const { data: subs, error } = await supabase
      .from('push_subscriptions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({ error: 'No subscriptions found' }, { status: 404 });
    }

    const results = [];
    
    for (const sub of subs) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth,
          },
        };

        await webpush.sendNotification(
          pushSubscription,
          JSON.stringify({
            title: '🔔 Test Notification',
            body: 'Push notifications are working!',
            tag: 'test',
            data: { url: '/tech' },
          })
        );
        
        results.push({ endpoint: sub.endpoint.slice(0, 50), status: 'sent' });
      } catch (e: any) {
        results.push({ endpoint: sub.endpoint.slice(0, 50), status: 'failed', error: e.message });
      }
    }

    return NextResponse.json({ sent: results.length, results });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
