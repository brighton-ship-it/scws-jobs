import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { sendEmail, textToHtml } from '@/lib/messaging/email';
import {
  CHAT_OFFICE_EMAILS,
  buildLeadEmail,
  isUrgentMessage,
  priorHistory,
  shouldSendLeadEmail,
  type ChatTurn,
  type VisitorInfo,
} from '@/lib/chat/lead-email';

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

async function emailOfficeLead(options: {
  sessionId: string;
  visitorInfo?: VisitorInfo;
  history: ChatTurn[];
  userMessage: string;
  assistantReply: string;
  urgent: boolean;
}) {
  const { subject, text } = buildLeadEmail(options);
  const html = textToHtml(text);

  for (const email of CHAT_OFFICE_EMAILS) {
    const result = await sendEmail({
      to: email,
      subject,
      html,
      text,
    });
    console.log(`[Chat] Lead email to ${email}:`, result.success ? 'sent' : result.error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    const visitorInfo: VisitorInfo | undefined = body?.visitorInfo;
    const history = priorHistory(body?.history, message);

    if (!message || !sessionId) {
      return NextResponse.json(
        { error: 'Missing message or sessionId' },
        { status: 400, headers: corsHeaders }
      );
    }

    const openaiMessages: ChatTurn[] = [
      { role: 'system', content: SCWS_CONTEXT },
      ...history,
      { role: 'user', content: message },
    ];

    let aiResponse =
      "I'm sorry, I'm having trouble responding right now. Please call us at (760) 440-8520.";

    try {
      const completion = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        messages: openaiMessages,
        max_tokens: 500,
        temperature: 0.7,
      });
      aiResponse =
        completion.choices[0]?.message?.content || aiResponse;
    } catch (openaiError: unknown) {
      const err = openaiError as { message?: string };
      console.error('Chat OpenAI error:', err?.message || openaiError);
    }

    if (shouldSendLeadEmail(history, message)) {
      try {
        await emailOfficeLead({
          sessionId,
          visitorInfo,
          history,
          userMessage: message,
          assistantReply: aiResponse,
          urgent: isUrgentMessage(message),
        });
      } catch (emailError: unknown) {
        const err = emailError as { message?: string };
        console.error('Chat lead email error:', err?.message || emailError);
      }
    }

    return NextResponse.json({
      response: aiResponse,
      sessionId,
    }, { headers: corsHeaders });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('Chat API error:', err?.message || error);
    return NextResponse.json(
      {
        response: "I'm sorry, I'm having trouble right now. Please call us at (760) 440-8520 for immediate assistance.",
        error: 'Internal error',
      },
      { status: 500, headers: corsHeaders }
    );
  }
}

// History lives in the widget; this stays for CORS/preflight compatibility.
export async function GET() {
  return NextResponse.json({ messages: [] }, { headers: corsHeaders });
}
