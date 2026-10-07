# Shared Jobber MCP gateway

Remote Streamable HTTP MCP on this Next.js app so shop bots (Travis, Damien, Brighton / Grok Bot / Cursor) can look up Jobber clients, **create clients and properties**, **create requests and schedule on-site assessments**, **create one-off jobs and visits**, **add notes**, **draft quotes**, **read invoices and edit tax plus Client Hub payment settings** (never send, and never edit line items), **read jobs and close them**, **read completed jobs with photo URLs** (GBP posts and photo backfill), and **read catalog cost/price and edit one product's cost, price, markup, or visibility** (never delete) without holding Jobber OAuth secrets on their machines.

**Endpoint:** `https://scws-jobs.vercel.app/api/mcp/jobber`  
**Transport:** Streamable HTTP (JSON-RPC `POST`). Stateless — no SSE session.  
**Auth:** `Authorization: Bearer <named MCP key>` from `JOBBER_MCP_API_KEYS`.  
**Jobber OAuth:** stays on this app. `JOBBER_ACCESS_TOKEN` / `JOBBER_REFRESH_TOKEN` seed Supabase `settings.jobber_oauth` once, only when that row is empty. After that, the row is the only refresh writer. A failed durable read is an error, not permission to refresh the env pair. See `docs/JOBBER_OAUTH.md`. Do not refresh Jobber from a box or laptop script.

## Safety

Quote writes and new invoices are **unsent**. Nothing in this gateway emails, texts, or notifies a client. Notify, reminder, review-request, and booking-confirmation flags are forced off and are not tool arguments. `invoiceMarkAsSent` is not exposed (it does not email, and it still is not called). `jobComplete` is not in Jobber's API; closing is `close_job`.

| Allowed | Not exposed |
| --- | --- |
| Search / get / create clients (deduped by email or full name) | Send quote to customer |
| Add a property to a client | Approve / convert quote |
| List users (ids for assignment) | Delete quote |
| Search / get quotes | Payroll |
| Create unsent quote draft | Invoice send, mark-sent, or record payment |
| Update unsent draft (title, message, optional/recommended lines, taxRateId, salesperson) | Changing the tax-rate catalog |
| Search products for line names / street list | Record or collect a payment |
| Read product cost, street price, markup, and visible (`get_products`) | Delete a product, or edit name, description, tax, or category |
| Edit one product's cost, price, markup, or visibility (`edit_product`, optional `dryRun`) | Any product field outside that allow-list |
| List tax rates (id, name, label, rate, default) | Invoice line add, update, or remove |
| Search / get invoices | `jobComplete` (removed) |
| Set an invoice tax rate and Client Hub card, ACH, and partial-payment settings | Job update or send |
| Create unsent invoice draft from a job | Visit complete, or any client email / text / booking confirmation |
| Search / get jobs (completed window + photo URLs) | Assessment title (not on `AssessmentCreateInput`) |
| Create a one-off job and schedule a visit | A visit datetime on `jobCreate` (use `visitCreate`) |
| Search / get requests | Request form answers (`requestDetails` is a form, not notes) |
| Create a request and schedule its assessment | A product id stored on a job line |
| Add a note on a client, request, job, or quote | Generic `noteCreate` (use the per-object CreateNote mutation) |
| Close a job (`jobClose` + incomplete-visit decision) | Client email, text, or booking confirmation |

`create_quote_draft` and `update_quote_draft` never set `transitionQuoteTo` or `sentAt`. Customer-facing title/message must not contain GP FLAG math. Internal notes may.

If Jobber already sent the quote, `update_quote_draft` refuses.

`create_invoice_draft` never sets `issuedDate` and never calls `invoiceMarkAsSent`. `edit_invoice` sets `taxRateId` and optional Client Hub settings: `allowCardPayments` → `allowClientHubCreditCardPayments`, `allowAchPayments` → `allowClientHubAchPayments`, `allowPartialPayments` → `allowPartialPayments`. Those are settings, not a charge. It rejects `addLineItems`, `updateLineItems`, and `removeLineItemIds` with: Jobber's API cannot edit invoice line items; use the Jobber web UI. It still refuses send, mark-sent, record, and collect.

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
| `JOBBER_SALESPERSON_ID` | Optional override. Drafts otherwise use the Jobber user named Brighton (`info@scwellservice.com`), then Brighton's known user id if that lookup fails. |

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

