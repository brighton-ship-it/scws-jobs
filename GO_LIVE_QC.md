# SCWS CRM go-live QC

**Verdict: NO — do not go live as the company CRM until the conditions below are met.**

Reviewed: `brighton-ship-it/scws-jobs` on `main` (live at https://scws-jobs.vercel.app), 2026-08-21.  
This is a quality review, not a redesign. Jobber stays the live field system until Brighton says otherwise.

This branch fixes the blocking API/auth and secret-in-repo issues that can be patched cleanly. It does **not** rotate leaked credentials (Brighton / Supabase / Stax / Intuit must do that) and it does **not** merge.

---

## What this app actually is

It is **all of the above**, in one Next.js 14 / Supabase app:

| Area | What exists | Ready to replace Jobber? |
|---|---|---|
| Lead inbox | Website booking + exit-intent leads, requests board | Intake only. Keep Jobber as system of record. |
| Jobs board | Jobs list, statuses, crew assign, photos, parts | Built, but untested for day-1 dispatch. |
| Dispatcher | Drag-drop board + map + route optimizer | Desktop-oriented; weak on a phone. |
| Technician app | `/tech` PWA (Capacitor iOS/Android shells) | Own login; talks to the same open APIs. |
| Quotes / invoices / pay | Full quote→invoice path, Stax, customer portal by token | Partial. QBO sync is broken in code. |
| Jobber | **Drilling-quote import only** (`POST /api/drilling/sync`) | Not a two-way sync. Do not turn this on as a Jobber replacement. |
| SMS / email | Twilio SMS, Resend email, Discord optional, AI “Sarah” | Dangerous if left unauthenticated (see blockers). |
| QBO | OAuth connect + invoice/customer/payment sync | Not safe to rely on (auth check uses the wrong client). |
| Marketing | Segments, campaigns, SMS/email blast | Do not enable until send endpoints stay staff-only. |
| AI receptionist | Vapi + SpeakSarah webhooks | Secrets optional/unchecked. |

Public website already posts estimate/booking leads to `/api/booking` and exit-intent to `/api/leads/create`. That intake can stay. The rest of the CRM is not ready to be the company system of record.

---

## Explicit answers

### Are public API routes locked down?

**Before this PR: no.** Middleware treated every `/api/*` path as public (`src/lib/supabase/middleware.ts`). Almost every data route uses the Supabase **service role** (bypasses RLS).

Live probe on 2026-08-21, no cookies:

| Endpoint | Result |
|---|---|
| `GET /customers`, `/jobs`, `/dispatch` | 307 → `/login` (admin UI is gated) |
| `GET /api/customers?limit=2` | **200**, `total: 20357`, names/emails/phones/addresses |
| `GET /api/booking` | **200**, 100 requests with name/phone/email/address/IP |
| `GET /api/jobs`, `/api/invoices`, `/api/quotes` | **200**, full records (2,130 invoices) |
| `GET /api/users` | **200**, 18 staff rows (email, phone, hourly_rate) |
| `GET /api/search?q=well` | **200**, 20 customer/job/invoice hits |
| `GET /api/quickbooks/config-check` | **200**, QBO client id + **client-secret prefix** |
| `GET /api/debug/users` | **200**, admin emails |
| `GET /api/cron/process-automations` | **200**, ran without a secret (“no active automations”) |
| `GET /api/pay/lookup?invoice=1001` | **200**, invoice + customer name/email (guessable numbers) |

CORS: booking was `Access-Control-Allow-Origin: *` (needed for the marketing site). Leads/create had **no CORS headers** (browser exit-intent posts can fail). Honeypot existed on booking only. Rate limit was in-memory, 100 req/min default — not a real limiter on Vercel.

**After this PR:** staff APIs return 401 without a session. `POST /api/booking` and `POST /api/leads/create` stay public (marketing site). Cron/debug/admin fallbacks fail closed. CORS + honeypot added on leads. This is necessary but **not sufficient** until the leaked service-role key is rotated (that key talks to Supabase directly and skips this app).

### Can customer PII be listed without login?

**Yes — confirmed on production.** Names, phones, emails, billing addresses, job notes, invoice totals, and staff rates were returned to an unauthenticated client. Admin HTML pages redirect; the JSON APIs did not.

### Jobber / Twilio / Gmail / QBO — and is it safe to turn them on?

| Integration | How it talks | Safe to turn on? |
|---|---|---|
| **Jobber** | `JOBBER_ACCESS_TOKEN` → Jobber GraphQL from `src/app/api/drilling/sync/route.ts`. One-way import of approved drilling quotes. Not customers, not schedule, not invoices. | **No as a live CRM sync.** Fine later as an optional drill-pipeline pull, after API auth is deployed. Do not treat this as Jobber replacement. |
| **Twilio / SMS** | Outbound from `/api/messages`, `/api/sms/on-my-way`, marketing send, automations. Inbound `/api/sms/inbound` (Sarah) has **no Twilio signature check**. | **Not until this PR is live.** Anyone could `POST /api/messages` and text customers. Inbound webhook can still be spoofed after this PR (should-fix). |
| **Gmail** | **None.** Outbound email is **Resend** (`RESEND_API_KEY`, `FROM_EMAIL`). | Safe once `FROM_EMAIL` is a verified Resend domain. No Gmail OAuth to enable. |
| **QBO** | OAuth in `/api/quickbooks/*`. Sync routes call `createServiceClient().auth.getUser()` — service-role clients have **no user session**, so sync returns 401 even for logged-in staff. Debug route leaked secret prefix. | **Do not turn on for go-live.** Do not change vendor classes. Do not send collections. Reconnect only after secrets are rotated and sync auth uses the cookie client. |

### Test coverage vs dispatcher day 1

**There are no automated tests** (`package.json` has no `test` script; no `*.test.*` / `*.spec.*` files).

What a dispatcher actually does on day 1, vs what is tested:

| Day-1 action | Covered? |
|---|---|
| See today’s jobs / unassigned / late | No test. UI exists (`/dispatch`, `/jobs`). |
| Assign a tech without double-booking | No conflict check. Two jobs can share a tech and time. |
| Convert a website request → job | UI on `/requests`; no test that notify email/Discord/push fires. |
| Text the customer / on-my-way | No test. SMS paths were public. |
| Tech updates status from the truck | `/tech` fetches `/api/jobs`; no test. |
| Take payment / send invoice | Stax + portal exist; no test. `/invoices/[id]/pay` loads `/api/invoices/:id` (PII if UUID known). |
| “Did the website lead land?” | No test. Booking POST is the live path. |

### Env vars that must exist in Vercel (names only)

**Must have for the CRM to boot and accept website leads**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY` (this is the name the app reads; `.env.example` used to only list `SUPABASE_SERVICE_ROLE_KEY`)
- `NEXT_PUBLIC_APP_URL` (set to the live host you want in emails, e.g. `https://scws-jobs.vercel.app` or `https://jobs.scwellservice.com`)
- `RESEND_API_KEY`
- `FROM_EMAIL`
- `FROM_NAME`
- `CRON_SECRET` (required after this PR; Vercel Cron sends it as `Authorization: Bearer …`)

**Required before enabling that feature — do not set-and-forget if you are not using it**

- Twilio: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `NEXT_PUBLIC_TWILIO_NUMBER`
- Stax: `STAX_API_KEY`, `NEXT_PUBLIC_STAX_WEB_PAYMENTS_KEY`, optional `STAX_API_URL`
- QBO: `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`, `ADMIN_API_KEY`
- Jobber: `JOBBER_ACCESS_TOKEN`
- Push: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Maps: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- OpenAI (Sarah chat + inbound SMS): `OPENAI_API_KEY`
- Vapi / SpeakSarah: `VAPI_WEBHOOK_SECRET`, `SARAH_WEBHOOK_SECRET`
- Admin one-offs: `ADMIN_SECRET`, `INTERNAL_API_KEY`
- Optional: `DISCORD_WEBHOOK_URL`, `BRIGHTON_USER_ID`
- If anything still uses `src/lib/db.ts`: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` or `SUPABASE_DB_PASSWORD`

Never commit values. Rotate anything that was in git (see blockers).

---

## 1. Blockers

Would lose a lead, leak customer data, let the public hit admin data APIs, break auth, double-book with no guard, or drop/forge Jobber/SMS/email.

### B1. Unauthenticated service-role APIs dump and mutate the CRM

**Live:** `GET /api/customers` returned 20,357 customer rows. `GET /api/booking` returned 100 lead rows with phones and addresses. Same for jobs, invoices, quotes, users, search, settings, dashboard stats.

**Write/abuse (same hole):** `POST /api/jobs`, `PATCH /api/jobs/[id]`, `POST /api/messages` (Twilio), `POST /api/marketing/send-sms`, `POST /api/customers` — no session check. Public could create/overwrite jobs or text customers. Booking POST does **not** overwrite jobs (hunch partly wrong on write; fully right on dump).

**Files:** `src/lib/supabase/middleware.ts`, `src/app/api/customers/route.ts`, `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/invoices/route.ts`, `src/app/api/booking/route.ts`, `src/app/api/messages/route.ts`, plus ~100 other `createServiceClient()` routes.

**Fixed looks like:** middleware returns **401 JSON** for `/api/*` except a tight public allowlist (`src/lib/public-api.ts`). Staff dashboard/tech PWA keep working via cookies. `POST /api/booking` and `POST /api/leads/create` stay public.

### B2. Hardcoded Supabase service-role key in a **public** GitHub repo

**File:** `scripts/add-completed-status.js` (was a live service-role JWT). Repo visibility is **public**. Anyone with that key can read/write the database **without this app**.

**Fixed looks like:** key removed from the file (env only). **Brighton must rotate the Supabase service role key in the Supabase dashboard, then update `SUPABASE_SERVICE_KEY` in Vercel.** Deleting it from git is not enough — history still has it. Also make the repo private.

### B3. Other secrets committed

Tracked files: `.env.stax` (Stax keys), `.env.pulled` / `.env.vercel.pulled` / `.env.temp` / `.env.newsletter` (Vercel OIDC tokens).

**Fixed looks like:** files untracked + gitignored. **Rotate Stax keys** if those values were real. OIDC tokens expire; still treat as leaked.

### B4. Debug / QBO config routes leak credentials

**Files:** `src/app/api/quickbooks/config-check/route.ts` (client secret prefix live), `debug-env`, `debug-oauth`, `debug/users`, `debug/push-status`.

**Fixed looks like:** those routes return 404.

### B5. Cron and admin migrate ran with public fallbacks

- `GET /api/cron/process-automations` ran on production with no auth (`CRON_SECRET` optional). If automations are later enabled, that sends SMS/email to customers.
- `src/app/api/admin/migrate/route.ts` fallback `migrate-secret-2024` (in public source).
- `src/app/api/admin/fix-utility-function/route.ts` fallback `scws-admin-fix-2026`.

**Fixed looks like:** missing secret → 401. Set `CRON_SECRET` (and `ADMIN_SECRET`) in Vercel before any cron is useful.

### B6. Website lead POST could be dropped (CORS) or flooded

`POST /api/leads/create` had no CORS, no honeypot, weak rate limit. Booking had honeypot + `CORS *` but `GET` listed PII and `PATCH /api/booking/[id]` accepted any body (`...body`).

**Fixed looks like:** CORS + honeypot on leads; tighter rate limits; booking GET/PATCH/DELETE require login; PATCH only `status|notes|customer_id|job_id|preferred_date|preferred_time`.

---

## 2. Should-fix before go-live

Do these after the PR is deployed and secrets are rotated. Not implemented here unless noted.

1. **Make `brighton-ship-it/scws-jobs` private.** Public + any future secret slip is the same class of incident.
2. **Rotate** Supabase service role, Stax, QBO client secret, Twilio/Resend if they ever appeared in git history, Vapi/Sarah webhook secrets.
3. **Twilio signature validation** on `/api/sms/inbound` and `/api/calls/webhook`. Today anyone can POST a fake SMS and (if Twilio env is set) make Sarah reply — cost + impersonation.
4. **Actually check** `VAPI_WEBHOOK_SECRET` / `SARAH_WEBHOOK_SECRET`. Both are defined; SpeakSarah’s check is optional and never rejects. Hardcoded fallbacks (`scws-vapi-2024`, `scws-sarah-2024`) are in public source — stop using fallbacks.
5. **QBO sync auth** — use cookie `createClient()` in `src/app/api/quickbooks/sync/*`. Do not change vendor classes. Do not send collections.
6. **CORS allowlist** for booking/leads/chat: `scwellservice.com`, `www.scwellservice.com`, `jobs.scwellservice.com` instead of `*`.
7. **Durable rate limit** (Upstash / Vercel KV). In-memory map resets on every serverless isolate.
8. **`GET /api/pay/lookup?invoice=`** is enumerable (`1001` worked). Require a second factor (zip or last name) or use portal tokens only.
9. **`/invoices/[id]/pay`** fetches `/api/invoices/:id` (full customer). After this PR that 401s for anonymous users — switch that page to the portal token API or it stays broken for public pay-by-link.
10. **No `customers.phone` index** in `001_initial_schema.sql` while booking/leads look up 20k+ rows by phone.
11. **No audit trail in app code.** `audit_logs` exists in `supabase/migrations/006_security_rls.sql`; nothing writes to it.
12. **RLS is not the real gate.** APIs use service role. Some migrations add `USING (true)` policies. Anon can `INSERT` `booking_requests` directly if the anon key is used against Supabase.
13. **`src/lib/db.ts`** hardcodes pooler user `postgres.htzsnpqrrrdfleldgybn` and `ssl: { rejectUnauthorized: false }`.
14. **Double-book:** no overlap check when assigning `scheduled_date` + `scheduled_time` + `assigned_to`.
15. **Dispatch on a phone:** `/dispatch` is a multi-column drag-drop board + map, 500-job fetch, no mobile layout. Office desktop only.
16. **Tech `/tech` is a public page** (handles own auth). After this PR its APIs need a real session — confirm techs can still load jobs.
17. **In-memory SMS conversation cache** on `/api/sms/inbound` is lost on cold start — leads from text can drop.
18. **`SUPABASE_SERVICE_KEY` vs `SUPABASE_SERVICE_ROLE_KEY`** naming mismatch. Vercel must have the name the code reads.
19. **Repo demo mode:** if `NEXT_PUBLIC_SUPABASE_URL` is missing, middleware skips auth and any password logs in. Do not ship a build without the real URL.

---

## 3. Nits / later

Do not implement these for go-live.

- Copy still says “Jobber-style” in sidebar/jobs comments; customers will not see that.
- Two office URLs in emails (`scws-jobs.vercel.app` vs `jobs.scwellservice.com`).
- Home Depot scraper (`/api/homedepot`) is a brittle extra.
- Push-test / technician clock-in stored in `localStorage` only.
- `package.json` still at `0.1.0`.
- Mock data in `src/lib/mock-data.ts` includes dummy Gmail addresses (not a Gmail integration).
- Marketing module docs mention SendGrid; code uses Resend.
- No Storybook / visual regression.
- Capacitor iOS/Android wrappers are scaffolding, not a store release.

---

## Conditions to flip this to “yes”

1. Merge this PR (do not merge from this agent — Brighton reviews).
2. Rotate Supabase service role + Stax + QBO secret; update Vercel; make the GitHub repo private.
3. Set `CRON_SECRET`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_APP_URL`, Resend vars.
4. Redeploy and re-check: `GET https://scws-jobs.vercel.app/api/customers` must be **401**. `POST /api/booking` from the website must still **200**.
5. Keep **Jobber** as the live field system. Use this app for website lead intake first.
6. Do not enable Twilio blasts, automations, or QBO sync until those paths are auth-fixed and clicked through by Brighton/Lizbeth.
7. Sit a dispatcher on `/dispatch` and a tech on `/tech` for one real morning before calling this the company CRM.

---

## What this PR changed (code only)

- API session gate + public allowlist
- Booking list/update/delete require login; PATCH field whitelist
- Leads CORS + honeypot
- Tighter in-memory rate limits on public intake
- Cron/admin fail closed without secrets
- Debug/QBO-config routes 404
- Removed hardcoded service-role key from `scripts/add-completed-status.js`
- Stop tracking pulled env files
- This report

No QuickBooks vendor-class changes. No collections. No invented customers/jobs/metrics. No secrets in the new files.
