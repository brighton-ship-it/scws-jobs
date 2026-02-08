-- On-Call Weekend System

-- Settings/configuration for on-call pay
CREATE TABLE IF NOT EXISTS on_call_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  availability_pay_daily DECIMAL(10,2) DEFAULT 75.00,  -- Flat daily rate for being on-call
  callout_multiplier DECIMAL(3,2) DEFAULT 1.50,        -- 1.5x for time and a half
  minimum_callout_hours DECIMAL(4,2) DEFAULT 2.00,     -- Minimum 2-hour callout
  base_hourly_rate DECIMAL(10,2) DEFAULT 30.00,        -- Default hourly if not set per user
  require_one_per_day BOOLEAN DEFAULT true,
  auto_rotate BOOLEAN DEFAULT false,
  notify_days_ahead INTEGER DEFAULT 7,                  -- Notify if gap within X days
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO on_call_settings (id) VALUES (gen_random_uuid()) ON CONFLICT DO NOTHING;

-- On-call slots (each weekend day is a slot)
CREATE TABLE IF NOT EXISTS on_call_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date DATE NOT NULL UNIQUE,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'filled', 'completed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_on_call_slots_date ON on_call_slots(slot_date);
CREATE INDEX idx_on_call_slots_user ON on_call_slots(assigned_user_id);
CREATE INDEX idx_on_call_slots_status ON on_call_slots(status);

-- Signup requests (techs can request slots, admin approves or auto-approve)
CREATE TABLE IF NOT EXISTS on_call_signups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID REFERENCES on_call_slots(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  responded_by UUID REFERENCES users(id),
  notes TEXT,
  UNIQUE(slot_id, user_id)
);

CREATE INDEX idx_on_call_signups_slot ON on_call_signups(slot_id);
CREATE INDEX idx_on_call_signups_user ON on_call_signups(user_id);

-- Callout records (when on-call person actually responds to a call)
CREATE TABLE IF NOT EXISTS on_call_callouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID REFERENCES on_call_slots(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  callout_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  hours_worked DECIMAL(4,2),
  hourly_rate DECIMAL(10,2),
  multiplier DECIMAL(3,2) DEFAULT 1.50,
  total_pay DECIMAL(10,2),
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id)
);

CREATE INDEX idx_on_call_callouts_date ON on_call_callouts(callout_date);
CREATE INDEX idx_on_call_callouts_user ON on_call_callouts(user_id);
CREATE INDEX idx_on_call_callouts_status ON on_call_callouts(status);

-- On-call pay summary (for payroll)
CREATE TABLE IF NOT EXISTS on_call_pay (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  availability_days INTEGER DEFAULT 0,
  availability_pay DECIMAL(10,2) DEFAULT 0,
  callout_hours DECIMAL(6,2) DEFAULT 0,
  callout_pay DECIMAL(10,2) DEFAULT 0,
  total_pay DECIMAL(10,2) DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES users(id),
  UNIQUE(user_id, pay_period_start, pay_period_end)
);

CREATE INDEX idx_on_call_pay_user ON on_call_pay(user_id);
CREATE INDEX idx_on_call_pay_period ON on_call_pay(pay_period_start, pay_period_end);
