import { NextRequest } from 'next/server';
import {
  handleJobberMcpMethodNotAllowed,
  handleJobberMcpOptions,
  handleJobberMcpRequest,
} from '@/lib/mcp/jobber-http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/mcp/jobber — Streamable HTTP MCP (JSON-RPC).
 * GET  /api/mcp/jobber — auth + health (tools list + durableTokenStore).
 *
 * Auth: Authorization: Bearer <JOBBER_MCP_API_KEYS entry>
 * Jobber OAuth stays on this app (durable Supabase store). Draft quotes only.
 * Invoice tools are read-only (no send, create, or payment).
 */
export async function GET(request: NextRequest) {
  return handleJobberMcpRequest(request);
}

export async function POST(request: NextRequest) {
  return handleJobberMcpRequest(request);
}

export async function OPTIONS(request: NextRequest) {
  return handleJobberMcpOptions(request);
}

export async function DELETE() {
  return handleJobberMcpMethodNotAllowed();
}
