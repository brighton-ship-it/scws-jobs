# Shared Jobber MCP gateway

Remote Streamable HTTP MCP on this Next.js app so shop bots (Travis, Damien, Brighton / Grok Bot / Cursor) can look up Jobber clients, **draft quotes**, **read and edit invoices** (line items and tax, never send), **read jobs and close them**, and **read completed jobs with photo URLs** (GBP posts and photo backfill) without holding Jobber OAuth secrets on their machines.

**Endpoint:** `https://scws-jobs.vercel.app/api/mcp/jobber`  
**Transport:** Streamable HTTP (JSON-RPC `POST`). Stateless — no SSE session.  
**Auth:** `Authorization: Bearer <named MCP key>` from `JOBBER_MCP_API_KEYS`.  
**Jobber OAuth:** stays on this app. `JOBBER_ACCESS_TOKEN` / `JOBBER_REFRESH_TOKEN` seed Supabase `settings.jobber_oauth` once, only when that row is empty. After that, the row is the only refresh writer. A failed durable read is an error, not permission to refresh the env pair. See `docs/JOBBER_OAUTH.md`. Do not refresh Jobber from a box or laptop script.

## Safety

Quote writes and new invoices are **unsent**. Nothing in this gateway emails or texts a client. `invoiceMarkAsSent` is not exposed (it does not email, and it still is not called). `jobComplete` is not in Jobber's API; closing is `close_job`.

| Allowed | Not exposed |
| --- | --- |
| Search / get clients | Send quote to customer |
| Search / get quotes | Approve / convert quote |
| Create unsent quote draft | Delete quote |
| Update unsent draft (title, message, optional/recommended lines, taxRateId) | Payroll |
| Search products for line names / street list | Invoice send, mark-sent, or record payment |
| List tax rates (id, name, label, rate, default) | Changing the tax-rate catalog |
| Search / get invoices | Per-invoice card, ACH, or partial-payment toggles (rejected; not sent) |
| Set an invoice tax rate (`edit_invoice` / `taxRateId`) | Invoice line add, update, or remove (not on InvoiceEditInput) |
| Create unsent invoice draft from a job | Job create, update, or send |
| Search / get jobs (completed window + photo URLs) | `jobComplete` (removed) |
| Close a job (`jobClose` + incomplete-visit decision) | Visits, anything that emails the customer |

`create_quote_draft` and `update_quote_draft` never set `transitionQuoteTo` or `sentAt`. Customer-facing title/message must not contain GP FLAG math. Internal notes may.

If Jobber already sent the quote, `update_quote_draft` refuses.

`create_invoice_draft` never sets `issuedDate` and never calls `invoiceMarkAsSent`. `edit_invoice` sets `taxRateId` only. It rejects `addLineItems`, `updateLineItems`, and `removeLineItemIds` (live Jobber error: `lineItemsToEdit` is not defined on `InvoiceEditInput`; the 2025-01-20 public schema has no invoice line-item mutations). It also rejects `allowCardPayments`, `allowAchPayments` / `allowBankPayments`, and `allowPartialPayments`.

## Env vars

Set these on the Vercel project **scws-jobs** (Production). Do not commit values.

| Name | Role |
| --- | --- |
| `JOBBER_MCP_API_KEYS` | Named bearer keys for bots. JSON map or CSV. |
| `JOBBER_ACCESS_TOKEN` | Bootstrap GraphQL token. After the first durable read/refresh, Supabase wins. |
| `JOBBER_REFRESH_TOKEN` | Bootstrap OAuth refresh. Used only when `settings.jobber_oauth` is empty. |
| `JOBBER_TOKEN_ENCRYPTION_KEY` | **Required in Production.** AES-256-GCM key material for `jobber_oauth`. Generate with `openssl rand -hex 32`. Do not commit. Do not rotate after tokens are stored (or re-OAuth). |
| `JOBBER_CLIENT_ID` | OAuth client |
| `JOBBER_CLIENT_SECRET` | OAuth client secret. Local/dev may fall back to this for encryption; Production will not. |
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

MCP server version **1.4.0** (`JOBBER_MCP_SERVER_VERSION`). GraphQL version stays `2025-04-16`.

- `search_clients` — name / phone / email / address
- `get_client` — one client + properties + recent quotes
- `search_quotes` — number / title / client / address, optional status
- `get_quote` — one quote + line items. Each line includes `optional` and `recommended`
- `create_quote_draft` — unsent draft only. Each line may set `optional`, `recommended`, and `productOrServiceId`. `taxRateId` comes from `list_tax_rates`
- `update_quote_draft` — unsent draft only. `addLineItems` accepts the same line fields. `taxRateId` sets the quote tax rate
- `list_tax_rates` — read-only. Optional `query` filters name, label, or description (for example `San Diego` or `7.75`). Returns `id`, `name`, `label`, `rate`, `default`. Pass `id` as `taxRateId` on a quote draft, `edit_invoice`, or `create_invoice_draft`
- `search_products` — catalog match on name or description. Returns `id`, `name`, `description`, `defaultUnitCost` (street list, not internal cost), `taxable`, `category`. Queries `products(searchTerm, first, after)`. A GraphQL error is returned to the caller. If Jobber search succeeds with no rows, the catalog is paged and filtered locally (`matchedBy: "catalog"`)
- `search_invoices` — invoice number / client name / status. Optional `unpaid` (balance > 0), `overdue`, `issuedBefore`. Page with `first` / `after` (`pageInfo.endCursor`)
- `get_invoice` — one invoice by encoded id or invoice number: client, emails, total, balance, issued/due dates, status, client-hub payment link, optional line summary
- `edit_invoice` — sets `taxRateId` from `list_tax_rates` via `invoiceEdit`. `addLineItems`, `updateLineItems`, and `removeLineItemIds` are rejected. Does not send
- `create_invoice_draft` — unsent invoice from a job (`jobId` or `jobNumber`). Copies job lines when `lineItems` is omitted
- `search_jobs` — job number / title / client / city. `completedAfter` (ISO) is the GBP daily window; optional `completedBefore` and status (`completed` means `completedAt` is set). Page with `first` / `after`. Each job includes client first name, property city, and a short list of https photo URLs
- `get_job` — one job by encoded id or job number: same fields plus the full https photo list for GBP media
- `close_job` — `jobClose`. Required `incompleteVisits`: `COMPLETE_PAST_DESTROY_FUTURE` or `DESTROY_ALL`

