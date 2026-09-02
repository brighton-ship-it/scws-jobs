# SCWS Jobs — Jobber replacement readiness

**Verdict: NO-GO.** Do not treat `scws-jobs` as ready to replace Jobber. Do not cut over. Do not dual-write. Shop stays in Jobber.

Reviewed: `brighton-ship-it/scws-jobs` on `main` (live `https://scws-jobs.vercel.app`), 2026-09-02.  
This is a written punch list, not a build plan. Jarvis must not call the app ready.

Companion QC (still mostly true): `GO_LIVE_QC.md` (2026-08-21). That review locked staff APIs. This review asks a different question: **could this repo become the company job system later?** Answer: not until the blockers below are gone, and even then only after a dispatcher and a tech run a real morning on it.

---

## What this app is today

A Next.js 14 / Supabase CRM shell that is already useful as **website + voice lead intake** and **permit/well research**. It is not the system of record for customers, jobs, schedule, quotes, invoices, or payments.

| What staff actually do in Jobber | What this app does |
|---|---|
| Customer master + property + APN | Lead dump (~20k rows). Phone-only exact-match. No Jobber client id. APN unused in CRM UI. |
| Book / assign / dispatch | Sarah books **Jobber**. CRM dispatch drag-assign is local React state. |
| Tech updates status / photos | `/tech` writes `localStorage`. Office never sees it. |
| Quotes → accept → job → invoice | Office can draft. Portal approval writes an illegal status. Convert is a query-string hop. |
| Take card / ACH | Portal + Stax paths exist. Legacy `/api/payments` is still mock. No Stax webhooks. |
| QBO | Connect UI exists. Sync routes auth with the service client → always 401. |

---

## Live hunches (verified)

Operator saw ~20k customers; Brighton Scala house **13736 Crystallite** imported as duplicate Vapi leads with streets **Crystal Light Lane** and **Crystal White Lane**; that card had zero jobs/quotes/invoices and no APN; dashboard showed round **1000** on requests / draft invoices.

| Hunch | Verdict | Evidence |
|---|---|---|
| ~20k customers | **Consistent.** Cannot re-dump live rows (staff API now 401). List page prints exact `total`. Aug 21 probe was `20357`. UI `limit=100`. | `src/app/api/customers/route.ts` (`count: 'exact'` when not searching). `src/app/(dashboard)/customers/page.tsx` (`{total.toLocaleString()} total customers`). `GO_LIVE_QC.md`. |
| Crystallite → Crystal Light / Crystal White | **Mechanism confirmed.** Instance cannot be re-read without login. Permit tooling already knows the real house: `13736 CRYSTALLITE LN, VALLEY CENTER, CA 92082`, APN `129-092-71-00`. Vapi stores ASR street as-is. Dedup is `.eq('phone', phone)` exact. No address fuzzy match. Search is name/email/phone only — **not address** — so “Crystallite” will miss those streets. | `src/app/api/receptionist/webhook/route.ts` (phone match + `address.trim()` insert). `src/app/api/leads/create/route.ts` (digits-only phone). `src/app/api/customers/route.ts` search `or`. `src/lib/permits/research.test.ts` / `as-built.ts` (real APN). Customer UI: **zero** `apn` references under `src/app/(dashboard)/customers/`. |
| Zero jobs/quotes/invoices on that card | **Expected for a Vapi lead.** Voice booking writes Jobber, not `jobs`. Customer detail only lists CRM jobs (`/api/jobs?customer_id=`). The **CRM as a whole is not empty**: unauthenticated `GET /api/pay/lookup?invoice=1001` returned invoice 1001 (status `paid`) on 2026-09-02. | `src/lib/receptionist/book-service-call.ts` (Jobber GraphQL only). `src/app/(dashboard)/customers/[id]/page.tsx`. Live lookup (PII exists; do not treat pay-lookup as a data browser). |
| Dashboard “1000” | **Not a hardcoded stub. Silent PostgREST cap.** Stats comment says “accurate counts”; several queries fetch rows and use `.length`. Supabase default `max_rows` is 1000. Round 1000 on pending requests / draft invoices / draft quotes is what a capped select looks like. Exact-count queries (jobs, confirmed requests, declined quotes) would not stick at 1000 unless the real count is 1000. | `src/app/api/dashboard/stats/route.ts` lines 6–7 vs 28–44 vs 48–77. Also: home page still shows Jobber-style onboarding todos that 404 (`/settings/branding`, `/settings/client-portal`, `/settings/emails`). |

