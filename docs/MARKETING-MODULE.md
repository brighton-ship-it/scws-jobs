# SCWS Marketing Module

Email and SMS campaign management integrated into the SCWS Jobs CRM.

## Features

- **Campaign Management**: Create, schedule, and send email/SMS campaigns
- **Templates**: Reusable message templates with variable substitution
- **Segments**: Target customers by location, service history, spend, etc.
- **Analytics**: Track opens, clicks, deliveries, and replies

## Pages

- `/marketing` - Campaign list and stats
- `/marketing/templates` - Email & SMS template management
- `/marketing/segments` - Customer segment management
- `/marketing/campaigns/new` - Create new campaign
- `/marketing/campaigns/[id]` - Edit/view campaign

## Database Setup

Run the migration on your Supabase project:

### Option 1: Supabase Dashboard

1. Go to https://supabase.com/dashboard/project/htzsnpqrrrdfleldgybn/sql/new
2. Copy contents of `supabase/migrations/20260202_marketing_tables.sql`
3. Run the SQL

### Option 2: Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Link to your project
supabase link --project-ref htzsnpqrrrdfleldgybn

# Run migrations
supabase db push
```

## Environment Variables

Add to `.env.local`:

```env
# For server-side API routes (admin operations)
SUPABASE_SERVICE_KEY=your-service-role-key

# For Twilio SMS (optional)
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# For SendGrid Email (optional)
SENDGRID_API_KEY=your-api-key
SENDGRID_FROM_EMAIL=noreply@scwellservice.com
```

Get your service role key from:
https://supabase.com/dashboard/project/htzsnpqrrrdfleldgybn/settings/api

## API Routes

### Campaigns
- `GET /api/marketing/campaigns` - List campaigns
- `POST /api/marketing/campaigns` - Create campaign
- `POST /api/marketing/campaigns/[id]/send` - Send campaign

### Templates
- `GET /api/marketing/templates` - List templates
- `POST /api/marketing/templates` - Create template

### Segments
- `GET /api/marketing/segments` - List segments
- `POST /api/marketing/segments` - Create segment

## Default Templates (Auto-seeded)

### Email
1. Appointment Reminder - 24hr
2. Appointment Confirmation
3. Quote Follow-up
4. Annual Maintenance Reminder

### SMS
1. Appointment Reminder - 24hr
2. Tech On The Way
3. Quote Ready
4. Payment Link
5. Review Request

## Default Segments (Auto-seeded)

1. All Customers
2. Active Customers (service in past 12 months)
3. Last Service > 6 Months
4. Ramona Area
5. Anza Service Area
6. High Value Customers ($5k+ spend)
7. Open Quotes > 7 Days
8. Well Drilling Customers
9. Pump Repair Customers
10. Tomorrow Appointments (dynamic)

## Template Variables

Use `{{variable_name}}` in templates:

### Customer
- `{{customer_name}}` - Full name
- `{{customer_email}}` - Email address
- `{{address}}` - Service address
- `{{phone}}` - Phone number

### Appointment
- `{{appointment_date}}` - Date (formatted)
- `{{appointment_time}}` - Time
- `{{service_type}}` - Service description
- `{{tech_name}}` - Assigned technician

### Financial
- `{{quote_amount}}` - Quote total
- `{{invoice_number}}` - Invoice #
- `{{amount}}` - Payment amount
- `{{payment_link}}` - Secure payment URL

### Email-specific
- `{{unsubscribe_link}}` - Opt-out link

## Sending Implementation

Currently the send endpoint is a stub. To enable actual sending:

### Twilio (SMS)
```typescript
import twilio from 'twilio'

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

await client.messages.create({
  body: messageContent,
  to: customer.phone,
  from: process.env.TWILIO_PHONE_NUMBER
})
```

### SendGrid (Email)
```typescript
import sgMail from '@sendgrid/mail'

sgMail.setApiKey(process.env.SENDGRID_API_KEY!)

await sgMail.send({
  to: customer.email,
  from: process.env.SENDGRID_FROM_EMAIL!,
  subject: campaign.subject,
  html: emailContent
})
```

## Next Steps

1. [ ] Run Supabase migration
2. [ ] Add SUPABASE_SERVICE_KEY to env
3. [ ] Wire UI to real APIs (replace mock data)
4. [ ] Set up Twilio account for SMS
5. [ ] Set up SendGrid for email
6. [ ] Add webhook handlers for delivery status
7. [ ] Build analytics dashboard
