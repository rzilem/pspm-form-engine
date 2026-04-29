-- Phase 4: workflow engine for dynamic forms.
--
-- Replaces Gravity Flow's "submit → approver → counter-approver → done"
-- pipelines. Stays in form_submissions where possible (one row per
-- submission, current_step + history) and uses a separate token table
-- for the magic-link decide URLs so they can be revoked individually
-- without rewriting JSONB.
--
-- Goals (v1):
--   - Sequential ordered steps. Parallel + conditional branching is
--     scheduled for 4.1.
--   - One assignee per step. Resolved from a literal email, a
--     {{field.<id>}} token in submission data, or a fallback to a
--     fixed admin address.
--   - Approve / Reject / Comment-and-loop-back. Comments saved on every
--     decision so the audit trail explains the why, not just the what.
--   - Magic-link tokens (random 32 bytes hex) so approvers don't need
--     a portal login. Single-use, 30-day expiry, revocable.
--   - Full history on the submission row so the admin viewer renders
--     a vertical timeline without joining other tables.

-- ── workflow_config on form_definitions ────────────────────────────────
-- Shape (validated by Zod in src/lib/form-definitions.ts):
--   {
--     enabled: boolean,
--     steps: [
--       {
--         id: string,                       -- stable; referenced by history rows
--         label: string,                    -- "Manager review"
--         assignee: {
--           type: "literal" | "field_email" | "admin_fallback",
--           email?: string,                 -- when type='literal'
--           fieldId?: string                -- when type='field_email'
--         },
--         actions: ("approve" | "reject" | "comment")[],
--         due_in_days?: number,             -- emit reminder if not actioned
--         email_subject?: string            -- per-step override
--       }
--     ]
--   }
ALTER TABLE public.form_definitions
  ADD COLUMN IF NOT EXISTS workflow_config jsonb NOT NULL DEFAULT '{"enabled": false, "steps": []}'::jsonb;

-- ── workflow_state on form_submissions ─────────────────────────────────
-- Drives the UI status pill on /admin/submissions and the timeline on
-- the detail viewer.
--   {
--     status: "pending" | "in_progress" | "completed" | "rejected" | "expired",
--     current_step_id: string | null,
--     history: [
--       { step_id, action, actor_email, actor_label, comments, decided_at }
--     ],
--     started_at: string,                   -- ISO when first kickoff fired
--     completed_at?: string                 -- ISO when last step approved or any reject
--   }
ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS workflow_state jsonb;

-- ── workflow_actions: magic-link tokens ────────────────────────────────
-- Each pending step issues one (or more, on resend) tokens. Rows are
-- soft-deleted via `revoked_at` so the audit trail keeps the record;
-- consumed_at marks the single-use boundary.
CREATE TABLE IF NOT EXISTS public.workflow_actions (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid          NOT NULL REFERENCES public.form_submissions(id) ON DELETE CASCADE,
  step_id       text          NOT NULL,
  assignee_email text         NOT NULL,
  token_hash    text          NOT NULL UNIQUE,   -- sha256(token); never store the token
  expires_at    timestamptz   NOT NULL,
  consumed_at   timestamptz,
  consumed_action text,                          -- "approve" | "reject" | "comment"
  consumed_by_email text,
  consumed_by_ip text,
  revoked_at    timestamptz,
  created_at    timestamptz   NOT NULL DEFAULT now()
);

-- Lookups by submission for the admin timeline; lookups by token_hash
-- via the unique index above are the hot path for /api/workflow/decide.
CREATE INDEX IF NOT EXISTS workflow_actions_submission_id_idx
  ON public.workflow_actions (submission_id);
CREATE INDEX IF NOT EXISTS workflow_actions_pending_idx
  ON public.workflow_actions (submission_id, step_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

-- RLS: anon must NOT read or write workflow_actions directly. The decide
-- endpoint validates the token server-side via service role; the admin
-- UI also goes through API routes so direct table access stays closed.
ALTER TABLE public.workflow_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow_actions service role only" ON public.workflow_actions;
CREATE POLICY "workflow_actions service role only"
  ON public.workflow_actions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
