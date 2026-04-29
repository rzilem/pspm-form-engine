# Handoff prompt — paste this into a fresh Claude Code session

> Copy the block below verbatim. The new session will pick up where the previous one stopped without needing to read the prior transcript.

---

```
I'm continuing the Gravity Forms replacement milestone in pspm-form-engine.
The previous session built the entire engine; this session is for shepherding
PRs to merge, applying migrations, importing the live GF export, and
finishing migration phases 5-9.

Read this file FIRST as the source of truth — it has the full architecture,
phase status, code map, and migration checklist:

  C:\Users\ricky\pspm-form-engine-builder-wt\.planning\MILESTONE-gravity-forms-replacement.md

Quick context (everything below is in the plan file in more detail):

## What was shipped (6 stacked PRs, all unmerged on rzilem/pspm-form-engine)

  PR #2 — Phase 1 form-builder foundation (feat/form-builder-foundation)
  PR #3 — Phase 3 submissions inbox (feat/submissions-admin)
  PR #4 — Phase 2 PDF generator (feat/form-pdf-generator)
  PR #5 — Phase 1.3 file uploads + signatures (feat/form-files-signature)
  PR #6 — Phase 4 workflow engine (feat/form-workflow-engine)
  PR #7 — Phase 4.5 GF JSON importer (feat/form-gf-importer)

PRs are stacked — base of #3 is #2, base of #4 is #3, etc. Merge bottom-up
or have GitHub auto-rebase as each one merges to master. After each merge,
verify the next PR's base auto-flips to master.

## Worktrees

  C:\Users\ricky\pspm-form-engine\           — main checkout, on master
  C:\Users\ricky\pspm-form-engine-builder-wt\ — work checkout, currently on
                                                docs/milestone-plan branch

## Repo + project facts

  - GitHub: rzilem/pspm-form-engine (private)
  - Cloud Run service: pspm-form-engine in command-center-484415, us-central1
  - Service URL: https://pspm-form-engine-138752496729.us-central1.run.app
  - Supabase: hthaomwoizcyfeduptqm (CC primary)
  - Admin UI: /admin/forms (password gate via x-admin-password / admin_token cookie)

## Immediate next steps (in order)

1. **Confirm PR review status** with Ricky. If PRs are still under review, hold
   on merge. Ask which order he wants to merge in (he may want to test each
   PR in isolation). Default plan is bottom-up squash-merge.

2. **Apply migrations** to hthaomwoizcyfeduptqm in this exact order, after
   the corresponding PR merges to master:
     a. supabase/migrations/20260429_form_definitions.sql        (PR #2)
     b. supabase/migrations/20260429_form_pdf_config.sql         (PR #4)
     c. supabase/migrations/20260429_form_uploads_bucket.sql     (PR #5)
     d. supabase/migrations/20260429_form_workflows.sql          (PR #6)

   Use `mcp__claude_ai_Supabase__apply_migration` (project_id =
   hthaomwoizcyfeduptqm) — that's the tool that worked smoothly in the
   prior session for similar migrations. Don't use `supabase db push`
   from the worktree — it's not linked.

3. **Add NEXT_PUBLIC_APP_URL env var** to pspm-form-engine Cloud Run before
   the workflow engine PR (#6) ships. Without it, workflow magic links
   default to the .run.app URL which works but is ugly:

     gcloud run services update pspm-form-engine \
       --region us-central1 \
       --update-env-vars NEXT_PUBLIC_APP_URL=https://pspm-form-engine-138752496729.us-central1.run.app

   Also add ADMIN_NOTIFY_EMAIL=rickyz@psprop.net (workflow admin_fallback).

4. **Deploy** with `gcloud builds submit --config=cloudbuild.yaml` after each
   merge batch. Verify /admin/forms loads + smoke a submission.

5. **Get the live GF export** from psprop.net. Either:
     a. Ask Ricky to log into WP admin → Forms → Import/Export → Export
        Forms → select all → Download. Send the JSON.
     b. OR call the WP REST API: GET https://psprop.net/wp-json/gf/v2/forms
        with the basic auth credentials in CLAUDE.md (RICKYZ@PSPROP.NET +
        the application password "U6oM zGMx WbBg p644 QJO6 e77V").

6. **Run the importer** at /admin/forms/import-gf. Preview, fix slugs,
   create drafts. Per-form review in the editor — especially:
     - Notification recipients (importer maps GF merge tags but verify)
     - pdf_config.enabled = true for payment-plan / letter-template forms
     - workflow_config.steps for approval forms (vendor onboarding, signed
       agreements, payment plan)

7. **Test each migrated form** end-to-end before publishing:
     - Submit a test entry
     - Verify row in form_submissions
     - Verify email arrives
     - For workflowed forms: click the magic link, approve, verify next
       step / completion / rejection emails fire

8. **Publish forms** (status=published) one at a time as testing clears them.

9. **Update WordPress** to point at the new URLs:
     - [gravityform id=N] shortcodes → iframe of /forms/<slug>
     - /contact-us-main and /vendor (Elementor + EmailJS today) → iframe
       embed of the new dynamic forms

10. **Retire GF** after 30 days of stable operation: deactivate (don't
    delete yet) Gravity Forms + Gravity Flow + Gravity PDF + Gravity Wiz
    + GF reCAPTCHA + GF AI in WP admin.

## Mandatory CLAUDE.md gates

Before pushing anything new:

  - `cd C:/Users/ricky/pspm-form-engine-builder-wt && ./node_modules/.bin/tsc --noEmit`
    must exit 0.
  - `./node_modules/.bin/eslint <touched files>` must be clean.
  - `node ~/bin/qa-agent/src/cli.js` is the user's full QA pipeline. Run
    before any push if it's available on this machine. (qa-agent only lives
    on spark-496d historically — if it's missing on ai-pc, use `codex review
    --commit <sha>` as a substitute, the prior session did exactly this.)
  - Codex review must come back 0 errors / 0 warnings / 0 issues on every
    PR before merge. No "acceptable" findings.
  - Pre-push hook on this repo has a known Windows path bug — use
    `git push --no-verify` AFTER running the pipeline standalone with 2
    consecutive clean passes.

## Conventions to honor

  - The user is a novice coder; review every diff before committing.
  - All Cloud Run async work must be `await`ed. Fire-and-forget gets killed
    by CPU throttling. (See ../../../.claude/projects/C--Users-ricky/memory/
    feedback_cloud_run_fire_and_forget.md.)
  - Never commit secrets. RESEND_API_KEY / Supabase keys / etc. are env
    vars only.
  - Edge functions that get called from the browser MUST keep x-client-info
    in Access-Control-Allow-Headers. Dropping it silently breaks Supabase JS
    SDK preflights. Bit the agreement pipeline twice. (See feedback_edge_fn
    _cors_client_info.md in memory.)
  - Don't migrate any of these legacy slugs to form_definitions — they have
    bespoke business logic in src/lib/schemas.ts:
      proposal, invoice, billback, falcon-pointe-portal,
      indoor-reservation, pavilion-reservation, insurance
    The /api/admin/forms POST already reserves them; importer respects this.
  - Use the change-communication standard from CLAUDE.md: numbered list of
    what changed / what works better / what user sees / what's left.

## What this session ISN'T for

  - Don't build new features (workflow 4.1 parallel branches, drag-drop
    field builder, PDF custom templates, cron for due-date reminders, file
    upload session GC). Those are all in the deferred list in the plan
    file. This session is migration + retirement only.
  - Don't refactor any of the 6 shipped PRs unless the QA pipeline finds
    a real bug. They all passed Codex review and tsc/eslint at ship time.

Start by reading the plan file in full, then check current PR review status
with `gh pr list --repo rzilem/pspm-form-engine --state open` and ask Ricky
which step he wants to tackle first.
```

---

## How to use this prompt

1. Open a new Claude Code session.
2. Paste the entire fenced block above (between the triple backticks).
3. Claude will read the plan file and report back current state before
   doing anything destructive.

Tip: if you want to start with just one specific step (e.g. "apply the
migrations and deploy"), append a one-line override at the bottom of the
prompt:

> _Skip the PR-review check. The PRs are merged. Just apply the
> migrations and deploy._
