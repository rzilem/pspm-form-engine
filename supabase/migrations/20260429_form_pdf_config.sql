-- Phase 2: PDF generator support
-- Adds pdf_config to form_definitions so admins can opt forms into
-- per-submission PDF generation (replaces Gravity PDF for dynamic forms).
--
-- Shape:
--   { "enabled": true|false, "template": "default", "options": {...} }
--
-- Generated PDF is attached to the admin notification email. Storage to
-- Supabase form-pdfs bucket is left for Phase 2.1 (signed-URL download).

ALTER TABLE form_definitions
  ADD COLUMN IF NOT EXISTS pdf_config jsonb NOT NULL DEFAULT '{"enabled":false}'::jsonb;

-- Add pdf_url to form_submissions so a future Phase 2.1 storage path can
-- record where the rendered PDF lives (signed URL or GCS path). Nullable
-- for v1 since the PDF currently lives only in the email attachment.
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS pdf_url text;
