# Crew Tracking & Tech Performance Dashboard

This feature adds crew role tracking and a tech performance dashboard to the SCWS CRM.

## What Was Built

### 1. Database Migration
**File:** `supabase/migrations/20260318_crew_tracking.sql`

Adds to `jobs` table:
- `crew_lead_id` - Lead tech who gets revenue credit
- `crew_helper_id` - Optional helper
- `completed_by_id` - Who actually completed the work
- `crew_type` - Auto-set: solo, two_man, or drill

Adds to `team_members` table:
- `hourly_rate` - Pay rate for margin calculations
- `tech_type` - Role classification (service, pump_lead, mixed, driller, helper, office, sales)

Creates `tech_performance_monthly` table for aggregated stats.

### 2. API Routes

**GET `/api/team-performance`**
- Query params: `month` (YYYY-MM), `team_member_id`, `start_date`, `end_date`
- Returns: Summary stats + per-tech performance data with margins

**POST `/api/team-performance/recalc`**
- Body: `{ months: 12 }` or `{ month: "2026-03" }`
- Recalculates monthly performance from job/invoice data

### 3. Dashboard Page
**Route:** `/team-performance`

Features:
- Month selector + time range options (3M, 6M, 1Y, All)
- Summary cards: Total Revenue, Avg Margin, Total Visits, Avg Ticket
- Revenue by Tech bar chart
- Crew Economics pie chart (Solo vs Two-Man jobs)
- Sortable tech performance table with expandable details
- Color-coded margins: green >45%, yellow 30-45%, red <30%

### 4. Job Form Updates
The JobForm already includes:
- **Crew Lead** dropdown (required) - gets revenue credit
- **Helper** dropdown (optional) - creates two-man crew

Crew type auto-detects:
- `solo` - Lead only, no helper
- `two_man` - Lead + helper
- `drill` - Job type contains "drill"

### 5. API Updates
- Jobs POST/PATCH routes now handle crew fields
- Jobs GET includes crew_lead and crew_helper joins

### 6. Navigation
Team Performance added to sidebar under Operations (UserCheck icon)

## Installation

### Step 1: Apply Migration

**Option A: Supabase Dashboard**
1. Go to https://supabase.com/dashboard/project/htzsnpqrrrdfleldgybn/sql
2. Copy contents of `supabase/migrations/20260318_crew_tracking.sql`
3. Paste into SQL Editor and click "Run"

**Option B: Supabase CLI**
```bash
supabase login
supabase link --project-ref htzsnpqrrrdfleldgybn
supabase db push
```

### Step 2: Deploy to Vercel
```bash
cd scws-jobs
npx vercel --prod
```

## Margin Calculation

Formula used for tech margins:

```
Labor Cost = Days Worked × 8 hours × Hourly Rate × 1.3 (loaded rate)
Parts Cost = Parts Revenue × 0.5 (50% markup assumed)
Truck Cost = Days Worked × $80/day
Total Cost = Labor + Parts + Truck
Profit = Revenue - Total Cost
Margin = Profit / Revenue × 100
```

For two-man crews, helper labor cost is included in the calculation.

## Tech Rate Seed Data

| Tech | Hourly Rate | Tech Type |
|------|-------------|-----------|
| Chris Glass | $32 | pump_lead |
| Haze Tarbell | $30 | mixed |
| Brian Eads | $30 | service |
| Cowin | $28 | mixed |
| Marshall Car | $25 | mixed |
| Sergio Valdovinos Mendez | $30 | pump_lead |
| Dakota Cole | $25 | helper |
| Damian Famania | - | driller |
| Dylan J Rabas | - | driller |
| Brian Schroeder | - | sales |
| Austin W Tipton | $25 | helper |

## Notes

- Revenue attribution: Crew lead gets 100% credit, helper is tracked but not double-counted
- The `assigned_to` legacy field is kept in sync with `crew_lead_id` for backwards compatibility
- Performance recalculation can be triggered manually via the Recalculate button
