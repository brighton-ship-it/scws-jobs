import { createServiceClient } from '@/lib/supabase/service';

type NotificationType = 'call' | 'booking' | 'task' | 'payment' | 'system';
type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface CreateNotificationOptions {
  userId?: string; // If not provided, sends to all admins
  type: NotificationType;
  title: string;
  message?: string;
  entityType?: string;
  entityId?: string;
  priority?: Priority;
  metadata?: Record<string, unknown>;
}

/**
 * Create an in-app notification
 */
export async function createNotification(options: CreateNotificationOptions): Promise<boolean> {
  const supabase = createServiceClient();

  try {
    // If no specific user, get all admin users
    let userIds: string[] = [];
    
    if (options.userId) {
      userIds = [options.userId];
    } else {
      // Get all admin/office users
      const { data: users } = await supabase
        .from('users')
        .select('id')
        .in('role', ['admin', 'office']);
      
      userIds = users?.map(u => u.id) || [];
    }

    if (userIds.length === 0) {
      console.log('[Notifications] No users to notify');
      return false;
    }

    // Create notification for each user
    const notifications = userIds.map(userId => ({
      user_id: userId,
      type: options.type,
      title: options.title,
      message: options.message || null,
      entity_type: options.entityType || null,
      entity_id: options.entityId || null,
      priority: options.priority || 'normal',
      metadata: options.metadata || {},
      read: false,
    }));

    const { error } = await supabase
      .from('notifications')
      .insert(notifications);

    if (error) {
      console.error('[Notifications] Error creating:', error);
      return false;
    }

    console.log(`[Notifications] Created ${notifications.length} notification(s): ${options.title}`);
    return true;
  } catch (error) {
    console.error('[Notifications] Error:', error);
    return false;
  }
}

/**
 * Create a call notification
 */
export async function notifyCall({
  phone,
  customerName,
  serviceNeeded,
  isUrgent,
  customerId,
}: {
  phone: string;
  customerName?: string;
  serviceNeeded?: string;
  isUrgent?: boolean;
  customerId?: string | null;
}): Promise<boolean> {
  const formatPhone = (p: string) => {
    if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
    if (p.length === 11 && p[0] === '1') return `(${p.slice(1, 4)}) ${p.slice(4, 7)}-${p.slice(7)}`;
    return p;
  };

  return createNotification({
    type: 'call',
    title: isUrgent 
      ? `🚨 URGENT: ${customerName || formatPhone(phone)}`
      : `📞 New Call: ${customerName || formatPhone(phone)}`,
    message: serviceNeeded || 'Phone inquiry received',
    entityType: customerId ? 'customer' : undefined,
    entityId: customerId || undefined,
    priority: isUrgent ? 'urgent' : 'high',
    metadata: { phone, customerName, serviceNeeded },
  });
}

/**
 * Create a booking request notification
 */
export async function notifyBooking({
  customerName,
  serviceType,
  phone,
  requestId,
}: {
  customerName: string;
  serviceType: string;
  phone: string;
  requestId?: string;
}): Promise<boolean> {
  return createNotification({
    type: 'booking',
    title: `📅 New Booking: ${customerName}`,
    message: serviceType,
    entityType: 'booking_request',
    entityId: requestId,
    priority: 'high',
    metadata: { customerName, serviceType, phone },
  });
}
