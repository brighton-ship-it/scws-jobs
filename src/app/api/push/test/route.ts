import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // Dynamic import to avoid build-time VAPID configuration
    const { sendPushToAdmins } = await import('@/lib/push');
    
    const body = await request.json();
    const { title, message } = body;

    const sent = await sendPushToAdmins({
      title: title || '🔔 Test Notification',
      body: message || 'Push notifications are working!',
      url: '/notifications',
    });

    return NextResponse.json({ 
      success: true, 
      sent,
      message: sent > 0 ? `Sent to ${sent} device(s)` : 'No subscribed devices found'
    });
  } catch (error) {
    console.error('[Push Test] Error:', error);
    return NextResponse.json({ error: 'Failed to send test' }, { status: 500 });
  }
}
