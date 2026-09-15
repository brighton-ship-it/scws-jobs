/**
 * Minimal Streamable HTTP MCP (JSON-RPC 2.0).
 *
 * Stateless: POST is request/response JSON. GET health is separate.
 * GET SSE streams and session DELETE are not used (405).
 *
 * Kept small so Next.js / Vercel is not coupled to the official SDK
 * (which has overwritten global Response in App Router).
 */

export const MCP_PROTOCOL_VERSION = '2025-03-26';
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = [
  '2025-06-18',
  '2025-03-26',
  '2024-11-05',
] as const;

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

export type McpServerInfo = {
  name: string;
  version: string;
};

export type McpDispatcher = {
  serverInfo: McpServerInfo;
  instructions?: string;
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
};

function isNotification(message: JsonRpcRequest): boolean {
  return message.id === undefined;
}

function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id, error };
}

function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === 'string' && (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)) {
    return requested;
  }
  return MCP_PROTOCOL_VERSION;
}

export async function handleMcpJsonRpc(
  message: JsonRpcRequest,
  dispatcher: McpDispatcher
): Promise<JsonRpcResponse | null> {
  const id = message.id === undefined ? null : message.id;

  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method) {
    if (isNotification(message)) return null;
    return errorResponse(id, JSONRPC_INVALID_REQUEST, 'Invalid JSON-RPC request');
  }

  const method = message.method;
  const params = asRecord(message.params);

  try {
    if (method === 'initialize') {
      if (isNotification(message)) return null;
      return resultResponse(id, {
        protocolVersion: negotiateProtocolVersion(params.protocolVersion),
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: dispatcher.serverInfo,
        instructions: dispatcher.instructions || undefined,
      });
    }

    if (method === 'notifications/initialized' || method === 'initialized') {
      return null;
    }

    if (method === 'ping') {
      if (isNotification(message)) return null;
      return resultResponse(id, {});
    }

    if (method === 'tools/list') {
      if (isNotification(message)) return null;
      return resultResponse(id, { tools: dispatcher.tools });
    }

    if (method === 'tools/call') {
      if (isNotification(message)) return null;
      const name = typeof params.name === 'string' ? params.name.trim() : '';
      if (!name) {
        return errorResponse(id, JSONRPC_INVALID_PARAMS, 'tools/call requires params.name');
      }
      const args = asRecord(params.arguments);
      const known = dispatcher.tools.some((tool) => tool.name === name);
      if (!known) {
        return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Unknown tool: ${name}`);
      }
      const toolResult = await dispatcher.callTool(name, args);
      return resultResponse(id, toolResult);
    }

    if (isNotification(message)) return null;
    return errorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
  } catch (error) {
    if (isNotification(message)) return null;
    const messageText = error instanceof Error ? error.message : 'Internal error';
    return errorResponse(id, JSONRPC_INTERNAL_ERROR, messageText);
  }
}

export async function handleMcpMessages(
  payload: unknown,
  dispatcher: McpDispatcher
): Promise<JsonRpcResponse[] | JsonRpcResponse | null> {
  if (Array.isArray(payload)) {
    if (!payload.length) {
      return errorResponse(null, JSONRPC_INVALID_REQUEST, 'Empty JSON-RPC batch');
    }
    const responses: JsonRpcResponse[] = [];
    for (const item of payload) {
      const response = await handleMcpJsonRpc(asRecord(item) as JsonRpcRequest, dispatcher);
      if (response) responses.push(response);
    }
    return responses.length ? responses : null;
  }

  if (!payload || typeof payload !== 'object') {
    return errorResponse(null, JSONRPC_PARSE_ERROR, 'Invalid JSON-RPC payload');
  }

  return handleMcpJsonRpc(payload as JsonRpcRequest, dispatcher);
}
