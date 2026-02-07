-- Create team_members table (separate from auth-linked users table)
-- This allows assigning team members to jobs without requiring them to have auth accounts

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'field',
  phone TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(role);
CREATE INDEX IF NOT EXISTS idx_team_members_active ON team_members(active);

-- Seed initial team
INSERT INTO team_members (email, name, role, phone) VALUES
  ('brighton@scwellservice.com', 'Brighton Scala', 'admin', '(760) 440-8520'),
  ('bschroeder@scwellservice.com', 'Brian Schroeder', 'admin', '(760) 440-8520'),
  ('lizbeth@scwellservice.com', 'Lizbeth Nunez', 'office', '(760) 440-8520'),
  ('roger@scwellservice.com', 'Roger Scala', 'admin', '(760) 440-8520'),
  ('shanicey@scwellservice.com', 'Shanicey Sego', 'admin', '(760) 440-8520'),
  ('travis@scwellservice.com', 'Travis C Sego', 'admin', '(760) 440-8520'),
  ('austin@scwellservice.com', 'Austin W Tipton', 'field', '(760) 440-8520'),
  ('brian@scwellservice.com', 'Brian Eads', 'field', '(760) 440-8520'),
  ('christopher@scwellservice.com', 'Chris Glass', 'field', '(760) 440-8520'),
  ('cowin@scwellservice.com', 'Cowin', 'field', '(760) 440-8520'),
  ('dakota@scwellservice.com', 'Dakota Cole', 'field', '(760) 440-8520'),
  ('damian@scwellservice.com', 'Damian Famania', 'field', '(760) 440-8520'),
  ('dylan@scwellservice.com', 'Dylan J Rabas', 'field', '(760) 440-8520'),
  ('hazemtarbell@gmail.com', 'Haze Tarbell', 'field', '(760) 440-8520'),
  ('jeff@scwellservice.com', 'Jeff Gezewski', 'field', '(760) 440-8520'),
  ('marshall@scwellservice.com', 'Marshall Car', 'field', '(760) 440-8520'),
  ('sergio@scwellservice.com', 'Sergio Valdovinos Mendez', 'field', '(760) 440-8520')
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  phone = EXCLUDED.phone,
  updated_at = now();
