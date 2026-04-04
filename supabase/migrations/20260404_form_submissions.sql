-- Generic form submissions storage
-- Stores all non-booking form submissions (proposal, invoice, billback, portal)

CREATE TABLE IF NOT EXISTS form_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  form_slug TEXT NOT NULL,
  data JSONB NOT NULL,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_slug ON form_submissions(form_slug);
CREATE INDEX IF NOT EXISTS idx_form_submissions_created ON form_submissions(created_at DESC);

ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;

-- Public insert (form submissions from website)
CREATE POLICY "Public insert submissions" ON form_submissions FOR INSERT WITH CHECK (true);
-- No public read — admin only via service role key