**Do not “fix” the Crystallite duplicates by adding CRM screens.** Merge is an ops job in Jobber (and later a one-off SQL cleanup). Dual-write would make this worse.

---

## Slice scorecard

| Slice | Status | Why |
|---|---|---|
| Auth / roles | **BLOCKER** | Session gate works. Roles do not. |
| Customers | **BLOCKER** | Lead inbox, not a customer master. |
| Jobs | **BLOCKER** | Real work lives in Jobber. |
| Schedule / dispatch | **BLOCKER** | Board does not persist assignments. |
| Quotes | **BLOCKER** | Portal approve writes illegal status. |
| Invoices | **BLOCKER** | Public pay-by-UUID broken; lookup enumerable (live). |
| Payments (Stax / card / ACH) | **BLOCKER** | Split mock/real; no webhooks; `ach` vs CHECK. |
| Tech / field PWA | **BLOCKER** | Read-only schedule + localStorage. |
| Sarah / receptionist | **BLOCKER** | Secrets unused; books Jobber; prod write bugs. |
| QBO | **BLOCKER** | Sync routes always 401. |
| SMS / notifications | **BLOCKER** | No Twilio signature; VAPID broken in prod. |
| Data quality vs Jobber import | **BLOCKER** | No client link; phone formats diverge; APN unused; paid-invoice script only. |
| Operator troubleshooting | **UNKNOWN** | Repo + Vercel logs can diagnose env/schema/token. Not enough to run the shop. |

READY would mean: a dispatcher and a tech could run tomorrow without Jobber, with roles enforced, payments reconciling, and customer/job data matching the field. Nothing below is that.

---

## 1. Auth / roles — BLOCKER

**What exists**

- Cookie session on HTML pages. Non-allowlisted `/api/*` returns 401 without a user (`src/lib/supabase/middleware.ts`).
- Live re-probe 2026-09-02, no cookies: `GET /api/customers?limit=2` → **401**. `GET /api/dashboard/stats` → **401**. `GET /api/booking` → **401**. The Aug 21 dump hole is closed at the app edge.
- Roles in types: `admin | office | tech | field` (`src/types/database.ts`). Permission matrix in `src/lib/permissions.ts` — **sidebar only**.
- `canAccessRoute()` exists and is **not used** by middleware. Any logged-in user can open `/settings`, `/invoices`, `/dispatch`.
- `requireUser()` is cookie-only, no role. Most data routes skip it and use `createServiceClient()` (bypasses RLS).
- Missing role → treated as **admin** (`hasPermission`).
- First login auto-provisions `office` unless email is in a hardcoded admin list (`src/app/api/auth/me/route.ts`).
- No `dispatcher` / `receptionist` role. Those names are UI fiction.
- Demo mode: if `NEXT_PUBLIC_SUPABASE_URL` is missing, middleware skips auth. Live login page is real (not demo).
- RLS (`006_security_rls.sql`): any `authenticated` user can manage customers/jobs. Service role has full access. App auth is the real gate.