## Brighton: connect Travis / Damien in Grok Bot

Grok Bot only accepts **remote** Streamable HTTP MCP (not local stdio). Each person gets their own named key. Jobber tokens never go on their laptop.

1. In Vercel → scws-jobs → Settings → Environment Variables, set `JOBBER_MCP_API_KEYS` (Production) with a unique key per person. Redeploy if you just added the var.
2. In Grok Bot, add a **custom MCP server** (chat: “add a custom MCP server” — not a marketplace plugin):
   - **Name:** `scws-jobber` (or `Jobber drafts`)
   - **URL:** `https://scws-jobs.vercel.app/api/mcp/jobber`
   - **Transport:** Streamable HTTP (if the UI only says HTTP/SSE, still use this URL)
   - **Header:** `Authorization` = `Bearer <that person's key>`
   - Tell the bot this is a **static API key**, not OAuth. Do not start an OAuth connect card.
3. Confirm tools load: `search_clients`, `create_quote_draft`, `list_tax_rates`, `search_products`, `search_invoices`, `get_invoice`, `search_jobs`, `get_job`, etc.
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

## Durable token store (required in Production)

Jobber invalidates the previous refresh token on every successful refresh. Vercel env vars are a snapshot from the last deploy — they do not update when a lambda rotates tokens. Without a durable write, the next cold start replays the stale `JOBBER_REFRESH_TOKEN` and Jobber returns 401 until a human re-OAuths.

**Brighton / Jarvis — set this once on Vercel project scws-jobs → Production, then redeploy:**

```bash
openssl rand -hex 32
```

Name: `JOBBER_TOKEN_ENCRYPTION_KEY`. Paste the hex. Do not commit it. Do not reuse `JOBBER_CLIENT_SECRET`.

Also confirm Production already has `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_KEY`, and that `supabase/migrations/20260922_jobber_oauth_single_writer.sql` has been run in the Supabase SQL Editor (creates `public.settings` if needed, hides `jobber_oauth` from CRM settings reads, and installs the single-writer lock). `node scripts/verify-jobber-settings.js` exits 2 when the table is missing.

After deploy:

1. `GET /api/jobber/oauth-health` with `Authorization: Bearer $JOBBER_MCP_KEY` (or `CRON_SECRET`) must be **200** with `encryptionKeyConfigured: true`, `supabaseConfigured: true`, `reachable: true`, `settingsTable: "present"`. `authMode` is `durable` once the row has tokens, or `env_bootstrap` while the row is still empty. `expiresAt` is the access-token expiry. The body never includes tokens.
2. The first Production refresh, only when the row is empty, seeds env tokens into `settings.jobber_oauth`. Later cold starts load that row and do not send the env refresh token to Jobber.
3. If health is **503** with `encryptionKeyConfigured: false`, the key is not on that deployment — set it and redeploy. If `settingsTable` is `missing` or `loadError` is set, apply the SQL. That is not a Jobber 401, and the app will not refresh env tokens to paper over it.

`GET /api/mcp/jobber` includes the same `durableTokenStore` object (no secrets).

## curl health / auth check

Replace the host if Production uses another URL (`NEXT_PUBLIC_APP_URL`).

```bash
# Health — must be 200 and list tools. authenticatedAs is the key name, not the secret.
# durableTokenStore reports encryption key + Supabase reachability (no secrets).
curl -sS -D - \
  -H "Authorization: Bearer $JOBBER_MCP_KEY" \
  https://scws-jobs.vercel.app/api/mcp/jobber

# Durable store diagnostic — 200 when key is set and Supabase is reachable.
curl -sS -D - \
  -H "Authorization: Bearer $JOBBER_MCP_KEY" \
  https://scws-jobs.vercel.app/api/jobber/oauth-health

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
| `src/lib/jobber/products.ts` | product catalog search (`products`, not `productsAndServices`) + local name/description fallback |
| `src/lib/jobber/mcp-quotes.ts` | get/search/update draft helpers |
| `src/lib/jobber/mcp-invoices.ts` | read-only invoice search / get |
| `src/lib/jobber/mcp-invoice-writes.ts` | invoice line/tax edit and unsent create-from-job |
| `src/lib/jobber/mcp-jobs.ts` | read-only job search / get, including photo URLs |
| `src/lib/jobber/mcp-job-writes.ts` | `jobClose` only |
| `src/lib/jobber/quotes.ts` | Client search, unsent quote create, and `listTaxRates` |
| `src/lib/jobber/tax.ts` | Tax-rate summary (`id`, `name`, `label`, `rate`, `default`) and query filter |
| `src/lib/jobber/auth.ts` / `token-store.ts` / `client.ts` | OAuth refresh, durable `jobber_oauth` persist, GraphQL |
| `src/app/api/jobber/oauth-health/route.ts` | Secret-free durable-store diagnostic |
