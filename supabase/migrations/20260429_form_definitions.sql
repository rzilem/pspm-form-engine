-- Form Builder Foundation (Phase 1)
-- Adds editable form definitions so non-developers can create new forms
-- without coding a Next.js page + Zod schema. Replaces the hand-coded
-- `formSchemas` map at src/app/api/submit/route.ts and the FORM_EMAIL_CONFIG
-- map at src/lib/email.ts for any form whose slug is registered here.
--
-- Hand-coded forms (proposal, invoice, billback, falcon-pointe-portal,
-- indoor-reservation, pavilion-reservation, insurance) continue working
-- exactly as before. The runtime resolver looks them up first; only
-- unknown slugs fall through to form_definitions.

CREATE TABLE IF NOT EXISTS form_definitions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,
  description     text,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','archived')),
  -- Array of field definitions. Each field is an object:
  --   { id, label, type, required, helpText?, validation?, options?,
  --     conditionalOn?: { fieldId, equals } }
  -- Validated client-side and server-side via the FieldDefinition Zod schema
  -- in src/lib/form-definitions.ts.
  field_schema    jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Notification routing rules. Replaces FORM_EMAIL_CONFIG. Shape:
  --   { recipients: string[], subject: string, conditional?: NotificationRule[] }
  -- Recipients can be literal emails or {{field.email}} mustache references.
  notification_config       jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmation_message      text NOT NULL DEFAULT 'Thank you. Your submission has been received.',
  -- reCAPTCHA enforced for any form_definition unless explicitly disabled
  -- (e.g. authenticated portals).
  recaptcha_required        boolean NOT NULL DEFAULT true,
  -- Stored as text to mirror existing admin auth pattern; will move to
  -- M365 SSO in a follow-up phase.
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_form_definitions_status
  ON form_definitions(status) WHERE status = 'published';

ALTER TABLE form_definitions ENABLE ROW LEVEL SECURITY;
-- Public read for published forms only — needed because the dynamic
-- renderer at /forms/[slug] runs server-side with the public anon role
-- in some deploys. Service role retains full access for admin UI.
CREATE POLICY "Public read published definitions"
  ON form_definitions FOR SELECT
  USING (status = 'published');

-- Extend form_submissions with status tracking + definition link.
-- Existing rows get form_definition_id=NULL (legacy hand-coded forms),
-- which is fine because form_slug remains the source of truth.
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS form_definition_id uuid REFERENCES form_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','in_review','completed','spam','archived')),
  ADD COLUMN IF NOT EXISTS reviewer_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text;

CREATE INDEX IF NOT EXISTS idx_form_submissions_status
  ON form_submissions(status) WHERE status != 'archived';
CREATE INDEX IF NOT EXISTS idx_form_submissions_definition
  ON form_submissions(form_definition_id) WHERE form_definition_id IS NOT NULL;

-- Auto-bump updated_at on any UPDATE to form_definitions
CREATE OR REPLACE FUNCTION form_definitions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS form_definitions_updated_at ON form_definitions;
CREATE TRIGGER form_definitions_updated_at
  BEFORE UPDATE ON form_definitions
  FOR EACH ROW
  EXECUTE FUNCTION form_definitions_set_updated_at();
