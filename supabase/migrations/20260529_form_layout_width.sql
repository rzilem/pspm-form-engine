-- Phase 1: per-form layout width.
-- Adds `width` to form_definitions so a form can render near-full-width when
-- embedded on a page ("full") or keep a readable max-width ("boxed").
--
-- Default "full": existing rows and new forms embed edge-to-edge to fill the
-- host container; admins opt a specific form into "boxed" when it's meant to
-- be constrained. The renderer (/forms/[slug]) and FormLayout read this.

ALTER TABLE form_definitions
  ADD COLUMN IF NOT EXISTS width text NOT NULL DEFAULT 'full'
    CHECK (width IN ('full', 'boxed'));
