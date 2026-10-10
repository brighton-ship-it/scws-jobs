# Paid-ads attribution

This is the closed loop from a Google Ads click or call to a Jobber invoice. It does not change the shop phone number, Sarah, or any campaign, keyword, or budget.

Jobber reads go through `jobberGraphql`, which uses the single Production durable token in `settings.jobber_oauth`. Nothing in this flow refreshes Jobber on its own.

## What each layer does

1. **Forms.** `public/ads-attribution.js` stores `gclid`, `gbraid`, `wbraid`, the GA4 client id, and UTMs in the host-only cookie `scws_ads` for 90 days, and copies them into form fields. `POST /api/booking` and `POST /api/leads/create` accept JSON and `application/x-www-form-urlencoded`. A click id, `gbraid`/`wbraid`, or `utm_medium` of `cpc`/`ppc` sets `lead_source = google_ads` on the booking and the customer. Campaign is `utm_campaign`. Keyword is `utm_term`. `source` stays the intake channel (`website`, `embed`, `manual`, `phone`) so the live source check cannot 500.

2. **book_job.** `/api/cron/sync-jobber-book-jobs` still logs every newly scheduled Jobber job in `book_job_conversions`. It calls GA4 Measurement Protocol only when the matched lead has a real `ga_client_id`. The event includes `gclid` when we have one and the invoice pre-tax value when Jobber has issued an invoice (otherwise the job total). A click id without a client id is logged with `skip_reason = click_id_only_offline` and is not sent with a `last-resort.*` client id. Those jobs wait for the offline upload.

3. **Offline conversions (sent at booking).** `/api/cron/ads-offline-conversions` builds one click conversion per BOOKED Jobber job, not per invoice or payment. Booked time = the job's `createdAt` (a booked job or accepted quote creates the job). `order_id` = Jobber job id, so Google dedupes. Value = the quote's pre-tax subtotal, else the issued-invoice pre-tax subtotal, else the job total; the conversion time stays at the booking time. New customers only: an ad call, click-id lead, or `google_ads` lead must exist and come before the job; the job must be on or after Sep 18 2026 00:00 PT; a client with any other job, or an issued invoice, dated before the first ad signal is skipped as existing; only the client's first booked job counts. The cron response lists `rows` (client, booked_at, value) and `excluded` (with reason). Default mode is dry-run: the row is written to `ads_offline_conversions` with `status = dry_run` and Google is not called. `ADS_OFFLINE_UPLOAD=live` uploads, and only if `GOOGLE_ADS_OFFLINE_CONVERSION_ACTION` is set. This code does not create the conversion action.

4. **Ad calls.** `/api/cron/ads-calls` runs a read-only `call_view` query and stores campaign, duration, and start time in `ads_calls`. Google does not return the caller number or the keyword on `call_view`. The caller number is joined from the Google Workspace Voice audit log (start time within 30 seconds, duration within 15 seconds) and then matched to a CRM customer or a Jobber client by phone. A matched customer whose lead source is empty, `phone`, or `website_form` is tagged `google_ads`.

5. **Weekly report.** `/api/cron/ads-closed-loop` emails (and, when configured, appends a Google Sheet tab `Closed loop`) grouped by source, campaign, and keyword: leads, calls, booked jobs, quotes, invoiced revenue, cost, and ROAS. Revenue with no lead and no ads call is `source = unattributed`.

## Migrations to apply

In the Supabase SQL Editor, run:

`supabase/migrations/20261010_paid_ads_attribution.sql`

If `booking_requests` still lacks click-id columns, also run:

`supabase/migrations/20260827_book_job_click_ids_and_conversions.sql`

Undo the new objects only with:

`supabase/migrations/20261010_paid_ads_attribution_rollback.sql`

That rollback drops the new tables and the new booking/book_job columns. It does not drop customer UTM columns, because those may already have been created by an older migration.

## Environment variables

Set these on the Vercel project **scws-jobs**, Production. Do not commit the values.

Already required for the pieces this builds on:

| Name | Used for |
| --- | --- |
| `CRON_SECRET` | All `/api/cron/*` routes |
| `GA4_MEASUREMENT_ID` | book_job Measurement Protocol. Defaults to `G-5LL1YRWT5T` when unset |
| `GA4_MP_API_SECRET` | book_job send. Without it, real client-id jobs are logged and the send is retried |
| `JOBBER_CLIENT_ID`, `JOBBER_CLIENT_SECRET`, `JOBBER_TOKEN_ENCRYPTION_KEY` | Durable Jobber OAuth. Do not refresh tokens from a laptop |
| `RESEND_API_KEY` | Weekly report email |

New:

