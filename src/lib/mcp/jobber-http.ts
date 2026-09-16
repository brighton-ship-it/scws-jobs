/**
 * HTTP entry for the Jobber MCP gateway (auth + Streamable HTTP).
 */

import {
  authorizeJobberMcpRequest,
  jobberMcpUnauthorizedLog,
} from './jobber-auth.ts';
import { createJobberMcpDispatcher, jobberMcpHealthBody } from './jobber-tools.ts';
import { handleMcpMessages } from './protocol.ts';
import type { JobberDeps } from '../jobber/quotes.ts';

export const JOBBER_MCP_WWW_AUTHENTICATE =
  'Bearer realm="scws-jobber-mcp", error="invalid_token"';

export type JobberMcpHttpOptions = {
  env?: NodeJS.ProcessEnv;
  deps?: JobberDeps;
};

function unauthorizedResponse(reason: 'missing_secret' | 'missing_key' | 'unauthorized'): Response {
  jobberMcpUnauthorizedLog(reason);
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': JOBBER_MCP_WWW_AUTHENTICATE,
      'Cache-Control': 'no-store',
    },
  });
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function jobberMcpCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function handleJobberMcpOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: jobberMcpCorsHeaders(request),
  });
}

export function handleJobberMcpMethodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
    status: 405,
    headers: {
      Allow: 'GET, POST, OPTIONS',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleJobberMcpRequest(
  request: Request,
  options: JobberMcpHttpOptions = {}
): Promise<Response> {
  const env = options.env ?? process.env;
  const cors = jobberMcpCorsHeaders(request);
  const auth = authorizeJobberMcpRequest(request, env);
  if (!auth.ok) {
    const response = unauthorizedResponse(auth.reason);
    for (const [key, value] of Object.entries(cors)) {
      response.headers.set(key, value);
    }
    return response;
  }

  if (request.method === 'GET') {
    const accept = request.headers.get('accept') || '';
    if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
      return new Response(JSON.stringify({ error: 'SSE sessions are not used. POST JSON-RPC instead.' }), {
        status: 405,
        headers: {
          Allow: 'POST',
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...cors,
        },
      });
    }
    return jsonResponse(await jobberMcpHealthBody(auth.name, env), 200, cors);
  }

  if (request.method !== 'POST') {
    return handleJobberMcpMethodNotAllowed();
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      },
      400,
      cors
    );
  }

  const dispatcher = createJobberMcpDispatcher(options.deps);
  const result = await handleMcpMessages(payload, dispatcher);
  if (result === null) {
    return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store', ...cors } });
  }
  return jsonResponse(result, 200, {
    'MCP-Protocol-Version': '2025-03-26',
    ...cors,
  });
}
