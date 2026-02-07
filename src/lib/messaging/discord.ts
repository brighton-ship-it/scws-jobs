/**
 * Discord Webhook Notifications
 * Sends alerts to Discord for urgent events
 */

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

interface SendDiscordOptions {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

/**
 * Check if Discord webhook is configured
 */
export function isDiscordConfigured(): boolean {
  return !!DISCORD_WEBHOOK_URL;
}

/**
 * Send a message to Discord via webhook
 */
export async function sendDiscord(options: SendDiscordOptions): Promise<boolean> {
  if (!isDiscordConfigured()) {
    console.log('[Discord] Webhook not configured, skipping notification');
    return false;
  }

  try {
    const response = await fetch(DISCORD_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: options.username || 'SCWS Alerts',
        avatar_url: options.avatar_url,
        content: options.content,
        embeds: options.embeds,
      }),
    });

    if (!response.ok) {
      console.error('[Discord] Webhook failed:', response.status, await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Discord] Webhook error:', error);
    return false;
  }
}

/**
 * Send a call notification to Discord
 */
export async function notifyNewCall({
  phone,
  customerName,
  serviceNeeded,
  summary,
  isUrgent,
  customerId,
  isNewCustomer,
}: {
  phone: string;
  customerName?: string;
  serviceNeeded?: string;
  summary?: string;
  isUrgent?: boolean;
  customerId?: string | null;
  isNewCustomer?: boolean;
}): Promise<boolean> {
  const formatPhone = (p: string) => {
    if (p.length === 10) return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
    if (p.length === 11 && p[0] === '1') return `(${p.slice(1, 4)}) ${p.slice(4, 7)}-${p.slice(7)}`;
    return p;
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app';
  
  const embed: DiscordEmbed = {
    title: isUrgent ? '🚨 URGENT: New Call from Sarah' : '📞 New Call from Sarah',
    description: summary || 'New phone inquiry received',
    color: isUrgent ? 0xff0000 : 0x4e9271, // Red for urgent, SCWS green otherwise
    fields: [
      { name: '📱 Phone', value: formatPhone(phone), inline: true },
      { name: '👤 Customer', value: customerName || 'Unknown', inline: true },
    ],
    footer: { text: isNewCustomer ? '⚡ New Customer' : '✓ Existing Customer' },
    timestamp: new Date().toISOString(),
  };

  if (serviceNeeded) {
    embed.fields!.push({ name: '🔧 Service', value: serviceNeeded, inline: true });
  }

  if (customerId) {
    embed.fields!.push({ 
      name: '🔗 Link', 
      value: `[View Customer](${appUrl}/customers/${customerId})`,
      inline: false 
    });
  }

  return sendDiscord({
    content: isUrgent ? '<@300130744045535234> Urgent call!' : undefined, // Ping Brighton for urgent
    embeds: [embed],
    username: 'Sarah AI',
  });
}

/**
 * Send a booking request notification
 */
export async function notifyNewBooking({
  customerName,
  serviceType,
  phone,
  address,
  preferredDate,
}: {
  customerName: string;
  serviceType: string;
  phone: string;
  address?: string;
  preferredDate?: string;
}): Promise<boolean> {
  const formatPhone = (p: string) => {
    const clean = p.replace(/\D/g, '');
    if (clean.length === 10) return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
    return p;
  };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://scws-jobs.vercel.app';

  return sendDiscord({
    embeds: [{
      title: '📅 New Booking Request',
      color: 0x4e9271,
      fields: [
        { name: '👤 Customer', value: customerName, inline: true },
        { name: '🔧 Service', value: serviceType, inline: true },
        { name: '📱 Phone', value: formatPhone(phone), inline: true },
        ...(address ? [{ name: '📍 Address', value: address, inline: false }] : []),
        ...(preferredDate ? [{ name: '📆 Preferred Date', value: preferredDate, inline: true }] : []),
        { name: '🔗 Link', value: `[View Requests](${appUrl}/requests)`, inline: false },
      ],
      timestamp: new Date().toISOString(),
    }],
    username: 'SCWS Booking',
  });
}
