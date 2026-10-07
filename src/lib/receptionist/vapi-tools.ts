/**
 * Vapi server-message tool calls.
 *
 * Current assistants post message.type "tool-calls" with toolCallList
 * (and a parallel toolWithToolCallList). Older assistants post
 * message.type "function-call" with functionCall.parameters.
 * arguments may be a JSON string or an object.
 */

export type ToolParams = Record<string, unknown>;

export type ToolInvocation = {
  id: string | null;
  name: string;
  params: ToolParams;
};

export type ParsedVapiTools =
  | { mode: 'function-call'; call: ToolInvocation }
  | { mode: 'tool-calls'; calls: ToolInvocation[] }
  | { mode: 'none' };

export type ExecutedTool = {
  id: string | null;
  body: { result: unknown };
};

export function parseToolArguments(raw: unknown): ToolParams {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as ToolParams;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ToolParams;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function invocationFromToolCall(toolCall: unknown, fallbackName?: string): ToolInvocation | null {
  if (!toolCall || typeof toolCall !== 'object') return null;
  const record = toolCall as Record<string, unknown>;
  const fn = record.function && typeof record.function === 'object'
    ? record.function as Record<string, unknown>
    : {};
  const name = (typeof fn.name === 'string' && fn.name)
    || (typeof record.name === 'string' && record.name)
    || fallbackName;
  if (!name) return null;
  const idRaw = record.id ?? record.toolCallId;
  return {
    id: idRaw == null || idRaw === '' ? null : String(idRaw),
    name,
    params: parseToolArguments(fn.arguments ?? record.arguments ?? fn.parameters ?? record.parameters),
  };
}

function dedupe(calls: ToolInvocation[]): ToolInvocation[] {
  const seen = new Set<string>();
  const unique: ToolInvocation[] = [];
  for (const call of calls) {
    if (call.id) {
      if (seen.has(call.id)) continue;
      seen.add(call.id);
    }
    unique.push(call);
  }
  return unique;
}

function extractToolCalls(message: Record<string, unknown>): ToolInvocation[] {
  const toolCallList = Array.isArray(message.toolCallList) ? message.toolCallList : [];
  const fromList = dedupe(
    toolCallList
      .map((item) => invocationFromToolCall(item))
      .filter((item): item is ToolInvocation => item != null),
  );
  if (fromList.length > 0) return fromList;

  const withList = Array.isArray(message.toolWithToolCallList) ? message.toolWithToolCallList : [];
  const fromWith = dedupe(
    withList
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const record = item as Record<string, unknown>;
        const wrapperFn = record.function && typeof record.function === 'object'
          ? record.function as Record<string, unknown>
          : {};
        const fallback = typeof wrapperFn.name === 'string'
          ? wrapperFn.name
          : typeof record.name === 'string'
            ? record.name
            : undefined;
        return invocationFromToolCall(record.toolCall, fallback);
      })
      .filter((item): item is ToolInvocation => item != null),
  );
  if (fromWith.length > 0) return fromWith;

  const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  return dedupe(
    toolCalls
      .map((item) => invocationFromToolCall(item))
      .filter((item): item is ToolInvocation => item != null),
  );
}

/** Vapi call id: message.call.id, then body.call.id. */
export function vapiCallId(body: unknown): string {
  const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = (root.message && typeof root.message === 'object' ? root.message : {}) as Record<string, unknown>;
  const messageCall = message.call && typeof message.call === 'object'
    ? message.call as Record<string, unknown>
    : null;
  const rootCall = root.call && typeof root.call === 'object'
    ? root.call as Record<string, unknown>
    : null;
  if (messageCall && typeof messageCall.id === 'string' && messageCall.id) return messageCall.id;
  if (rootCall && typeof rootCall.id === 'string' && rootCall.id) return rootCall.id;
  return '';
}

export function callCustomerPhone(body: unknown): string {
  const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = (root.message && typeof root.message === 'object' ? root.message : {}) as Record<string, unknown>;
  const call = (message.call && typeof message.call === 'object' ? message.call : root.call) as Record<string, unknown> | undefined;
  const customer = (call && call.customer && typeof call.customer === 'object'
    ? call.customer
    : message.customer && typeof message.customer === 'object'
      ? message.customer
      : root.customer && typeof root.customer === 'object'
        ? root.customer
        : {}) as Record<string, unknown>;
  return typeof customer.number === 'string' ? customer.number : '';
}

export function parseVapiServerTools(body: unknown): ParsedVapiTools {
  const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const message = (root.message && typeof root.message === 'object' ? root.message : {}) as Record<string, unknown>;
  const type = (typeof message.type === 'string' && message.type) || (typeof root.type === 'string' ? root.type : '');

  if (type === 'tool-calls') {
    const fromMessage = extractToolCalls(message);
    const messageHasList = Array.isArray(message.toolCallList)
      || Array.isArray(message.toolWithToolCallList)
      || Array.isArray(message.toolCalls);
    if (fromMessage.length > 0 || messageHasList) {
      return { mode: 'tool-calls', calls: fromMessage };
    }
    return { mode: 'tool-calls', calls: extractToolCalls(root) };
  }

  if (type === 'function-call' || message.functionCall || root.functionCall) {
    const functionCall = (message.functionCall && typeof message.functionCall === 'object'
      ? message.functionCall
      : root.functionCall && typeof root.functionCall === 'object'
        ? root.functionCall
        : {}) as Record<string, unknown>;
    const idRaw = functionCall.id ?? functionCall.toolCallId;
    return {
      mode: 'function-call',
      call: {
        id: idRaw == null || idRaw === '' ? null : String(idRaw),
        name: typeof functionCall.name === 'string' ? functionCall.name : '',
        params: parseToolArguments(functionCall.parameters ?? functionCall.arguments),
      },
    };
  }

  return { mode: 'none' };
}

function toolResultString(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result ?? { error: 'Failed to process request' });
}

/**
 * Legacy function-call responses stay `{ result }`.
 * tool-calls responses are `{ results: [{ toolCallId, result }] }`
 * with result as a string, which is what current Vapi assistants expect.
 */
export function vapiToolHttpBody(parsed: ParsedVapiTools, executed: ExecutedTool[]): Record<string, unknown> {
  if (parsed.mode === 'tool-calls') {
    return {
      results: executed.map((item) => ({
        toolCallId: item.id || '',
        result: toolResultString(item.body?.result),
      })),
    };
  }

  return executed[0]?.body ?? { result: { error: 'Unknown function' } };
}