**Required env:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` (this name — not only `SUPABASE_SERVICE_ROLE_KEY`).

**Jobber replacement needs:** enforced roles on every mutating API; field users see assigned work only; webhook secrets that reject.

**Punch:** lock roles on APIs, or do not call this a multi-user CRM.

---

## 2. Customers — BLOCKER

**What exists**

- CRUD + list + lead source fields. Properties as a child table.
- `apn` column + index (`20260203_parcel_infrastructure.sql`). **Not in** `Customer` TS type. **Not on** customer create/edit/detail UI. PATCH allowlist is `name|email|phone|billing_address|notes|add_property`.
- No `jobber_client_id` on customers. Jobber ids exist on quotes/jobs only (`005_add_jobber_columns.sql`).
- No unique index on `customers.phone`.
- Intake: `POST /api/leads/create` (public, honeypot, CORS `*`), `POST /api/booking` (request only — does not create a customer), Vapi/Sarah webhooks (create customer on phone miss).
- Dedup: exact phone string. Leads store **digits**. Jobber invoice import stores **`(760) 555-1234`**. Cross-source match fails.
- `.single()` on phone: two rows with the same phone → lookup errors → another insert.

**Jobber replacement needs:** one customer per household, Jobber client link, APN on the property, merge tool, address search.

**Punch:** this is a lead table that grew to tens of thousands of rows. It is not a customer master.

---

## 3. Jobs — BLOCKER

**What exists**

- `jobs` table, statuses, crew fields, `jobber_job_id` column.
- `GET/POST /api/jobs`, `PATCH /api/jobs/[id]` — service role, no role check, **no overlap check**.
- Photos/parts/expenses APIs exist for the **office** job page.
- Sarah `bookJob` → `handleBookServiceCall` → Jobber GraphQL. **No insert into `jobs`.**
- `POST /api/drilling/sync` imports approved drilling quotes only.
- `POST /api/cron/sync-jobber-book-jobs` is GA4 `book_job` conversion tracking, not a job mirror.

**Prod (Vercel runtime errors, last 7 days):**

- `[book_job] Cron failed: Jobber GraphQL HTTP 401` — 144 hits through 2026-09-02 16:30 UTC. `JOBBER_ACCESS_TOKEN` is dead or rejected.
- `[cron] CRON_SECRET is not set` — 283 hits through 2026-09-01, then the 401s (secret appeared; token still bad).

**Punch:** CRM jobs are optional local rows. Day-to-day work is in Jobber. Empty jobs on a Vapi customer is the architecture, not a missing screen.

---

## 4. Schedule / dispatch — BLOCKER

**What exists**

- `/schedule` — week/day/list/map, `/api/jobs` default limit 100.
- `/dispatch` — drag-drop board, `/api/jobs?limit=500`, map, GPS hook.
- `/dispatch/routes` — Google Maps optimizer (needs `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).
- Comment on dispatch: “persists to database on change.” `handleDragEnd` only `setJobAssignments`. **No PATCH.** Refresh undoes the board.
- Conflict checks exist for **Jobber visits** in Sarah `open-slots.ts`, not for CRM jobs.
- Prod 2026-09-02: `Could not find the table 'public.tech_locations'` — migration `20250203_tech_locations.sql` is **not applied**. Dispatch map GPS is dead.

**Punch:** desktop toy board. Do not put Lizbeth on this for a real morning.

---

## 5. Quotes — BLOCKER

**What exists**

- Staff CRUD, email+PDF send, portal view, follow-up cron scaffolding.
- Convert to job/invoice = navigate to `/jobs/new?from_quote=` / `/invoices/new?from_quote=`.
- “Approve and pay” is `toast.info('Coming soon')`.

**Broken**

- Schema CHECK: `draft|sent|accepted|declined|expired`. Column is `accepted_at`.
- Portal approve writes `status: 'approved'` and `approved_at` (`src/app/api/portal/[token]/quotes/[id]/route.ts`). That update should 500. Staff/signature path correctly uses `accepted`.

**Punch:** office can email a PDF. Customer cannot reliably accept online. No quote→job automation.

---

## 6. Invoices — BLOCKER

**What exists**

- Staff CRUD, send email with `/portal/{token}/invoices/{id}` pay link, portal view, manual payment record.
- No `/api/invoices/[id]/pdf` (quotes have PDF; invoices do not).

**Broken / live**

- `/invoices/[id]/pay` fetches `/api/invoices/:id` (staff-only after the gate) and posts mock `/api/payments`. Automations still generate that URL (`process-automations`).
- `GET /api/pay/lookup?invoice=1001` is public and enumerable. **Live 200** on 2026-09-02: invoice number, customer name, email, totals. Guessable integers.

**Punch:** send the portal token link only. Do not advertise `/pay?invoice=`. Do not cut over collections.

---

## 7. Payments (Stax / cards / ACH) — BLOCKER

**What exists**

