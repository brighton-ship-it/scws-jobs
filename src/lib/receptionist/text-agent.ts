/**
 * AI text conversation for replies to the missed-call text. Same booking tools as Mike
 * (lookupCustomer, checkServiceArea, checkSchedule, book_job) plus a hand-off to the office
 * (Liz). The model and tools are injected so this is testable and sends nothing itself.
 *
 * Code guards (not just prompt): book_job only with a startAt that a check_schedule result in
 * this same thread listed, at most one booking per thread, and every reply is capped and
 * scrubbed of prices other than the $200 service call, the $300 two-man rate, and the $100 drive surcharge.
 */

export type ThreadMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  at: string;
  name?: string;
};

export interface TextAgentTools {
  lookupCustomer(phone: string): Promise<unknown>;
  checkServiceArea(location: string): Promise<unknown>;
  checkSchedule(input: { phone: string; city: string; address: string }): Promise<unknown>;
  bookJob(input: { phone: string; name: string; address: string; city: string; startAt: string; notes: string }): Promise<unknown>;
  handOff(input: { phone: string; reason: string; urgent: boolean; summary: string }): Promise<unknown>;
}

export interface ChatModel {
  /** OpenAI-compatible chat.completions call. Returns the assistant message. */
  complete(input: { messages: any[]; tools: any[] }): Promise<{ content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }>;
}

export interface AgentResult {
  reply: string;
  thread: ThreadMessage[];
  booked: boolean;
  handedOff: boolean;
  urgent: boolean;
}

export const MAX_REPLY = 320;
const MAX_ROUNDS = 5;

export function textAgentSystemPrompt(now: Date, phone: string): string {
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(now);
  return `You are Mike, texting for Southern California Well Service (SCWS), a well pump and well service company with shops in Ramona and Anza serving San Diego, Riverside and San Bernardino counties. This person called us and the call ended before we could help, so we texted them and they replied.

Your job by text: find out what's going on, and get them booked for a two hundred dollar service call when it fits, or hand them to the office.

Rules:
- Texts are short: 1 to 2 sentences, under 300 characters, no lists, no emojis, no links.
- First tool call is lookup_customer with their number. If found, use their name and address on file (confirm it once). If not found, don't say so; just ask.
- Ask one thing at a time: the problem, then name, then street address and town of the well.
- For a service problem (no water, pump not working, low pressure, leak, tank, cycling, water quality) in the service area: call check_service_area with the town, then check_schedule. Offer the earliest listed slot (or two). Say "That's a $200 service call, which covers the first hour." If check_service_area includes a drive surcharge, still book and say the first visit adds that charge ($100 per hour of drive past 1 hour from the nearer shop). Wait for a clear yes before book_job, and pass that slot's startAt exactly.
- San Diego, Riverside, and San Bernardino counties are bookable, including Santa Ysabel, Quail Springs, and Mesa Grande. Do not hand those off for location and do not refuse because of drive time.
- Only offer times that check_schedule listed. Never invent a date, time or technician. Never say booked or confirmed until book_job returns booked: true; then confirm the day, window and tech exactly as returned and say "If anything changes, just call or text us."
- No water at all, livestock without water, flooding, sparks or burning smell: still offer the earliest slot, and also call hand_off_to_office with urgent true. For sparks or burning smell, tell them to turn off the pump breaker only if safe, and call 911 if anyone is in danger.
- Hand off (hand_off_to_office) and tell them the office will reach out when: they ask for a person, it's about a bill or invoice, a new well or drilling quote, a pump install or other project quote, a complaint, a cancellation or reschedule, they decline the slots, or you're unsure. Never discuss balances, payments or collections.
- Pricing: service call $200 for the first hour, then $200 an hour; two-man crew $300 an hour. When a tool result includes a drive surcharge, the first visit also adds that amount ($100 per hour of drive past 1 hour). Never give other prices, discounts or price matching.
- Hours: open 7 days a week, 7 AM to 5 PM Pacific. Don't give phone numbers unless asked.
- If they ask whether you're a person or AI, say you're SCWS's virtual assistant and offer to have the office reach out.
- Never say "you're not in our system". Never mention tools or systems.

Their number: ${phone}
Now (Pacific): ${when}`;
}

export const TEXT_AGENT_TOOLS = [
  { type: 'function', function: { name: 'lookup_customer', description: 'Find the texter in Jobber by phone. Returns name, address on file and recent jobs.', parameters: { type: 'object', properties: {}, required: [] } } },
  { type: 'function', function: { name: 'check_service_area', description: 'Check whether a town is bookable. San Diego, Riverside, and San Bernardino counties are bookable. A drive surcharge means still book and say the $100 per hour charge past 1 hour.', parameters: { type: 'object', properties: { town: { type: 'string' } }, required: ['town'] } } },
  { type: 'function', function: { name: 'check_schedule', description: 'Get real open service-call slots (openSlots with startAt) for the address. Call before offering any time.', parameters: { type: 'object', properties: { address: { type: 'string' }, town: { type: 'string' } }, required: ['address', 'town'] } } },
  { type: 'function', function: { name: 'book_job', description: 'Book the $200 service call into a slot the texter said yes to. startAt must be copied from check_schedule openSlots.', parameters: { type: 'object', properties: { name: { type: 'string' }, address: { type: 'string' }, town: { type: 'string' }, startAt: { type: 'string' }, problem: { type: 'string' } }, required: ['name', 'address', 'town', 'startAt', 'problem'] } } },
  { type: 'function', function: { name: 'hand_off_to_office', description: 'Send this conversation to the office (Liz) to follow up by phone or text.', parameters: { type: 'object', properties: { reason: { type: 'string' }, urgent: { type: 'boolean' }, summary: { type: 'string', description: 'Name, address, town, problem, what was offered.' } }, required: ['reason', 'urgent', 'summary'] } } },
];

