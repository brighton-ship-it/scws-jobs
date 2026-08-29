# SCWS Job Management System

A modern job management system for Southern California Well Service, built with Next.js 14, Supabase, and Tailwind CSS.

## Features

- **Dashboard** - Overview of daily jobs, active work, and pending invoices
- **Customer Management** - Track customers, properties, and well information
- **Job Scheduling** - Create, schedule, and assign jobs to field crew
- **Dispatch Board** - Drag-and-drop job assignment with map view
- **Quotes** - Create and track customer quotes
- **Invoicing** - Generate and manage invoices
- **Reports** - Business analytics and insights
- **Settings** - Team management and configuration

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **Styling**: Tailwind CSS
- **UI Components**: Custom component library
- **Drag & Drop**: @dnd-kit
- **Forms**: React Hook Form + Zod
- **Date Handling**: date-fns

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account (optional - app works with mock data)

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd scws-jobs
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy environment file:
   ```bash
   cp .env.example .env.local
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

### Demo Mode

Without Supabase credentials configured, the app runs in demo mode with mock data. This is perfect for:
- Exploring the UI
- Development without database setup
- Testing features

Any email/password combination works for login in demo mode.

## Supabase Setup

To connect to a real database:

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Note your project URL and anon key

### 2. Configure Environment

Update `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Run Migrations

In the Supabase SQL Editor, run the migrations in order:

1. `supabase/migrations/001_initial_schema.sql` - Creates all tables
2. `supabase/migrations/002_seed_job_types.sql` - Adds job type definitions
3. `supabase/migrations/003_seed_data.sql` - Adds sample data (optional)

Or use the Supabase CLI:
```bash
supabase db push
```

### 4. Create Initial User

1. In Supabase Dashboard, go to Authentication > Users
2. Click "Add user" and create an admin account
3. Copy the user's UUID
4. In SQL Editor, run:
   ```sql
   INSERT INTO public.users (id, email, name, role, phone) 
   VALUES ('user-uuid-here', 'admin@example.com', 'Admin', 'admin', '555-0100');
   ```

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/            # Authentication routes
│   │   └── login/
│   ├── (dashboard)/       # Protected dashboard routes
│   │   ├── customers/
│   │   ├── jobs/
│   │   ├── schedule/
│   │   ├── dispatch/
│   │   ├── quotes/
│   │   ├── invoices/
│   │   ├── reports/
│   │   └── settings/
│   └── layout.tsx
├── components/
│   ├── ui/                # Base UI components
│   ├── forms/             # Form components
│   ├── layout/            # Layout components (Sidebar, Header)
│   ├── navigation/        # Navigation components
│   ├── feedback/          # Modals, toasts, spinners
│   └── data-display/      # Cards, badges, tables
├── contexts/
│   └── AuthContext.tsx    # Authentication state
├── lib/
│   ├── supabase/          # Supabase client setup
│   ├── api/               # API functions
│   └── mock-data.ts       # Demo/development data
├── types/
│   └── database.ts        # TypeScript types
└── hooks/                 # Custom React hooks
```

## Development

### Available Scripts

```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

### Adding New Features

1. Create page in `src/app/(dashboard)/feature/page.tsx`
2. Add navigation in `src/components/layout/Sidebar.tsx`
3. Add types in `src/types/database.ts`
4. Add API functions in `src/lib/api/`

### Database Changes

1. Create new migration file in `supabase/migrations/`
2. Add corresponding TypeScript types
3. Update API functions as needed

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import to Vercel
3. Add environment variables (see `.env.example`)
4. Deploy

**Production cron (`/api/cron/*`, including Jobber `book_job`):** `CRON_SECRET` must exist in the Vercel **Production** environment (variable name only — never commit the value). Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` and `x-vercel-cron`. Vercel Authentication (SSO) on this project must stay **Preview only** — there is no custom domain, so SSO on `*.vercel.app` 401s cron at the edge.

**Click-id / `book_job` SQL:** if `booking_requests` is missing `ga_client_id` (PGRST204), a human must run `supabase/migrations/20260827_book_job_click_ids_and_conversions.sql` in the Supabase SQL Editor. Do not apply it from this repo.

### Other Platforms

Build the production bundle:
```bash
npm run build
```

The output is in `.next/` directory.

## License

Private - Southern California Well Service

## Support

For issues or questions, contact the development team.
# Deployed Tue Feb  3 21:31:05 PST 2026
# Redeploy with fixed Supabase key - Tue Feb  3 21:37:14 PST 2026
