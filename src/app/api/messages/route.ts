import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import twilio from 'twilio';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim();
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim();
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER?.trim();

/**
 * GET /api/messages - List all SMS conversations
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceClient();
    
    const { data: conversations, error } = await supabase
      .from('sms_conversations')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[Messages] Error fetching:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform to expected format
    const formatted = (conversations || []).map(conv => {
      const messages = conv.messages || [];
      const lastMsg = messages[messages.length - 1];
      const unreadCount = messages.filter((m: any) => m.role === 'user' && !m.read).length;
      
      return {
        id: conv.id,
        phone_number: conv.phone_number,
        customer_name: conv.customer_name || formatPhone(conv.phone_number),
        last_message: lastMsg?.content || '',
        last_message_at: conv.updated_at,
        last_message_direction: lastMsg?.role === 'user' ? 'inbound' : 'outbound',
        unread_count: unreadCount,
        messages: messages,
        is_urgent: conv.is_urgent,
        issue: conv.issue,
        service_address: conv.service_address,
      };
    });

    return NextResponse.json({ conversations: formatted });
  } catch (error) {
    console.error('[Messages] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/**
 * POST /api/messages - Send a new SMS
 */
export async function POST(request: NextRequest) {
  try {
    const { to, message, customer_name } = await request.json();

    if (!to || !message) {
      return NextResponse.json({ error: 'Missing to or message' }, { status: 400 });
    }

    // Format phone number
    let toNumber = to.replace(/\D/g, '');
    if (toNumber.length === 10) toNumber = '1' + toNumber;
    if (!toNumber.startsWith('+')) toNumber = '+' + toNumber;

    // Send via Twilio
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return NextResponse.json({ error: 'Twilio not configured' }, { status: 500 });
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const twilioMessage = await client.messages.create({
      body: message,
      from: TWILIO_FROM_NUMBER,
      to: toNumber,
    });

    // Log to database
    const supabase = createServiceClient();
    
    // Get or create conversation
    const { data: existing } = await supabase
      .from('sms_conversations')
      .select('*')
      .eq('phone_number', toNumber)
      .single();

    const messages = existing?.messages || [];
    messages.push({
      role: 'assistant',
      content: message,
      timestamp: new Date().toISOString(),
      sid: twilioMessage.sid,
    });

    await supabase.from('sms_conversations').upsert({
      phone_number: toNumber,
      customer_name: customer_name || existing?.customer_name,
      messages: messages,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'phone_number',
    });

    return NextResponse.json({
      ok: true,
      sid: twilioMessage.sid,
      status: twilioMessage.status,
    });
  } catch (error: any) {
    console.error('[Messages] Send error:', error);
    return NextResponse.json({ error: error.message || 'Failed to send' }, { status: 500 });
  }
}

function formatPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  if (clean.length === 11 && clean[0] === '1') {
    return `(${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `(${clean.slice(0, 3)}) ${clean.slice(3, 6)}-${clean.slice(6)}`;
  }
  return phone;
}
