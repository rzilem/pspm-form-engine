-- Wave 7: Save & Continue (Gravity Forms "Save and Continue" parity)
-- In-progress submissions stored server-side; resume via unguessable token link.
-- Off by default per form (save_resume_enabled = false).

ALTER TABLE form_definitions
  ADD COLUMN IF NOT EXISTS save_resume_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS form_partials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       uuid NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE,
  slug          text NOT NULL,
  resume_token  text NOT NULL UNIQUE,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_page  int,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX IF NOT EXISTS idx_form_partials_resume_token
  ON form_partials(resume_token);

CREATE INDEX IF NOT EXISTS idx_form_partials_slug_token
  ON form_partials(slug, resume_token);

ALTER TABLE form_partials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "form_partials_deny_anon" ON form_partials;
CREATE POLICY "form_partials_deny_anon"
  ON form_partials FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "form_partials_deny_authenticated" ON form_partials;
CREATE POLICY "form_partials_deny_authenticated"
  ON form_partials FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION form_partials_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS form_partials_updated_at ON form_partials;
CREATE TRIGGER form_partials_updated_at
  BEFORE UPDATE ON form_partials
  FOR EACH ROW
  EXECUTE FUNCTION form_partials_set_updated_at();