| Name | Required | Used for |
| --- | --- | --- |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | For calls, cost, and live upload | Ads API |
| `GOOGLE_ADS_CLIENT_ID` | Same | OAuth client |
| `GOOGLE_ADS_CLIENT_SECRET` | Same | OAuth client |
| `GOOGLE_ADS_REFRESH_TOKEN` | Same | Read-only search, and upload only in live mode |
| `GOOGLE_ADS_CUSTOMER_ID` | Same | Ads account id, digits only |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Only for an MCC | Manager account id |
| `GOOGLE_ADS_API_VERSION` | No | Defaults to `v18` |
| `GOOGLE_ADS_OFFLINE_CONVERSION_ACTION` | Live upload only | Resource name `customers/123/conversionActions/456` for the existing "Jobber Won (offline)" upload-clicks action. Create that action in the Ads UI. This repo will not create it |
| `ADS_OFFLINE_UPLOAD` | No | `dry_run` (default) or `live` |
| `GOOGLE_VOICE_REFRESH_TOKEN` | To attach caller phones | Workspace admin who can read Voice audit reports. Client id/secret fall back to the Ads OAuth client |
| `GOOGLE_VOICE_CLIENT_ID`, `GOOGLE_VOICE_CLIENT_SECRET` | No | Override the Ads OAuth client for Voice |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Sheet delivery | Weekly append |
| `GOOGLE_SHEETS_REFRESH_TOKEN` | Sheet delivery | OAuth with Sheets scope |
| `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET` | No | Fall back to the Ads OAuth client |
| `ADS_REPORT_EMAIL` | No | Defaults to `brighton@scwellservice.com` |

The Ads OAuth token needs the Google Ads scope. The Voice token needs Admin Reports audit read. The Sheets token needs spreadsheets. Do not reuse a token that cannot call that API; a 403 is recorded and the rest of the job continues.

Crons, UTC:

- book_job: every 15 minutes (unchanged)
- ads calls: `45 8 * * *`
- offline conversions: `15 9 * * *`
- closed loop: `0 15 * * 1` (Monday 08:00 Pacific during standard time)

## Live end-to-end test

Do this after the migration is applied and the app revision is deployed. Do not change the shop number. Use a real handset you control.

### 1. Test form

On the marketing site, include:

```html
<script src="https://jobs.scwellservice.com/ads-attribution.js"></script>
```

The booking widget loads that script on its own and passes the click id into the embed iframe.

Open a landing URL with a fake click id:

`https://scwellservice.com/?gclid=TEST-e2e-gclid&utm_source=google&utm_medium=cpc&utm_campaign=Search-1&utm_term=well+pump`

Confirm the cookie `scws_ads` is present and that its `Max-Age` is about 90 days. Open a second page on the same host with no query string and confirm the cookie still has the gclid.

Submit the real form with a test name and your phone. Expect HTTP 200, not 500.

No-JS check, from a machine that can reach the deployment:

```bash
curl -sS -D- -o /tmp/booking-body.json \
  -X POST 'https://jobs.scwellservice.com/api/booking' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data 'service_type=pump_repair&customer_name=Ads+Test&phone=7605550199&address=1+Test+Rd&city=Ramona&gclid=TEST-e2e-gclid&utm_medium=cpc&utm_campaign=Search-1&utm_term=well+pump'
```

Expect `200` and `"success": true`. In Supabase, that `booking_requests` row has `lead_source = google_ads`, `utm_campaign = Search-1`, `utm_term = well pump`, and the gclid. `source` is `website`. The customer with that phone has `lead_source = google_ads`.

### 2. Test call

Place a call that Google Ads will count (click an ad call asset or a website forwarding number, from a handset whose number you can see). Do not change the number Sarah answers.

After the call is in Ads, run the cron once:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://jobs.scwellservice.com/api/cron/ads-calls
```

Expect a new `ads_calls` row with campaign name and duration. `caller_phone` is filled only when `GOOGLE_VOICE_REFRESH_TOKEN` is set and the Voice log line is within 30 seconds. That phone should match `customers` or `jobber_client_id`. Keyword stays empty: `call_view` does not return it.

### 3. Test booking

In Jobber, schedule a job for a client whose phone or email matches a lead that has a real `ga_client_id` (not a test gclid alone). Wait for the 15-minute cron, or:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://jobs.scwellservice.com/api/cron/sync-jobber-book-jobs
```

The `book_job_conversions` row for that job has `sent_to_google = true`, `client_id_source = ga_client_id`, and `value_usd` from the invoice pre-tax amount when an invoice exists. A scheduled job with no real client id has `sent_to_google = false` and a `skip_reason`. Its `client_id` is null. It must not start with `last-resort.`.

Then run the offline cron while `ADS_OFFLINE_UPLOAD` is unset or `dry_run`:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://jobs.scwellservice.com/api/cron/ads-offline-conversions
```

A booked job that matches the test click id, the google_ads customer, or the ads call gets an `ads_offline_conversions` row with `status = dry_run` and a payload `order_id` equal to the Jobber job id. Confirm no Google Ads upload in the response (`uploaded: 0`). Turn on `ADS_OFFLINE_UPLOAD=live` only after you have read those rows and created the upload-clicks conversion action in the Ads UI. Leave that action out of the primary "Conversions" column until you decide whether `book_job` or the offline action should bid, so the same job is not counted twice.

Monday's report (or `GET /api/cron/ads-closed-loop` with the cron secret) emails the table. The test invoice should sit on `google_ads` / `Search-1` / `well pump`. Shop invoices with no lead and no ads call sit on `unattributed`.

## Tests

```bash
npm test
```

The suites cover the cookie, form-encoded bodies, lead tagging, book_job send gate, invoice value, the offline builder, dry-run (no upload call), call matching, the closed-loop table, and the read-only Jobber and Ads queries.
