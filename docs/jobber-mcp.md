# Shared Jobber MCP gateway

Remote Streamable HTTP MCP on this Next.js app so shop bots (Travis, Damien, Brighton / Grok Bot / Cursor) can look up Jobber clients and **draft quotes** without holding Jobber OAuth secrets on their machines.

**Endpoint:** `https://scws-jobs.vercel.app/api/mcp/jobber`  
**Transport:** Streamable HTTP (JSON-RPC `POST`). Stateless — no SSE session.  
**Auth:** `Authorization: Bearer <named MCP key>` from `JOBBER_MCP_API_KEYS`.  
**Jobber OAuth:** stays on this app (`JOBBER_ACCESS_TOKEN`, `JOBBER_REFRESH_TOKEN`, `JOBBER_CLIENT_ID`, `JOBBER_CLIENT_SECRET`). The refresh path in `src/lib/jobber/auth.ts` persists rotated tokens to Supabase `settings.jobber_oauth` so a cold lambda does not replay a stale Vercel `JOBBER_REFRESH_TOKEN`.

## Safety (v1)

This gateway is **draft-only**.

| Allowed | Not in v1 — do not add |
| --- | --- |
| Search / get clients | Send quote to customer |
| Search / get quotes | Approve / convert quote |
| Create unsent quote draft | Delete quote |
| Update unsent draft (title, message, add lines) | Payroll |
| Search products for line names / street list | Invoice send, visits, anything that emails the customer |

`create_quote_draft` and `update_quote_draft` never set `transitionQuoteTo` or `sentAt`. Customer-facing title/message must not contain GP FLAG math. Internal notes may.

If Jobber already sent the quote, `update_quote_draft` refuses.

## Env vars

Set these on the Vercel project **scws-jobs** (Production). Do not commit values.

| Name | Role |
| --- | --- |
| `JOBBER_MCP_API_KEYS` | Named bearer keys for bots. JSON map or CSV. |
| `JOBBER_ACCESS_TOKEN` | Shop Jobber GraphQL (already used by cron / Sarah / quote drafts) |
| `JOBBER_REFRESH_TOKEN` | OAuth refresh (bootstrap / fallback). Rotated values are also written to Supabase `settings.jobber_oauth`. |
| `JOBBER_TOKEN_ENCRYPTION_KEY` | Optional. AES key material for `jobber_oauth`. Defaults to `JOBBER_CLIENT_SECRET`. |
| `JOBBER_CLIENT_ID` | OAuth client |
| `JOBBER_CLIENT_SECRET` | OAuth client secret |
| `JOBBER_GRAPHQL_VERSION` | Optional. Defaults to `2025-04-16` |
| `JOBBER_SALESPERSON_ID` | Optional. Drafts default to a Jobber user named Brighton |

### `JOBBER_MCP_API_KEYS` formats

JSON map (preferred):

```bash
JOBBER_MCP_API_KEYS={"travis":"<openssl rand -hex 32>","damien":"<openssl rand -hex 32>","brighton":"<openssl rand -hex 32>"}
```

Named CSV:

```bash
JOBBER_MCP_API_KEYS=travis:<key>,damien:<key>,brighton:<key>
```

Generate a key:

```bash
openssl rand -hex 32
```

Missing or invalid keys → **401**. If the env var is unset, every request is 401 (the route is never open).

Vercel Authentication (SSO) on this project must stay **Preview only**. SSO on `*.vercel.app` will 401 cookie-less MCP clients the same way it 401s cron.

## Tools

- `search_clients` — name / phone / email / address
- `get_client` — one client + properties + recent quotes
- `search_quotes` — number / title / client / address, optional status
- `get_quote` — one quote + line items
- `create_quote_draft` — unsent draft only
- `update_quote_draft` — unsent draft only
- `search_products` — catalog name + default street price (not internal cost)

## Brighton: connect Travis / Damien in Grok Bot

Grok Bot only accepts **remote** Streamable HTTP MCP (not local stdio). Each person gets their own named key. Jobber tokens never go on their laptop.

1. In Vercel → scws-jobs → Settings → Environment Variables, set `JOBBER_MCP_API_KEYS` (Production) with a unique key per person. Redeploy if you just added the var.
2. In Grok Bot, add a **custom MCP server** (chat: “add a custom MCP server” — not a marketplace plugin):
   - **Name:** `scws-jobber` (or `Jobber drafts`)
   - **URL:** `https://scws-jobs.vercel.app/api/mcp/jobber`
   - **Transport:** Streamable HTTP (if the UI only says HTTP/SSE, still use this URL)
   - **Header:** `Authorization` = `Bearer <that person's key>`
   - Tell the bot this is a **static API key**, not OAuth. Do not start an OAuth connect card.
3. Confirm tools load: `search_clients`, `create_quote_draft`, etc.
4. Cursor MCP (`~/.cursor/mcp.json`) is the same URL + header:

```json
{
  "mcpServers": {
    "scws-jobber": {
      "url": "https://scws-jobs.vercel.app/api/mcp/jobber",
      "headers": {
        "Authorization": "Bearer <THEIR_KEY>"
      }
    }
  }
}
```

xAI / `grok mcp` CLI:

```bash
grok mcp add --transport http scws-jobber \
  https://scws-jobs.vercel.app/api/mcp/jobber \
  --header "Authorization: Bearer ${TRAVIS_JOBBER_MCP_KEY}"
```

Rotate a person's key by editing the JSON map and redeploying. Do not reuse Jobber OAuth tokens as MCP keys.

## curl health / auth check

Replace the host if Production uses another URL (`NEXT_PUBLIC_APP_URL`).

```bash
# Health — must be 200 and list tools. authenticatedAs is the key name, not the secret.
curl -sS -D - \
  -H "Authorization: Bearer $JOBBER_MCP_KEY" \
  https://scws-jobs.vercel.app/api/mcp/jobber

# Missing key — must be 401
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://scws-jobs.vercel.app/api/mcp/jobber

# Wrong key — must be 401
curl -sS -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer wrong" \
  https://scws-jobs.vercel.app/api/mcp/jobber

# MCP initialize (Streamable HTTP JSON-RPC)
curl -sS \
  -H "Authorization: Bearer $JOBBER_MCP_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' \
  https://scws-jobs.vercel.app/api/mcp/jobber

# tools/list
curl -sS \
  -H "Authorization: Bearer $JOBBER_MCP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  https://scws-jobs.vercel.app/api/mcp/jobber
```

## Code map

| File | Role |
| --- | --- |
| `src/app/api/mcp/jobber/route.ts` | Next.js route |
| `src/lib/mcp/jobber-http.ts` | Auth + Streamable HTTP |
| `src/lib/mcp/jobber-auth.ts` | Named API keys |
| `src/lib/mcp/jobber-tools.ts` | Tool list + handlers |
| `src/lib/jobber/mcp-quotes.ts` | get/search/update draft helpers |
| `src/lib/jobber/quotes.ts` | Existing client search + unsent create |
| `src/lib/jobber/auth.ts` / `token-store.ts` / `client.ts` | OAuth refresh, durable `jobber_oauth` persist, GraphQL |