function parseArgs(raw: string): Record<string, any> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function unwrap(value: unknown): any {
  return value && typeof value === 'object' && 'result' in (value as any) ? (value as any).result : value;
}

/** startAt values listed by any check_schedule result already in the thread. */
export function offeredStarts(thread: ThreadMessage[]): Set<string> {
  const out = new Set<string>();
  for (const m of thread) {
    if (m.role !== 'tool' || m.name !== 'check_schedule') continue;
    try {
      const r = JSON.parse(m.content);
      for (const s of [...(r?.openSlots || []), ...(r?.availableSlots || [])]) if (s?.startAt) out.add(String(s.startAt));
    } catch { /* ignore */ }
  }
  return out;
}

export function alreadyBooked(thread: ThreadMessage[]): boolean {
  return thread.some((m) => m.role === 'tool' && m.name === 'book_job' && /"booked"\s*:\s*true/.test(m.content));
}

/** Keep replies SMS-sized and free of any price except the service call rates. */
export function scrubReply(text: string): string {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\$\s?(\d[\d,]*)/g, (m, n) => (['100', '200', '300'].includes(String(n).replace(/,/g, '')) ? m : 'a price'));
  if (t.length > MAX_REPLY) {
    const cut = t.slice(0, MAX_REPLY);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    t = end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, MAX_REPLY - 1).trim()}…`;
  }
  return t;
}

export const FALLBACK_REPLY = "Thanks! I've passed this to our office and someone will reach out to you shortly.";

export async function runTextAgent(input: {
  phone: string;
  inbound: string;
  thread: ThreadMessage[];
  now: Date;
  model: ChatModel;
  tools: TextAgentTools;
}): Promise<AgentResult> {
  const nowIso = input.now.toISOString();
  const thread: ThreadMessage[] = [...input.thread, { role: 'user', content: input.inbound.slice(0, 1000), at: nowIso }];
  let booked = alreadyBooked(thread);
  let handedOff = false;
  let urgent = false;
  const messages: any[] = [{ role: 'system', content: textAgentSystemPrompt(input.now, input.phone) }];
  for (const m of thread.slice(-30)) {
    if (m.role === 'tool') messages.push({ role: 'system', content: `Earlier ${m.name} result: ${m.content.slice(0, 1500)}` });
    else messages.push({ role: m.role, content: m.content });
  }

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let msg;
    try {
      msg = await input.model.complete({ messages, tools: TEXT_AGENT_TOOLS });
    } catch {
      break;
    }
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const reply = scrubReply(msg.content || '');
      if (!reply) break;
      thread.push({ role: 'assistant', content: reply, at: nowIso });
      return { reply, thread, booked, handedOff, urgent };
    }
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
    for (const call of calls) {
      const args = parseArgs(call.function.arguments);
      let result: unknown;
      try {
        switch (call.function.name) {
          case 'lookup_customer':
            result = unwrap(await input.tools.lookupCustomer(input.phone));
            break;
          case 'check_service_area':
            result = unwrap(await input.tools.checkServiceArea(String(args.town || '')));
            break;
          case 'check_schedule':
            result = unwrap(await input.tools.checkSchedule({ phone: input.phone, city: String(args.town || ''), address: String(args.address || '') }));
            break;
          case 'book_job': {
            const startAt = String(args.startAt || '');
            if (booked) result = { booked: false, error: 'already_booked_in_this_thread' };
            else if (!offeredStarts(thread).has(startAt)) result = { booked: false, error: 'slot_not_offered: call check_schedule and offer a listed slot first' };
            else {
              result = unwrap(await input.tools.bookJob({
                phone: input.phone, name: String(args.name || ''), address: String(args.address || ''), city: String(args.town || ''),
                startAt, notes: `Booked by text (missed-call follow-up). ${String(args.problem || '').slice(0, 300)}`,
              }));
              if ((result as any)?.booked === true) booked = true;
            }
            break;
          }
          case 'hand_off_to_office':
            if (!handedOff) {
              result = unwrap(await input.tools.handOff({ phone: input.phone, reason: String(args.reason || ''), urgent: Boolean(args.urgent), summary: String(args.summary || '') }));
              handedOff = true;
              urgent = urgent || Boolean(args.urgent);
            } else result = { ok: true, note: 'already handed off' };
            break;
          default:
            result = { error: 'unknown tool' };
        }
      } catch (e) {
        result = { error: e instanceof Error ? e.message.slice(0, 200) : 'tool_failed' };
      }
      const content = JSON.stringify(result ?? {}).slice(0, 4000);
      thread.push({ role: 'tool', name: call.function.name, content, at: nowIso });
      messages.push({ role: 'tool', tool_call_id: call.id, content });
    }
  }
  // Model failed or looped: never leave the texter hanging; hand to the office once.
  if (!handedOff) {
    try {
      await input.tools.handOff({ phone: input.phone, reason: 'AI text could not finish', urgent: false, summary: input.inbound.slice(0, 300) });
      handedOff = true;
    } catch { /* office still gets the forwarded text */ }
  }
  thread.push({ role: 'assistant', content: FALLBACK_REPLY, at: nowIso });
  return { reply: FALLBACK_REPLY, thread, booked, handedOff, urgent };
}
