import webpush from 'web-push';
import { createServiceClient } from '@/lib/supabase/service';

// VAPID keys for push notifications
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = 'mailto:brighton@scwellservice.com';

let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[Push] VAPID keys not configured');
    return false;
  }
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidConfigured = true;
    return true;
  } catch (error) {
    console.error('[Push] Failed to configure VAPID:', error);
    return false;
  }
}

interface PushPayload {
  title: string;
  body?: string;
  icon?: string;
  badge?: string;
  tag?: string;
  url?: string;
  data?: Record<string, unknown>;
}

/**
 * Send push notification to a specific user
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  const supabase = createServiceClient();
  
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', userId);

  if (!subscriptions?.length) {
    console.log('[Push] No subscriptions for user:', userId);
    return 0;
  }

  return sendPushToSubscriptions(subscriptions, payload);
}

/**
 * Send push notification to all admin/office users
 */
export async function sendPushToAdmins(payload: PushPayload): Promise<number> {
  const supabase = createServiceClient();
  
  // Get admin/office user IDs
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .in('role', ['admin', 'office']);

  if (!users?.length) return 0;

  const userIds = users.map(u => u.id);
  
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds);

  if (!subscriptions?.length) {
    console.log('[Push] No admin subscriptions found');
    return 0;
  }

  return sendPushToSubscriptions(subscriptions, payload);
}

/**
 * Send push notification to all tech users
 */
export async function sendPushToTechs(payload: PushPayload): Promise<number> {
  const supabase = createServiceClient();
  
  const { data: users } = await supabase
    .from('users')
    .select('id')
    .eq('role', 'tech');

  if (!users?.length) return 0;

  const userIds = users.map(u => u.id);
  
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('*')
    .in('user_id', userIds);

  if (!subscriptions?.length) return 0;

  return sendPushToSubscriptions(subscriptions, payload);
}

/**
 * Send push to specific subscriptions
 */
async function sendPushToSubscriptions(
  subscriptions: Array<{
    id: string;
    endpoint: string;
    keys_p256dh: string;
    keys_auth: string;
  }>,
  payload: PushPayload
): Promise<number> {
  if (!ensureVapidConfigured()) {
    return 0;
  }

  const supabase = createServiceClient();
  let sent = 0;

  const notificationPayload = JSON.stringify({
    title: payload.title,
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192x192.png',
    badge: payload.badge || '/icons/badge-72x72.png',
    tag: payload.tag,
    data: {
      url: payload.url || '/',
      ...payload.data,
    },
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.keys_p256dh,
            auth: sub.keys_auth,
          },
        },
        notificationPayload
      );
      sent++;
      
      // Update last_used_at
      await supabase
        .from('push_subscriptions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', sub.id);
        
    } catch (error: unknown) {
      const pushError = error as { statusCode?: number };
      // If subscription is invalid, remove it
      if (pushError.statusCode === 410 || pushError.statusCode === 404) {
        console.log('[Push] Removing invalid subscription:', sub.endpoint.slice(0, 50));
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('[Push] Send error:', error);
      }
    }
  }

  console.log(`[Push] Sent ${sent}/${subscriptions.length} notifications`);
  return sent;
}
