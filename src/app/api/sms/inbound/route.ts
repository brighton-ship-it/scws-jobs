import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import twilio from 'twilio';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID?.trim();
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN?.trim();
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER?.trim() || '+17604408520';

// Lazy init OpenAI to avoid build errors
function getOpenAI() {
  const OpenAI = require('openai').default;
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const SARAH_SYSTEM_PROMPT = `You are Sarah, a friendly AI assistant for Southern California Well Service (SCWS), responding via text message.

YOUR JOB: Help customers and collect their info for a callback.

KEEP MESSAGES SHORT - this is SMS, not email. 2-3 sentences max per response.

CONVERSATION FLOW:
1. Greet warmly and ask how you can help
2. Understand their need (well drilling, pump repair, no water, etc.)
3. Get their NAME if they haven't given it
4. Get their SERVICE ADDRESS (street + city)
5. Confirm details and let them know someone will call back

RESPONSE GUIDELINES:
- Be warm but concise (SMS character limits)
- Use simple language
- If emergency (no water, flooding): "Our on-call tech will reach out ASAP"
- Normal hours (Mon-Fri 7am-4pm): "We'll call back within 2-4 hours"
- After hours: "We'll call first thing tomorrow morning"

SERVICES:
- Well Drilling: $15k-$50k+
- Pump Repair: $300-$3,000
- Pump Replacement: $2,500-$8,000

SERVICE AREAS: Ramona, Valley Center, Escondido, Poway, Julian, Fallbrook, Alpine, Lakeside, Anza, Temecula, Murrieta

When you have their name and address, end with something like:
"Got it! [Name] at [Address]. Someone will call you [timeframe]. Thanks for texting SCWS! 🙌"`;

// Store conversation history in memory (for session continuity)
// In production, you'd want to store this in the database
const conversationCache = new Map<string, { messages: any[], lastActivity: number }>();

// Clean old conversations (older than 1 hour)
function cleanOldConversations() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [phone, data] of conversationCache.entries()) {
    if (data.lastActivity < oneHourAgo) {
      conversationCache.delete(phone);
    }
  }
}

// Extract customer info from conversation
function extractCustomerInfo(messages: any[]): { name?: string; address?: string; issue?: string; isUrgent: boolean } {
  const fullConvo = messages.map(m => m.content).join(' ').toLowerCase();
  
  const isUrgent = /no water|out of water|flooding|emergency|contamination|sewage/i.test(fullConvo);
  
  // Try to find name (this is simplified - in production use NER)
  let name: string | undefined;
  const nameMatch = fullConvo.match(/(?:my name is|i'm|this is|i am)\s+([a-z]+(?:\s+[a-z]+)?)/i);
  if (nameMatch) name = nameMatch[1];
  
  // Try to find address
  let address: string | undefined;
  const addressMatch = fullConvo.match(/(\d+\s+[a-z\s]+(?:road|rd|street|st|ave|avenue|lane|ln|drive|dr|way|court|ct|circle|cir|boulevard|blvd)[,\s]*[a-z\s]*)/i);
  if (addressMatch) address = addressMatch[1];
  
  // Get the issue from first user message
  const userMessages = messages.filter(m => m.role === 'user');
  const issue = userMessages[0]?.content?.substring(0, 200);
  
  return { name, address, issue, isUrgent };
}

export async function POST(req: NextRequest) {
  try {
    // Parse Twilio webhook (form-urlencoded)
    const formData = await req.formData();
    const from = formData.get('From') as string; // Customer's phone
    const to = formData.get('To') as string; // Our Twilio number
    const body = formData.get('Body') as string; // Message content
    const messageSid = formData.get('MessageSid') as string;
    
    if (!from || !body) {
      return new NextResponse('Missing required fields', { status: 400 });
    }
    
    console.log(`[SMS Inbound] From: ${from}, Message: ${body}`);
    
    // Clean old conversations periodically
    cleanOldConversations();
    
    // Get or create conversation for this phone number
    let conversation = conversationCache.get(from);
    if (!conversation) {
      conversation = { messages: [], lastActivity: Date.now() };
      conversationCache.set(from, conversation);
    }
    conversation.lastActivity = Date.now();
    
    // Add user message to history
    conversation.messages.push({ role: 'user', content: body });
    
    // Build messages for OpenAI
    const openaiMessages = [
      { role: 'system', content: SARAH_SYSTEM_PROMPT },
      ...conversation.messages.slice(-10) // Last 10 messages for context
    ];
    
    // Get AI response
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: openaiMessages,
      max_tokens: 300,
      temperature: 0.7,
    });
    
    const aiResponse = completion.choices[0]?.message?.content || 
      "Thanks for reaching out! Please call us at (760) 440-8520 for assistance.";
    
    // Add AI response to history
    conversation.messages.push({ role: 'assistant', content: aiResponse });
    
    // Check if we've collected enough info to create a lead
    const customerInfo = extractCustomerInfo(conversation.messages);
    
    // Store the conversation in database
    const supabase = createServiceClient();
    
    // Log the SMS
    await supabase.from('sms_conversations').upsert({
      phone_number: from,
      messages: conversation.messages,
      customer_name: customerInfo.name,
      service_address: customerInfo.address,
      issue: customerInfo.issue,
      is_urgent: customerInfo.isUrgent,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'phone_number'
    });
    
    // If we have name and enough info, create a lead/callback request
    if (customerInfo.name && conversation.messages.length >= 4) {
      // Check if lead already exists for this phone
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', from.replace('+1', ''))
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .single();
      
      if (!existingLead) {
        await supabase.from('leads').insert({
          customer_name: customerInfo.name,
          phone: from.replace('+1', ''),
          address: customerInfo.address || '',
          city: '',
          service_type: customerInfo.issue || 'SMS Inquiry',
          notes: `SMS conversation:\n${conversation.messages.map(m => `${m.role}: ${m.content}`).join('\n')}`,
          lead_source: 'sms',
          lead_source_detail: 'ai-text-sarah',
          status: customerInfo.isUrgent ? 'urgent' : 'new',
        });
        console.log(`[SMS] Created lead for ${customerInfo.name} at ${from}`);
      }
    }
    
    // Send response via Twilio
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
      const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
      await client.messages.create({
        body: aiResponse,
        from: to, // Reply from the number they texted
        to: from,
      });
      console.log(`[SMS] Sent response to ${from}: ${aiResponse.substring(0, 50)}...`);
    }
    
    // Return TwiML response (empty - we already sent via API)
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
    
  } catch (error) {
    console.error('[SMS Inbound] Error:', error);
    // Return empty TwiML to avoid Twilio errors
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { headers: { 'Content-Type': 'text/xml' } }
    );
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'SMS AI Receptionist (Sarah)',
    activeConversations: conversationCache.size,
  });
}