- Real Stax on `POST /api/payments/process`, `POST /api/payments/ach`, portal pay, `StaxPaymentForm`.
- Settings page for fee % / ACH / check toggles.
- Check = instructions + manual record.

**Broken**

- `POST /api/payments` still returns `pi_mock_…` / “Stax integration pending” (`PAYMENT_FLOW_README.md` is the old truth for this route).
- No Stax webhook route. ACH “pending until clear” never updates from Stax.
- Schema CHECK: `cash|check|card|transfer|other`. Code inserts `'ach'`. TypeScript allows `ach`. **No migration adds it.** ACH record may fail after a successful charge.
- `/api/payments/process` uses service-client `getUser()` → 401 unless `x-portal-payment`. Missing `STAX_API_KEY` records `demo_*` as success.
- `/api/payments/bin-lookup` is not on the public allowlist — portal BIN fee check can 401.

**Required env:** `STAX_API_KEY`, `NEXT_PUBLIC_STAX_WEB_PAYMENTS_KEY`, optional `STAX_API_URL`.

**Punch:** one portal path might charge a card if keys are set. That is not a payments system.

---

## 8. Tech / field PWA — BLOCKER

**What exists**

- `/tech` is a public page with its own login (middleware exception). Capacitor iOS/Android shells. Push prompt. Network-first SW.

**Broken**

- Status → `localStorage` `job_status_*`. Complete is `setTimeout` (“Simulate API call”).
- Notes / photos → `localStorage`. Office gallery uses `/api/jobs/[id]/photos`. Two worlds.
- Clock-in → `localStorage`.
- No on-my-way from `/tech` (API exists, unused).
- SW falls back to `/tech/offline` — **page missing**.
- No offline write queue.

**Punch:** a tech can see today’s CRM jobs (if any are assigned in CRM). They cannot run a day.

---

## 9. Sarah / receptionist webhooks — BLOCKER

**What exists**

- `POST /api/receptionist/webhook` (Vapi): end-of-call customer/request/task/email/Discord; function calls `checkSchedule`, `bookJob` (Jobber), pay link.
- `POST /api/receptionist/sarah` (SpeakSarah): similar intake.
- Call-id upsert on `receptionist_calls.vapi_call_id`.

**Broken**

- `VAPI_WEBHOOK_SECRET` default `'scws-vapi-2024'` — **never compared**.
- `SARAH_WEBHOOK_SECRET` default `'scws-sarah-2024'` — header read, **never compared**. Anyone can POST (public allowlist).
- Booking requires `JOBBER_ACCESS_TOKEN` and writes Jobber, not CRM.
- Task assignee email in webhook is `travis@` (likely wrong roster).
- Prod: `invalid input syntax for type integer: "117.833"` on `duration_sec` (column is `INTEGER`; Vapi sends floats). **115 errors** through 2026-09-02 — call record updates fail after the customer insert. That is a duplicate/lead-quality factory.
- Prod: VAPID configure throws from the webhook path (push after a call is broken).

**Required env:** `VAPI_WEBHOOK_SECRET`, `SARAH_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `JOBBER_ACCESS_TOKEN`, `RESEND_API_KEY`. Optional `DISCORD_WEBHOOK_URL`, `BRIGHTON_USER_ID`.

**Punch:** keep Sarah as a Jobber receptionist. Do not point her at CRM jobs. Fix secret checks before anything else.

---

## 10. QBO — BLOCKER

**What exists**

- OAuth connect/callback/status use the cookie client. Tokens stored. `getQuickBooksClient()` is cookie-based.
- Config-check / debug-env return **404** (Aug leak closed).

**Broken**

- `POST /api/quickbooks/sync/{invoice,payment,customer}`: `createServiceClient().auth.getUser()` → no session → **401 for logged-in staff**. Unchanged since `GO_LIVE_QC.md`.

**Required env:** `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT`.

**Punch:** do not connect QBO for go-live. Do not change vendor classes. Do not send collections from this app.

---

## 11. SMS / notifications — BLOCKER

**What exists**

- Outbound Twilio: `/api/messages` (staff-gated), `/api/sms/on-my-way`, automations cron.
- Inbound `/api/sms/inbound` (Sarah SMS) + `sms_conversations` upsert.
- Push: VAPID subscribe/unsubscribe/test, `push_subscriptions`.
- Email: Resend (`RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`). No Gmail integration.

**Broken**

- Inbound: **no Twilio signature check**. Public allowlist. Spoofable; if Twilio env is set, Sarah replies (cost + impersonation).
- In-memory `conversationCache` still documented as the session store; DB upsert helps but cold start drops in-flight context.
- Prod: `Vapid public key must be a URL safe Base 64 (without "=")` — **120 errors**. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is set and **invalid**. Push is not optional-off; it errors on booking and Vapi paths.
- Automations cron: daily 09:00. Was open when `CRON_SECRET` missing (283 logged failures). Now requires secret.

**Required env:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`; push keys if you want push (currently harmful).

