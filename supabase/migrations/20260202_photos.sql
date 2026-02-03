-- Job Photos / Attachments
-- Before/after photos, receipts, documents

-- ============================================
-- JOB ATTACHMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS job_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  
  -- File info
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50), -- image/jpeg, application/pdf, etc.
  file_size INTEGER, -- bytes
  storage_path VARCHAR(500) NOT NULL, -- Supabase Storage path
  public_url VARCHAR(500),
  
  -- Metadata
  category VARCHAR(50) DEFAULT 'general' CHECK (category IN ('before', 'after', 'receipt', 'document', 'general')),
  caption TEXT,
  
  -- Who uploaded
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- QUOTE ATTACHMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS quote_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  storage_path VARCHAR(500) NOT NULL,
  public_url VARCHAR(500),
  
  caption TEXT,
  
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CUSTOMER DOCUMENTS
-- ============================================
CREATE TABLE IF NOT EXISTS customer_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  property_id UUID REFERENCES properties(id),
  
  filename VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  file_size INTEGER,
  storage_path VARCHAR(500) NOT NULL,
  public_url VARCHAR(500),
  
  -- Document type
  document_type VARCHAR(50) DEFAULT 'general' CHECK (document_type IN ('well_log', 'permit', 'water_test', 'invoice', 'contract', 'general')),
  description TEXT,
  
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_job_attachments_job ON job_attachments(job_id);
CREATE INDEX idx_job_attachments_category ON job_attachments(category);
CREATE INDEX idx_quote_attachments_quote ON quote_attachments(quote_id);
CREATE INDEX idx_customer_documents_customer ON customer_documents(customer_id);
CREATE INDEX idx_customer_documents_property ON customer_documents(property_id);
CREATE INDEX idx_customer_documents_type ON customer_documents(document_type);
