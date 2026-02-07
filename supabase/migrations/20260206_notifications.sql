-- In-App Notifications System
-- Real-time alerts for calls, bookings, tasks, etc.

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    
    -- Notification content
    type VARCHAR(50) NOT NULL, -- 'call', 'booking', 'task', 'payment', 'system'
    title VARCHAR(255) NOT NULL,
    message TEXT,
    
    -- Link to related entity
    entity_type VARCHAR(50), -- 'customer', 'job', 'quote', 'invoice', 'booking_request'
    entity_id UUID,
    
    -- Status
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMPTZ,
    
    -- Priority for sorting/highlighting
    priority VARCHAR(20) DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for fast queries
CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, read) WHERE read = FALSE;
CREATE INDEX idx_notifications_created ON notifications(created_at DESC);
CREATE INDEX idx_notifications_type ON notifications(type);

-- RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notifications
CREATE POLICY "Users can view own notifications" ON notifications
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications" ON notifications
    FOR UPDATE USING (auth.uid() = user_id);

-- Service role can insert for any user
CREATE POLICY "Service can insert notifications" ON notifications
    FOR INSERT WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

COMMENT ON TABLE notifications IS 'In-app notification system for real-time alerts';