**Punch:** do not enable SMS blasts or automations until inbound is signed and cron has been watched for a week.

---

## 12. Data quality vs Jobber import — BLOCKER

**What this repo can import**

| Path | What it does | Jobber replacement? |
|---|---|---|
| `scripts/import_jobber_invoices.py` | One-off **paid** invoices. Creates customers by email / formatted phone + name. | No. History only. **Hardcoded Supabase host + postgres password in source** — rotate that DB password; do not run the script from a laptop against prod as “sync.” |
| `POST /api/drilling/sync` | Approved drilling quotes. | Pipeline pull, not CRM. |
| `POST /api/cron/sync-jobber-book-jobs` | GA4 conversion when a Jobber job is first scheduled. | Analytics. Currently **Jobber 401**. |
| Customer / job / schedule / open-invoice sync | — | **Missing.** |

**Quality gaps that produced the Crystallite card**

1. Vapi ASR street stored raw → Crystal Light / Crystal White.
2. Phone exact-match only; format `(760)…` vs digits; no unique constraint.
3. APN exists in permit GIS (`129-092-71-00`) and is never written to `customers.apn`.
4. Search cannot find the street.
5. No Jobber client id → cannot prove “this CRM row is that Jobber client.”
6. Vapi duration write fails (prod) after customer create → incomplete call record, retry/re-call creates another lead.
7. Schema drift: `tech_locations` missing; `booking_requests.ga_client_id` was missing (PGRST204); `booking_requests_source_check` rejected a cost-calculator source (live error 2026-08-29).

**Punch:** do not import Jobber clients into this table until dedup + APN + `jobber_client_id` exist. Another import would add a third Crystallite.

---

## Could an operator troubleshoot production from this repo + logs?

**Partially. Not well enough to run the shop.**

| Can they… | From repo + Vercel logs? |
|---|---|
| See staff APIs are gated | Yes. Live 401. `public-api.ts` + middleware. |
| See Jobber token is dead | Yes. 144× GraphQL 401 on `sync-jobber-book-jobs` + `quotes-gp`. |
| See cron secret was missing | Yes. 283× through Sep 1. `src/lib/cron-auth.ts` explains the header dance. |
| See Vapi call updates failing | Yes. `22P02` on `duration_sec`. |
| See GPS table missing | Yes. `PGRST205` `tech_locations`. |
| See push keys invalid | Yes. VAPID Base64 errors on booking/webhook. |
| See communications page broken | Yes. `src/lib/db.ts` defaults pooler user `postgres.htzsnpqrrrdfleldgybn` → `ENOTFOUND` on 2026-09-02. |
| See QBO sync fail for staff | Only if they know to look at the service-client `getUser()` pattern. No useful 401 body. |
| See why a tech’s photos vanished | No. `localStorage`. Zero server logs. |
| See why a Stax ACH is still “paid” | No webhook, no APM. Need Stax dashboard. |
| Get a customer dump without login | No (good). Need Supabase SQL or a staff session. |
| Use in-app debug routes | No. Intentionally 404. |
| Get paged errors / Sentry | No `@sentry/*`. `console.error` only. |
| Trust migrations in `supabase/migrations/` | **No.** Prod is behind the repo (confirmed missing table + past missing columns). |

