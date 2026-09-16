# Internal Jobber quote GP tracker

Office-only page for Brighton to scan Jobber quotes against a **60% GP** target without opening Jobber one by one.

## Open it

- URL: `/ops/quotes-gp` on this Next app (not scwellservice.com).
- Sign in to the CRM (same session as other admin/ops routes), **or**
- Set `QUOTES_GP_KEY` in Vercel and open `/ops/quotes-gp?key=<QUOTES_GP_KEY>`.

`ADMIN_SECRET` is accepted if `QUOTES_GP_KEY` is unset.

Uses the shared Jobber GraphQL client (`src/lib/jobber/client.ts`), so Production reads/refreshes tokens from the durable Supabase store. `JOBBER_ACCESS_TOKEN` is bootstrap only; see `docs/jobber-mcp.md`.

## Rules

- Read-only. Does not send quotes, edit Jobber, or raise street prices.
- FLAG / GP / costs stay on this page and Jobber internal notes. Never on quote titles, messages, or client Hub copy.
- Missing cost is **unknown**. No invented mud $95/ft or tank $10,738.
- Street prices stay street.

## Auth env vars

| Name | Role |
| --- | --- |
| `QUOTES_GP_KEY` | Office key (`?key=`, header `x-quotes-gp-key`, cookie `quotes_gp_key`) |
| `ADMIN_SECRET` | Fallback office key |
| `JOBBER_ACCESS_TOKEN` | Live Jobber GraphQL |
