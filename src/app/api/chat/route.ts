import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import OpenAI from 'openai';

// CORS headers for cross-origin requests (widget on scwellservice.com)
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle preflight requests
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// Lazy initialization to avoid build-time errors
function getOpenAI() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// SCWS Business Context for the AI
const SCWS_CONTEXT = `You are Sarah, the friendly AI assistant for Southern California Well Service (SCWS).

ABOUT SCWS:
- Family-owned water well drilling and pump service company
- Serving San Diego, Riverside, and San Bernardino counties
- Services: Well drilling, pump repair/replacement, water testing, pressure tanks, well inspections
- Main office: 1077 Main St, Ramona, CA 92065
- Second location: Anza, CA
- Phone: (760) 440-8520
- Hours: Monday-Friday 7am-5pm, Emergency service available 24/7
- Website: www.scwellservice.com

YOUR ROLE:
- Answer questions about well services, pricing estimates, and scheduling
- Collect contact info (name, phone, address) for callbacks
- Be helpful, warm, and professional
- If someone has an emergency (no water, flooding), mark it URGENT
- For complex technical questions, offer to have a technician call back

PRICING GUIDANCE (estimates only, actual quotes require site visit):
- Service calls: $150-250 depending on location
- Pump replacement: $2,000-5,000+ depending on depth and pump type
- Well drilling: $15,000-50,000+ depending on depth and conditions
- Pressure tank replacement: $800-1,500

Always be helpful and try to convert inquiries into scheduled appointments or callbacks.`;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, visitorInfo } = await request.json();

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: 'Missing message or sessionId' },
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createServiceClient();

    // Get or create chat session
    let { data: session } = await supabase
      .from('chat_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single();

    if (!session) {
      // Create new session
      const { data: newSession, error: sessionError } = await supabase
        .from('chat_sessions')
        .insert({
          session_id: sessionId,
          visitor_name: visitorInfo?.name || null,
          visitor_email: visitorInfo?.email || null,
          visitor_phone: visitorInfo?.phone || null,
          visitor_ip: request.headers.get('x-forwarded-for')?.split(',')[0] || null,
          page_url: visitorInfo?.pageUrl || null,
          status: 'active',
        })
        .select()
        .single();

      if (sessionError) {
        console.error('Error creating session:', sessionError);
      }
      session = newSession;
    }

    // Get chat history for this session
    const { data: history } = await supabase
      .from('chat_messages')
      .select('role, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(20);

    // Build messages array for OpenAI
    const messages: ChatMessage[] = [
      { role: 'system', content: SCWS_CONTEXT },
      ...(history || []).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    // Store user message
    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      role: 'user',
      content: message,
    });

    // Get AI response
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0]?.message?.content || 
      "I'm sorry, I'm having trouble responding right now. Please call us at (760) 440-8520.";

    // Store AI response
    await supabase.from('chat_messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: aiResponse,
    });

    // Check for urgent keywords or lead info
    const isUrgent = /no water|emergency|flood|urgent/i.test(message);
    const hasContactInfo = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|@/.test(message);

    if (isUrgent || hasContactInfo) {
      // Update session with flags
      await supabase
        .from('chat_sessions')
        .update({
          is_urgent: isUrgent || undefined,
          has_contact_info: hasContactInfo || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('session_id', sessionId);

      // TODO: Send alert to Brighton for urgent/hot leads
    }

    return NextResponse.json({
      response: aiResponse,
      sessionId,
    }, { headers: corsHeaders });
  } catch (error: any) {
    console.error('Chat API error:', error?.message || error);
    return NextResponse.json(
      { 
        response: "I'm sorry, I'm having trouble right now. Please call us at (760) 440-8520 for immediate assistance.",
        error: 'Internal error',
        debug: error?.message || String(error)
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// GET endpoint to fetch chat history
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400, headers: corsHeaders });
  }

  const supabase = createServiceClient();
  
  const { data: messages, error } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500, headers: corsHeaders });
  }

  return NextResponse.json({ messages: messages || [] }, { headers: corsHeaders });
}