So: an operator with this repo, Vercel runtime errors, and Supabase SQL can diagnose **tokens, env names, schema drift, and webhook type bugs**. They cannot reconstruct a field day, a payment, or a duplicate-customer merge from logs alone. Vendor consoles (Jobber, Twilio, Stax, Intuit, Supabase) are still required.

Do not use `scripts/import_jobber_invoices.py` as a troubleshooting tool — it embeds DB credentials.

---

## Env names (no values)

**Must exist for the app to boot and take website leads**

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_APP_URL`, `RESEND_API_KEY`, `FROM_EMAIL`, `FROM_NAME`, `CRON_SECRET`

**Must exist before that feature is on — do not set-and-forget**

| Feature | Names |
|---|---|
| Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` |
| Stax | `STAX_API_KEY`, `NEXT_PUBLIC_STAX_WEB_PAYMENTS_KEY` |
| QBO | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_ENVIRONMENT` |
| Jobber | `JOBBER_ACCESS_TOKEN` (currently 401 in prod) |
| Sarah / Vapi | `VAPI_WEBHOOK_SECRET`, `SARAH_WEBHOOK_SECRET`, `OPENAI_API_KEY` |
| Push | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (currently invalid) |
| Maps | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` |
| GA4 book_job | `GA4_MEASUREMENT_ID`, `GA4_MP_API_SECRET` |
| Ops | `QUOTES_GP_KEY` or `ADMIN_SECRET` |
| Legacy `db.ts` | `DB_HOST`, `DB_USER`, `DB_PASSWORD` or `SUPABASE_DB_PASSWORD` |

`.env.local.example` only lists Supabase keys. `.env.example` is the real list.

---

## GO_LIVE_QC.md (Aug 21) — still open?

| Item | Now |
|---|---|
| B1 Unauthenticated staff APIs | **Fixed in prod.** 401 confirmed. |
| B2 / B3 secrets in git | Service-role JS script cleaned. **Python invoice import still has a DB password.** Rotate. |
| B4 debug / QBO config leak | **Fixed** (404). |
| B5 cron/admin fallbacks | **Mostly fixed** in code. Prod ran without `CRON_SECRET` until ~Sep 1. |
| B6 leads CORS / honeypot | **In code.** CORS still `*`. |
| Twilio signature | **Open.** |
| Vapi / Sarah secret check | **Open.** |
| QBO sync cookie client | **Open.** |
| Pay lookup second factor | **Open.** Live 200 on invoice 1001. |
| `/invoices/[id]/pay` portal token | **Open.** |
| Tech field writes | **Open.** |

---

## Go / no-go punch list

**No-go (today)**

- Do not cut over from Jobber.
- Do not dual-write jobs or customers.
- Do not add unused CRM screens to “look ready.”
- Do not enable Twilio blasts, automations, or QBO sync.
- Do not import Jobber clients into `customers` again.
- Do not tell Brighton this is the company CRM.

**Keep doing**

- Website `POST /api/booking` and `POST /api/leads/create` as intake.
- Sarah as a **Jobber** receptionist (`JOBBER_ACCESS_TOKEN` must be rotated — it is 401).
- Permit / well research (this is the part of the repo that is actually sharp).
- Portal pay links (token in the path), not `/pay?invoice=`.

**Before anyone even discusses a future cutover** (not this PR)

1. Rotate Jobber token; set/keep `CRON_SECRET`; fix VAPID or unset the keys so they stop throwing on intake.
2. Enforce webhook secrets (no public fallbacks). Twilio signature on inbound SMS.
3. Apply missing migrations (`tech_locations`, click-id columns) — in Supabase SQL, not from an agent laptop.
4. Persist dispatch assign; persist tech status/photos; reject illegal quote statuses.
5. Dedup + `jobber_client_id` + APN **before** any customer import.
6. QBO sync on cookie auth — only after Brighton/Lizbeth click through.
7. Sit a dispatcher on `/dispatch` and a tech on `/tech` for one real Jobber-backed morning **after** the above. If that morning fails, Jobber stays.

---

## What this document is not

Not a cutover. Not a dual-write design. Not a feature dump. Not a claim that counts in the UI are trustworthy. Not permission to call the app ready.
