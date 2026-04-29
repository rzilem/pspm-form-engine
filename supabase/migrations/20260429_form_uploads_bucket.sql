-- Phase 1.3: file_upload + signature field types for dynamic forms.
--
-- Storage strategy:
--   - Private 'form-uploads' bucket (NOT public — vendor insurance certs
--     and similar sensitive docs go here).
--   - Files keyed by `<form_slug>/<upload_session>/<filename>` so the
--     submission row stores a path, and the admin viewer mints a
--     short-lived signed URL on demand.
--   - 25MB cap per file. Allowed mime types deliberately broad to cover
--     intake forms; tighten per-field via FieldDefinition.validation
--     in a follow-up.
--
-- Signatures use a separate path: stored inline as a PNG data URL in the
-- submission data jsonb. They're typically <50KB, so the 1MB jsonb soft
-- limit isn't a concern. Future Phase 1.4 may flip them to bucket
-- storage if signature counts grow.

-- Bucket creation is idempotent — Supabase migrations re-run on every
-- `db push` and we can't use `IF NOT EXISTS` on storage.buckets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'form-uploads',
  'form-uploads',
  false,
  26214400,                            -- 25 MB
  ARRAY[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/heic',
    'image/heif',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/plain'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS on storage.objects is the universal Supabase Storage pattern.
-- - Public anon: NO read (private bucket).
-- - Public anon: insert allowed but only into the form-uploads bucket
--   AND only into the upload-sessions/ prefix. The /api/upload route
--   acts as a gate that validates the form_slug + session before passing
--   the file through; service role bypasses these policies anyway, so
--   this RLS exists primarily as defense-in-depth if a future bug
--   exposes the public client to direct uploads.
-- - Service role (admin): full access for signed-URL generation +
--   moving files from the upload-sessions/ prefix to the canonical
--   <form_slug>/<submission_id>/ prefix on submit.

-- Drop existing policies so re-runs don't error on duplicate names.
DROP POLICY IF EXISTS "form-uploads anon insert into upload-sessions"
  ON storage.objects;
DROP POLICY IF EXISTS "form-uploads service-role full access"
  ON storage.objects;

CREATE POLICY "form-uploads anon insert into upload-sessions"
  ON storage.objects
  FOR INSERT
  TO anon
  WITH CHECK (
    bucket_id = 'form-uploads'
    AND (storage.foldername(name))[1] = 'upload-sessions'
  );

CREATE POLICY "form-uploads service-role full access"
  ON storage.objects
  FOR ALL
  TO service_role
  USING (bucket_id = 'form-uploads')
  WITH CHECK (bucket_id = 'form-uploads');
