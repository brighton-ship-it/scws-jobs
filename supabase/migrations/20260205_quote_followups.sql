-- Quote follow-up tracking
CREATE TABLE IF NOT EXISTS public.quote_followups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
    followup_number INT NOT NULL, -- 1=Day 2, 2=Day 7, 3=Day 14
    followup_type TEXT NOT NULL CHECK (followup_type IN ('email', 'sms')),
    sent_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(quote_id, followup_number)
);

-- Index for finding pending follow-ups
CREATE INDEX IF NOT EXISTS idx_quote_followups_pending 
    ON public.quote_followups(quote_id, followup_number) 
    WHERE sent_at IS NULL;

-- Quote follow-up templates
CREATE TABLE IF NOT EXISTS public.quote_followup_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    followup_number INT NOT NULL UNIQUE,
    days_after_quote INT NOT NULL,
    email_subject TEXT NOT NULL,
    email_body TEXT NOT NULL,
    sms_body TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Seed default templates
INSERT INTO public.quote_followup_templates (followup_number, days_after_quote, email_subject, email_body, sms_body)
VALUES 
(1, 2, 
 'Quick question about your well service quote',
 'Hi {{customer_name}},

Just checking in on the quote we sent over for {{service_description}}. 

Do you have any questions I can answer? Happy to walk through the options or adjust anything to fit your needs.

You can view your quote here: {{quote_link}}

Best,
Southern California Well Service
(760) 440-8520',
 'Hi {{customer_name}}, this is SCWS. Any questions on the quote we sent? Happy to help - just reply or call (760) 440-8520'),

(2, 7,
 'Following up on your well service quote - {{quote_number}}',
 'Hi {{customer_name}},

I wanted to follow up on the quote we sent last week for {{service_description}}.

We''re booking about {{lead_time}} out right now, so I wanted to check if you''d like to get on the schedule.

Your quote is still available here: {{quote_link}}

Let me know if you have any questions or if pricing is a concern - we may have some options.

Best,
Southern California Well Service
(760) 440-8520',
 'Hi {{customer_name}}, following up on your SCWS quote from last week. Ready to schedule? Reply or call (760) 440-8520'),

(3, 14,
 'Last check-in: Your well service quote',
 'Hi {{customer_name}},

This is my final follow-up on the quote for {{service_description}}.

If now isn''t the right time, no worries - just let me know and I''ll make a note to check back later.

If you''d like to move forward, your quote is here: {{quote_link}}

Thanks,
Southern California Well Service
(760) 440-8520',
 'Hi {{customer_name}}, last check on your SCWS quote. Still interested? If not, no problem - just let me know. (760) 440-8520')
ON CONFLICT (followup_number) DO NOTHING;

-- RLS
ALTER TABLE public.quote_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_followup_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and office can manage followups" ON public.quote_followups
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );

CREATE POLICY "Admin and office can manage templates" ON public.quote_followup_templates
    FOR ALL USING (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('admin', 'office'))
    );
