-- Website Live Chat Tables
-- Stores chat sessions and messages from website visitors

-- ============================================
-- CHAT SESSIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(100) UNIQUE NOT NULL,
  
  -- Visitor Info
  visitor_name VARCHAR(255),
  visitor_email VARCHAR(255),
  visitor_phone VARCHAR(20),
  visitor_ip VARCHAR(45),
  page_url TEXT,
  
  -- Status & Flags
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'closed', 'converted')),
  is_urgent BOOLEAN DEFAULT FALSE,
  has_contact_info BOOLEAN DEFAULT FALSE,
  
  -- Conversion Tracking
  customer_id UUID REFERENCES customers(id),
  converted_at TIMESTAMPTZ,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CHAT MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(100) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
  
  -- Message
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_id ON chat_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON chat_sessions(status);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_urgent ON chat_sessions(is_urgent) WHERE is_urgent = TRUE;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created ON chat_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION update_chat_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chat_sessions_updated_at ON chat_sessions;
CREATE TRIGGER chat_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_sessions_updated_at();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE chat_sessions IS 'Website live chat sessions with visitors';
COMMENT ON TABLE chat_messages IS 'Individual messages in chat sessions';
COMMENT ON COLUMN chat_sessions.is_urgent IS 'Flagged when visitor mentions emergency/no water';
COMMENT ON COLUMN chat_sessions.has_contact_info IS 'Flagged when visitor provides phone/email';