MCP server version **1.7.0** (`JOBBER_MCP_SERVER_VERSION`). GraphQL version stays `2025-04-16`. Field names were checked against the public Jobber introspection captured at API version **2025-01-20** (`hightreequency/jobberschema`) and the [2025-04-16 changelog](https://developer.getjobber.com/docs/changelog/). That changelog does not change the argument names these tools send (`jobFormIds` and `customFields` type changes are unused). A newer API version is not required. This repo does not introspect production with the OAuth token.

- `search_clients` — name / phone / email / address. Enough to find a client before `create_client`, `create_request`, or `create_job`
- `get_client` — one client + properties + recent quotes
- `create_client` — `clientCreate`. firstName, lastName, optional companyName, emails, phones, billingAddress, and an initial property. Same email or full name returns the matches and does not create unless `force=true`. `receivesReminders`, follow-up flags, and `smsAllowed` are false
- `create_property` — `propertyCreate`. `PropertyCreateInput.properties[].address` (street1, city, province, postalCode, country default `US`)
- `list_users` — team members (`id`, name, email, status) so assignee ids can be chosen by name, for example Brighton Scala
- `search_quotes` — number / title / client / address, optional status. Each quote includes `salesperson` (`id`, `name`)
- `get_quote` — one quote + line items + salesperson (`id`, `name`). Each line includes `optional` and `recommended`
- `create_quote_draft` — unsent draft only. Each line may set `optional`, `recommended`, and `productOrServiceId`. `taxRateId` comes from `list_tax_rates`. `salespersonId` defaults to Brighton Scala
- `update_quote_draft` — unsent draft only. `addLineItems` accepts the same line fields. `taxRateId` sets the quote tax rate. `salespersonId` is sent on `quoteEdit` (the only quote mutation with that field). The tool re-reads `Quote.salesperson` and errors if Jobber left the previous salesperson in place
- `list_tax_rates` — read-only. Optional `query` filters name, label, or description (for example `San Diego` or `7.75`). Returns `id`, `name`, `label`, `rate`, `default`. Pass `id` as `taxRateId` on a quote draft, `edit_invoice`, or `create_invoice_draft`
- `search_products` — catalog match on name or description. Returns `id`, `name`, `description`, `defaultUnitCost` (street list, not internal cost), `taxable`, `category`. Queries `products(searchTerm, first, after)`. A GraphQL error is returned to the caller. If Jobber search succeeds with no rows, the catalog is paged and filtered locally (`matchedBy: "catalog"`). Cost, markup, and visibility are on `get_products`
- `get_products` — read by one or more ids (`product(id)`, max 25) or one search page (`products(searchTerm, first, after)`). `first` is always sent (default 25, max 50) so the page stays near 900 points, under Jobber's 10,000-point cap. Returns `id`, `name`, `description`, `category`, `unitPrice` (the same number as `defaultUnitCost`; ProductOrService has no `unitPrice` field), `defaultUnitCost`, `internalUnitCost`, `markup`, `taxable`, `visible`, and `archived` (true when `visible` is false; Jobber has no archived field), plus duration, booking, and quantity range. `customFields` and `lastJobLineItem` are omitted. A Throttled response backs off and retries. A query that costs more than the maximum does not retry
- `edit_product` — `productsAndServicesEdit` for **one** product. Allowed arguments: `internalUnitCost`, `unitPrice` (sent as `defaultUnitCost`), `markup`, `visible`. Every other field is rejected, including `name`, `description`, `taxable`, `category`, `defaultUnitCost`, and `delete`. Reads the row first, then re-reads after a successful write, and returns `before` and `after`. `dryRun: true` returns the projected `after` and does not call the mutation. `userErrors` come back on the tool error with `before` so the caller can log and revert. Passing the `before` cost, price, markup, and visible values into another `edit_product` reverts a write. Nothing deletes a product
- `search_invoices` — invoice number / client name / status. Optional `unpaid` (balance > 0), `overdue`, `issuedBefore`. Page with `first` / `after` (`pageInfo.endCursor`)
- `get_invoice` — one invoice by encoded id or invoice number: client, emails, total, balance, issued/due dates, status, client-hub payment link, optional line summary
- `edit_invoice` — `taxRateId` from `list_tax_rates`, plus optional `allowCardPayments`, `allowAchPayments`, and `allowPartialPayments` (Client Hub settings on `InvoiceEditInput`). Line-item arguments are rejected. Does not send, mark sent, record, or collect
- `create_invoice_draft` — unsent invoice from a job (`jobId` or `jobNumber`). Copies job lines when `lineItems` is omitted. Returns invoice number, Jobber URL, and totals. Invoice lines do not send `saveToProductsAndServices` (`InvoiceCreationLineItemInput` does not define it). Quote create lines and job create lines still send that field, because their input types require it. Quote line edits go through `quoteCreateLineItems` (`QuoteCreateLineItemAttributes`), not `quoteEditLineItems`
- `search_jobs` — job number / title / client / city. `completedAfter` (ISO) is the GBP daily window; optional `completedBefore` and status (`completed` means `completedAt` is set). Page with `first` / `after`. Each job includes client first name, property city, and a short list of https photo URLs. A query without the completed window still finds a job to schedule
- `get_job` — one job by encoded id or job number: same fields plus the full https photo list for GBP media
- `close_job` — `jobClose`. Required `incompleteVisits`: `COMPLETE_PAST_DESTROY_FUTURE` or `DESTROY_ALL`
- `create_job` — `jobCreate` for a one-off job (`clientId`, `propertyId` unless the client has one property, `title`, optional `instructions` and `lineItems`). `scheduling` is `{ createVisits: false, notifyTeam: false }`. `invoicing` is fixed price on completion. `allowReviewRequest` is false. Recurrence is omitted, which is the one-off job (`jobType` is not an input). Optional `startAt` / `endAt` / `assigneeIds` then call `visitCreate`. `productOrServiceId` is loaded with `product(id)` and copied as name and street `defaultUnitCost`. The id is not sent. `saveToProductsAndServices` is false
- `create_visit` — `visitCreate` on an existing job (`jobId` or `jobNumber`). `startAt` and `endAt` become `LocalDateTimeAttributes` in `America/Los_Angeles`. `notifyTeam` is false
- `search_requests` — title / client / address. Optional `clientId`, status, and `first` / `after`. Includes the assessment when Jobber returns it. `search_clients` and `search_jobs` were already enough for client and job lookup; request lookup was missing
- `get_request` — one request by encoded id, including its assessment
- `create_request` — `requestCreate` (`clientId`, `propertyId` unless the client has one property, `title`, optional `details`). Optional `startAt`, `endAt`, and `assigneeIds` schedule the on-site assessment on `RequestCreateInput.assessment` (`AssessmentCreateInput.schedule`). `details` are the assessment instructions and a `requestCreateNote`
- `create_note` — exactly one of `clientId`, `requestId`, `jobId`, `quoteId`, plus `message`. Mutations: `clientCreateNote`, `requestCreateNote`, `jobCreateNote`, `quoteCreateNote`. There is no generic `noteCreate` on this schema

### What Jobber's API cannot do here

Checked against API version 2025-01-20 introspection. The gateway still sends `X-JOBBER-GRAPHQL-VERSION: 2025-04-16`.

- An assessment **can** be created and scheduled. `requestCreate.assessment` and `assessmentCreate` take `instructions` and `schedule` (`startAt` / `endAt` as date + time + timezone, plus `teamMemberIdsToAssign`). The assessment **title cannot be set**. `clientConfirmed` is not an input. `notifyTeam` is forced false, and `teamReminderOffset` is omitted, so this does not send a booking confirmation or a reminder.
- `requestDetails` is a structured form, not a notes field. Free-text details go to assessment instructions and `requestCreateNote`.
- `jobCreate` **cannot** take a visit start/end datetime. `JobSchedulingAttributes` has `startTime` / `endTime` (time of day only), `createVisits`, and `notifyTeam`. `create_job` does not use the time-of-day fields. The first visit is a separate `visitCreate`.
- Job line items have **no** `productOrServiceId` (quote lines do). The tool copies catalog name and street price instead.
- The 2025-04-16 changelog removed the older `clientNoteCreate`, `jobNoteCreate`, and `requestNoteCreate` names. The tools call `clientCreateNote`, `jobCreateNote`, and `requestCreateNote`, which were already on the 2025-01-20 schema.
- Nothing in these tools sends, emails, texts, or notifies the client.
- `ProductOrService` has no `unitPrice` field. The street/default price is `defaultUnitCost`. `edit_product` maps `unitPrice` onto `ProductsAndServicesEditInput.defaultUnitCost` and does not send `unitPrice` to GraphQL.
- The 2025-01-20 schema has `productsAndServicesEdit` and no product delete mutation. `visible: false` hides a catalog row from line-item autocomplete. There is no archived flag.

## Brighton: connect Travis / Damien in Grok Bot

Grok Bot only accepts **remote** Streamable HTTP MCP (not local stdio). Each person gets their own named key. Jobber tokens never go on their laptop.

1. In Vercel → scws-jobs → Settings → Environment Variables, set `JOBBER_MCP_API_KEYS` (Production) with a unique key per person. Redeploy if you just added the var.
2. In Grok Bot, add a **custom MCP server** (chat: “add a custom MCP server” — not a marketplace plugin):
   - **Name:** `scws-jobber` (or `Jobber drafts`)
   - **URL:** `https://scws-jobs.vercel.app/api/mcp/jobber`
   - **Transport:** Streamable HTTP (if the UI only says HTTP/SSE, still use this URL)
   - **Header:** `Authorization` = `Bearer <that person's key>`
   - Tell the bot this is a **static API key**, not OAuth. Do not start an OAuth connect card.
3. Confirm tools load: `search_clients`, `create_client`, `list_users`, `create_request`, `create_job`, `create_visit`, `create_quote_draft`, `search_requests`, `search_invoices`, `search_jobs`, etc.
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
| `src/lib/jobber/mcp-products.ts` | `get_products` and one-product `edit_product` (`productsAndServicesEdit`) |
| `src/lib/jobber/mcp-quotes.ts` | get/search/update draft helpers |
| `src/lib/jobber/mcp-invoices.ts` | read-only invoice search / get |
| `src/lib/jobber/mcp-invoice-writes.ts` | invoice line/tax edit and unsent create-from-job |
| `src/lib/jobber/mcp-jobs.ts` | read-only job search / get, including photo URLs |
| `src/lib/jobber/mcp-job-writes.ts` | `jobClose`, one-off `jobCreate`, `visitCreate` |
| `src/lib/jobber/mcp-client-writes.ts` | `clientCreate`, `propertyCreate`, `users` |
| `src/lib/jobber/mcp-requests.ts` | read-only request search / get |
| `src/lib/jobber/mcp-request-writes.ts` | `requestCreate` plus assessment schedule and `requestCreateNote` |
| `src/lib/jobber/mcp-notes.ts` | client / request / job / quote notes |
| `src/lib/jobber/mcp-schedule.ts` | America/Los_Angeles `LocalDateTimeAttributes` |
| `src/lib/jobber/mcp-notify.ts` | blocks send / email / text / notify flags |
| `src/lib/jobber/quotes.ts` | Client search, unsent quote create, and `listTaxRates` |
| `src/lib/jobber/tax.ts` | Tax-rate summary (`id`, `name`, `label`, `rate`, `default`) and query filter |
| `src/lib/jobber/auth.ts` / `token-store.ts` / `client.ts` | OAuth refresh, durable `jobber_oauth` persist, GraphQL |
| `src/app/api/jobber/oauth-health/route.ts` | Secret-free durable-store diagnostic |
