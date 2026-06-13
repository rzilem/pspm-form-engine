-- Wave 8: Submission limits (Gravity Wiz Limit Submissions parity)
-- Form-level max entries + open/close scheduling. Off by default (empty jsonb).

ALTER TABLE form_definitions
  ADD COLUMN IF NOT EXISTS submission_limit jsonb NOT NULL DEFAULT '{}'::jsonb;