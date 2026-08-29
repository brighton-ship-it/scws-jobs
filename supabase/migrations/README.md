# Supabase migrations

SQL in this folder is **not** applied automatically from the app or from Vercel.

If a migration is not in the production schema, open the **Supabase SQL Editor** for the project, paste the file, and run it.

## `20260827_book_job_click_ids_and_conversions.sql`

Adds `gclid` / `gbraid` / `wbraid` / `ga_client_id` / `ga_session_id` on `booking_requests` and `customers`, plus `book_job_conversions` and `jobber_job_schedule_state`.

Until this is applied, website booking still saves the lead (without those columns) and Jobber `book_job` cannot persist conversions. There is no service-role “apply from git” in this repo.
