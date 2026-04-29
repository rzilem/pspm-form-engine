# Milestone: Replace Gravity Forms ecosystem on psprop.net

**Status:** engine complete (PRs #2–#7 stacked, unmerged). Migration + retirement remaining.
**Owner:** Ricky Zilem (rzilem@gmail.com)
**Started:** 2026-04-29
**Last updated:** 2026-04-29

## Goal

Replace Gravity Forms + addons (Gravity Flow, Gravity PDF, Gravity Wiz, Gravity Forms AI, Gravity Forms reCAPTCHA) on psprop.net with the in-house `pspm-form-engine` Cloud Run service. Non-developers (Wendy, Christina, Ricky) build forms via an admin UI; submissions flow into a unified inbox in CC Supabase; multi-step approvals replace Gravity Flow; per-submission PDFs replace Gravity PDF.

## Architecture

### Dual-track design

Two paths coexist in `/api/submit`:

1. **Legacy hand-coded slugs** (`proposal`, `invoice`, `billback`, `falcon-pointe-portal`, `indoor-reservation`, `pavilion-reservation`, `insurance`) — keep their per-form Next.js page + Zod schema in `src/lib/schemas.ts`. These ship business logic the form-engine doesn't model (carrier XLSX populator, Stripe payment, CRM intake-lead push). **Don't migrate them to form_definitions.** Reserve the slugs.
2. **Dynamic form_definitions** — one row per form in `form_definitions`. Admin builder UI writes the JSONB `field_schema`/`notification_config`/`pdf_config`/`workflow_config`. Renderer at `/forms/[slug]` reads the row and renders generic widgets. `/api/submit` derives a Zod validator at request time via `buildSubmissionSchema()`.

`/api/submit` checks the legacy map first, then falls through to `loadFormDefinition(slug)`. Unknown slugs 400.

### Storage

- **Supabase project** `hthaomwoizcyfeduptqm` (CC primary).
- `form_definitions` table — one row per form. RLS allows public read of `published` rows.
- `form_submissions` table — one row per submission. Service-role-only writes via `/api/submit`; admin reads via shared password.
- `workflow_actions` table — single-use sha256 token rows for approval magic links. Service-role only.
- `form-uploads` storage bucket — private, 25 MB cap, mime allow-list. Anon insert restricted to `upload-sessions/` prefix. Admin downloads via 5-min signed URLs.

### Email

- **Resend** for all transactional sends. `RESEND_API_KEY` already on Cloud Run.
- `sendFormNotification` resolves: legacy `FORM_EMAIL_CONFIG` first, then dynamic `notification_config` rules. Recipients support `{{field.<id>}}` mustache tokens that resolve to email-shaped values in submission data.
- `sendWorkflowAssignmentEmail` ships at every step transition with branded action URL.
- `sendWorkflowOutcomeEmail` notifies the original submitter on terminal outcomes (resolved via the first `{{field.<id>}}` recipient in `notification_config`).

**Cloud Run gotcha:** every email send is `await`ed. Fire-and-forget gets killed by CPU throttling once the response returns. Bit emails before — see [`feedback_cloud_run_fire_and_forget.md`](../../../.claude/projects/C--Users-ricky/memory/feedback_cloud_run_fire_and_forget.md).

### Workflow engine

Sequential ordered steps. Each step has:
- `id` — stable identifier referenced by audit history rows.
- `assignee` — discriminated union: `{type:"literal",email}` / `{type:"field_email",fieldId}` / `{type:"admin_fallback"}`.
- `actions` — subset of `["approve","reject","comment"]`. Default `["approve","reject"]`.
- `due_in_days` — optional SLA.
- `email_subject` — per-step subject template; supports `{{field.<id>}}` tokens.
- `comment_loop_back` — if true, "comment" sends back to previous step.

State machine: `pending → in_progress → completed | rejected | expired`. State + history persisted on `form_submissions.workflow_state` JSONB.

Magic-link tokens: 32 random bytes hex, sha256 stored, 30-day TTL, single-use. `/workflow/[token]` is a public Next.js page that renders the submission detail and `/api/workflow/decide` is the public token-authenticated endpoint.

**v1 limits** (deferred to 4.1):
- Sequential only — no parallel/conditional branches.
- Tokens single-use even on `comment` decisions; admin needs explicit resend (endpoint not yet built).
- Submitter-outcome notifications piggyback on existing notification rules (first `{{field.<id>}}` recipient = submitter).

## Code map

| Layer | Path | Purpose |
|-------|------|---------|
| Schema | `src/lib/form-definitions.ts` | Zod schemas for FieldDefinition, NotificationConfig, PdfConfig, WorkflowConfig + state. `buildSubmissionSchema()` derives runtime validator from field_schema. `resolveRecipients()` for `{{field.<id>}}` mustache. |
| Loader | `src/lib/form-loader.ts` | Server-side form fetch by slug. Strict-validates JSONB before handing to renderer. |
| Renderer | `src/components/forms/DynamicField.tsx` | One field per type (text/textarea/email/phone/number/radio/checkbox_group/select/date/name/address/consent/file_upload/signature/section_break). Conditional visibility via `conditionalOn`. |
| Renderer | `src/components/forms/DynamicFileUpload.tsx` | Auto-uploads to `/api/upload` on file select; surfaces UploadedFile descriptors via onChange. |
| Renderer | `src/components/forms/SignaturePad.tsx` | signature_pad library; PNG data URL output. |
| Page | `src/app/forms/[slug]/page.tsx` | Public form renderer. force-dynamic. |
| Page | `src/app/forms/[slug]/DynamicForm.tsx` | Client wrapper; feeds FormEngine the derived schema. |
| API | `src/app/api/submit/route.ts` | Public submit endpoint. Legacy → fallthrough to dynamic. Includes reCAPTCHA, PDF gen, email notify, workflow kickoff. |
| API | `src/app/api/upload/route.ts` | Multipart file upload gate (25MB, mime allow-list, session-scoped key). |
| API | `src/app/api/admin/uploads/sign/route.ts` | Admin-only 5-min signed-URL minter. |
| Lib | `src/lib/form-pdf.tsx` | @react-pdf/renderer; PSPM letterhead + section-grouped table; renders attachments + signatures inline. |
| Lib | `src/lib/email.ts` | Resend wrapper. `sendFormNotification`, `sendWorkflowAssignmentEmail`, `sendWorkflowOutcomeEmail`, booking emails (legacy). |
| Lib | `src/lib/workflow.ts` | `kickoffWorkflow`, `applyDecision`, `issueWorkflowToken`, `resolveStepAssignee`, `workflowActionUrl`. |
| API | `src/app/api/workflow/decide/route.ts` | Public token-auth decide endpoint. |
| Page | `src/app/workflow/[token]/page.tsx` | Public approver page. |
| Page | `src/app/workflow/[token]/WorkflowDecideClient.tsx` | Client decide form. |
| Lib | `src/lib/gravity-forms-import.ts` | GF JSON → FormDefinition mapping. 16 supported types, 9 explicitly skipped with warnings. |
| API | `src/app/api/admin/forms/route.ts` | List + create form definitions. |
| API | `src/app/api/admin/forms/[id]/route.ts` | GET/PATCH/DELETE single form. Validates field_schema/notification_config/pdf_config/workflow_config server-side. |
| API | `src/app/api/admin/forms/import-gf/route.ts` | Two-step preview/create GF importer. |
| API | `src/app/api/admin/submissions/route.ts` | Submissions inbox (filters, pagination, CSV export, 5000-row cap). |
| API | `src/app/api/admin/submissions/[id]/route.ts` | Per-submission GET/PATCH (status, reviewer notes). |
| Page | `src/app/admin/forms/page.tsx` | Forms list with import button. |
| Page | `src/app/admin/forms/new/page.tsx` | Create draft form. |
| Page | `src/app/admin/forms/[id]/edit/page.tsx` | Edit form: metadata + field schema JSON + notification rules JSON + PDF toggle + workflow steps JSON. |
| Page | `src/app/admin/forms/import-gf/page.tsx` | Paste GF export, preview, create drafts. |
| Page | `src/app/admin/submissions/page.tsx` | Inbox with filters, status pills, workflow column, CSV export. |
| Page | `src/app/admin/submissions/[id]/page.tsx` | Submission detail: data table, request meta, status select, reviewer notes, workflow timeline. |

## Migrations to apply

Apply against `hthaomwoizcyfeduptqm` (CC Supabase) **in order**, after PRs are merged:

1. `supabase/migrations/20260429_form_definitions.sql` (Phase 1, on PR #2)
2. `supabase/migrations/20260429_form_pdf_config.sql` (Phase 2, on PR #4)
3. `supabase/migrations/20260429_form_uploads_bucket.sql` (Phase 1.3, on PR #5) — creates the bucket + RLS
4. `supabase/migrations/20260429_form_workflows.sql` (Phase 4, on PR #6) — workflow_config / workflow_state / workflow_actions table

Apply via `supabase db push --linked` against the linked project, OR via `mcp__claude_ai_Supabase__apply_migration` tool, OR via the SQL editor in Supabase Studio.

## Phase status

| # | Phase | Status | PR | Notes |
|---|-------|--------|-----|-------|
| 0 | Inventory all GF forms on psprop.net | ✅ done | — | Verified 16+ forms exist; vendor cert + payment plan + signed agreement are the hard ones. |
| 1 | Build form-builder UI in pspm-form-engine | ✅ done | [#2](https://github.com/rzilem/pspm-form-engine/pull/2) | Foundation: schema + admin CRUD + dynamic renderer. 1,979 LOC. |
| 2 | Generic PDF generator service | ✅ done | [#4](https://github.com/rzilem/pspm-form-engine/pull/4) | @react-pdf/renderer with PSPM brand template. 844 LOC. |
| 3 | Submissions admin dashboard | ✅ done | [#3](https://github.com/rzilem/pspm-form-engine/pull/3) | Filters, CSV, status pills. 864 LOC. |
| 1.3 | File uploads + signatures | ✅ done | [#5](https://github.com/rzilem/pspm-form-engine/pull/5) | Private bucket + signed URLs + signature_pad inline. ~700 LOC. |
| 4 | Workflow engine (Gravity Flow replacement) | ✅ done | [#6](https://github.com/rzilem/pspm-form-engine/pull/6) | Sequential approvals, magic-link tokens, audit timeline. ~1,550 LOC. |
| 4.5 | Gravity Forms JSON importer | ✅ done | [#7](https://github.com/rzilem/pspm-form-engine/pull/7) + [#8](https://github.com/rzilem/pspm-form-engine/pull/8) | Bulk import GF exports as drafts. PR #7 merged + 4 follow-up commits during pre-merge dry-run review. PR #8 followed up with REST API shape fix (empty `choices: ""`/`inputs: null` rejected 26/28 forms). |
| 4.1 | Workflow refinements (parallel/conditional, admin resend) | ⏳ deferred | — | Schema is forward-compatible; can add later. |
| 5 | Migrate simple intake forms (batch 1) | 🟡 in progress | — | **13 drafts created 2026-04-29 via live import.** All status=draft, need per-form review before publish. See "Drafts to review" section below. |
| 6 | Migrate payment-plan + letter-template forms | 🟡 in progress | — | Letter Template + Manager Letter Template Tool drafts exist; need `pdf_config.enabled=true` set. Test of Payment Plan form drafted but field-light (only 2 imported, others were html separators or pdfpreview). |
| 7 | Migrate workflow forms (batch 3) | 🟡 in progress | — | Vendor Application Form for HOA + Function Request drafts exist; need `workflow_config.steps` wired per form. |
| 8 | Replace Elementor+EmailJS on `/contact-us-main` and `/vendor` | ⏳ blocked | — | Blocked on Phase 5 publish (contact-us) + Phase 7 publish (vendor app). |
| 9 | Retire Gravity Forms ecosystem | ⏳ blocked | — | Deactivate GF + addons in WP after all migrations complete. |

## Drafts created via live import (2026-04-29)

13 form_definitions rows now exist in `hthaomwoizcyfeduptqm.form_definitions` with status='draft'. Public access 404s until published.

| GF id | Slug | Title | Fields | Rules | Notes for review |
|-------|------|-------|--------|-------|------------------|
| 4 | `contact-us` | Contact US | 6 | 1 | 1 captcha field skipped (we use reCAPTCHA via env). Recipients: info@psprop.net + cloudmailin webhook — verify both still wanted. |
| 5 | `pool-signature-form` | Pool Signature Form | 3 | 0 | username + password fields skipped. `{admin_email}` recipient dropped — add real email. Has `signature` field; wire to PDF if needed. |
| 7 | `condominium-request-form-type-1` | Condominium Request Form - Type 1 | 4 | 0 | Send-To-Field notification points at deleted GF field id 2; admin must add a real recipient. Has `fileupload` field. |
| 8 | `test-of-payment-plan-form` | Test of Payment Plan form | 2 | 0 | Looks like an abandoned test draft on GF side. Decide: rebuild, or delete. |
| 14 | `bid-request-system` | Bid Request System | 38 | 2 | **MAJOR**: 51 `image_choice` fields skipped (Gravity Wiz feature, no equivalent in form-engine). Plus 4 page breaks + merge_pdfs/pdfpreview. Form has 2 working notification rules (`{Community Name:1:value}` modifier-tag + literal email). Likely needs manual rebuild or stays on GF. |
| 15 | `letter-template` | Letter Template | 5 | 1 | 5 warnings: multi_choice + time + list + html + pdfpreview skipped. Needs `pdf_config.enabled=true` per Phase 6. |
| 24 | `eastwood-at-riverside-community-dog-park-survey` | Eastwood at Riverside Community Dog Park Survey | 3 | 0 | 1 html skipped. Survey-only; no notification originally. Add a recipient if the answers should be emailed. |
| 27 | `manager-letter-template-tool` | Manager Letter Template Tool | 1 | 0 | 3 html separators skipped. `{admin_email}` recipient dropped. Needs `pdf_config.enabled=true`. |
| 29 | `board-member-reimbursement` | Board Member Reimbursement | 4 | 1 | 3 product/merge_pdfs/pdfpreview skipped. Recipient: invoices@psprop.net. Likely needs `pdf_config.enabled=true` + `workflow_config` (board approval). |
| 32 | `falcon-pointe-hoa-pool-form` | Falcon Pointe HOA Pool Form | 9 | 1 | `{admin_email}` recipient dropped. Has Send-To-Field notification → user confirmation. |
| 34 | `falcon-pointe-website-form` | Falcon Pointe Website Form | 5 | 2 | Recipients: pspm-24@messages.vantaca.com (Vantaca task gateway) + Send-To-Field user confirmation. |
| 35 | `function-request-and-reservation-agreement` | Function Request and Reservation Agreement | 13 | 0 | 7 multi_choice + html skipped. **No notifications imported** — original GF form had none. Add a recipient before publish OR mark for replacement. |
| 40 | `vendor-application-form-for-hoa-and-condo-management` | Vendor Application Form for HOA and Condo Management | 11 | 0 | 1 multi_choice skipped. **No notifications imported.** This is the canonical vendor form (replaces #6 + #13 stubs). Needs `workflow_config.steps` (vendor approval) per Phase 7. |

### Forms NOT migrated (intentional)

**Legacy hand-coded slugs** (different code path in `src/lib/schemas.ts`, kept on existing routes):
- #3 Request a Management Proposal → `/proposal`
- #10 Invoicing System / #11 Utility Bill / #31 CI Invoice → `/invoice`
- #28 Manager Billback Tool → `/billback`
- #33 Falcon Pointe Portal Request Form → `/falcon-pointe-portal`
- #36 Pool Pavilion Reservation → `/pavilion-reservation`
- #38 Indoor Gathering Room Reservation → `/indoor-reservation`

**Tests / abandoned drafts:**
- #12 Email Test, #18 Board Candidate Questionnaire (0 fields), #21 Test 123, #26 Notification Shortcode Form, #42 Test (0 fields)

**Duplicate vendor stubs** (canonical is #40):
- #6 Vendor Application (1 field), #13 Vendor Application (1) (3 fields, page-broken)

## Stacked PR dependency tree

PRs must merge **bottom-up** because each branch is based on the one before it:

```
master
└── feat/form-builder-foundation (PR #2)         ← Phase 1
    └── feat/submissions-admin (PR #3)            ← Phase 3
        └── feat/form-pdf-generator (PR #4)        ← Phase 2
            └── feat/form-files-signature (PR #5)    ← Phase 1.3
                └── feat/form-workflow-engine (PR #6)  ← Phase 4
                    └── feat/form-gf-importer (PR #7)    ← Phase 4.5
```

After merging PR #2, GitHub will auto-rebase #3's base to master. Repeat per PR. Or merge with `gh pr merge --squash` in order.

## Worktree state

| Path | Branch | Use |
|------|--------|-----|
| `C:\Users\ricky\pspm-form-engine\` | master | Reference checkout. Untouched. |
| `C:\Users\ricky\pspm-form-engine-builder-wt\` | docs/milestone-plan (this PR) | Active work. Was on feat/form-gf-importer. |

## Operational migration checklist

Status as of 2026-04-29 18:00 UTC — through step 6 done in one session.

1. ✅ **Merge PRs bottom-up** (#2 → #3 → #4 → #5 → #6 → #7). Done; rebase-onto-master pattern needed because squash-merge lost original commit hashes.
2. ✅ **Apply 4 migrations** to `hthaomwoizcyfeduptqm`. Done via `mcp__claude_ai_Supabase__apply_migration`.
3. ✅ **Env vars** set on Cloud Run:
   - `NEXT_PUBLIC_APP_URL=https://pspm-form-engine-138752496729.us-central1.run.app`
   - `ADMIN_NOTIFY_EMAIL=rickyz@psprop.net`
   - All others pre-existing (Resend, Supabase, ADMIN_PASSWORD).
4. ✅ **Deploy** via `gcloud run deploy pspm-form-engine --source .` (no cloudbuild.yaml exists; uses Cloud Run's auto-build from Dockerfile). Initial rev `00010-bxs`, then `00011-ptl` after PR #8 (REST API shape fix).
5. ✅ **Pull GF forms** from psprop.net via `GET /wp-json/gf/v2/forms/<id>` with WP application password basic auth. 28 form schemas in `.planning/gf-export/`.
6. ✅ **Run importer** — 13 drafts created, 15 skipped (legacy/test/dupe). See "Drafts created" section above.
7. ⏳ **Per-form review** in `/admin/forms/[id]/edit` for each of the 13 drafts:
   - Spot-check field_schema (especially anything that triggered an importer warning).
   - Add real recipient(s) where notif-warn ≥ 1 (importer dropped `{admin_email}` etc.).
   - Set `pdf_config.enabled=true` for: `letter-template`, `manager-letter-template-tool`, `board-member-reimbursement`.
   - Wire `workflow_config.steps` for: `vendor-application-form-for-hoa-and-condo-management` (vendor approval), `function-request-and-reservation-agreement` (board approval if needed), `board-member-reimbursement` (board approval).
   - Decision needed: `bid-request-system` migrate or stay on GF (51 image_choice fields lost); `test-of-payment-plan-form` rebuild or delete.
8. ⏳ **Test end-to-end** for each form before publishing.
9. ⏳ **Publish** each form (status: published).
10. ⏳ **Update WordPress** to point `[gravityform id=N]` shortcodes + `/contact-us-main` + `/vendor` Elementor pages at the new URLs.
11. ⏳ **Verify** in production for 30 days.
12. ⏳ **Retire GF**: deactivate (don't delete) GF + Flow + PDF + Wiz + reCAPTCHA + AI plugins.

## Importer follow-up commits shipped during this session

PR #7's branch picked up 3 commits BEFORE merge after the live-export dry-run found bugs:
1. `db6d999` — warn on dropped notification recipients (`{admin_email}`, bare numerics) + tolerate `:modifier` merge tags
2. `8dd054b` — map GF Send-To-Field notifications to `{{field.<id>}}` + split warning categories (`field` vs `notification`)
3. `4642089` — handle Send-To-Field with only `toField` populated (was early-exiting at `if (!rawTo)` guard)

Then PR #8 followed up on master after the live import endpoint surfaced a different shape mismatch:
4. `b7c7d41` — accept GF v2 REST API empty-as-string/null shape for `choices`/`inputs` (z.preprocess wrapping)

Net importer recovery on the live psprop.net export:
- Before any fixes: ~16 forms with no notifications (silent drops)
- After fixes: 13 forms still need a real recipient added (true admin-decisions, not silent drops)
- Forms recoverable via importer: 13 of 28 (the rest are legacy or tests)

## Known limits / open questions

1. **No drag-drop field builder.** Admins edit field_schema as JSON. Acceptable for v1 since the importer covers the bulk migration; manual JSON for small tweaks. Drag-drop is a Phase 2 enhancement.
2. **Workflow v1 is sequential.** Parallel/conditional branches need 4.1.
3. **No /api/admin/workflow/resend** for re-issuing tokens. Admins currently have to wait 30 days for expiry or run a SQL UPDATE on `workflow_actions.revoked_at`.
4. **Submitter-outcome email** uses a heuristic (first `{{field.<id>}}` recipient in notification_config). May be wrong for forms with no submitter-facing notification rule. Add explicit `submitter_email_field` config in 4.1 if it bites.
5. **Cron for workflow due-date reminders** isn't built. `due_in_days` is captured but no scheduler nags assignees yet.
6. **PDF template is fixed** (`default`). Per-form templates are Phase 2.1 — the schema (`pdf_config.template`) leaves room.
7. **File upload session cleanup.** Uploads live forever in `upload-sessions/<sessionId>/`. Need a cron to garbage-collect orphans (uploads with no matching `form_submissions.data` reference). Phase 1.4.
8. **No rate limiting on /api/upload or /api/submit.** Public endpoints. Worth adding upstash/redis or Supabase-side rate limit before Phase 8 (when /contact-us-main goes live).

## Reference: GF type → FieldDefinition mapping

Mapped (16): text, textarea, email, phone, number, radio, checkbox, select, multiselect, date, name, address, consent, fileupload, signature, section, hidden.

Skipped with warning (9): page, list, post_title, post_content, post_image, product, total, shipping, option, quantity, donation, creditcard, password, captcha, html.

GF merge tags: `{Email:3}` → `{{field.3}}` when the id matches a known field. Literal emails pass through. Comma-separated `to` field is split.

## Test plan (post-merge smoke)

- [ ] `GET /admin/forms` lists all definitions.
- [ ] Create a draft form via `New form`, add a few fields, save, publish. Visit `/forms/<slug>` and submit.
- [ ] Verify row in `form_submissions`. Verify email arrives.
- [ ] Add a `file_upload` field. Re-submit with a PDF. Verify path in `data`. Open submission detail → click filename → file downloads.
- [ ] Add a `signature` field. Re-submit. Verify data URL in `data`. Verify PDF attachment shows the signature.
- [ ] Toggle `pdf_config.enabled=true`. Re-submit. Verify PDF attached to admin email.
- [ ] Add `workflow_config` with two steps (literal email + field_email assignees). Re-submit. Verify step 1 email. Click action URL → approve. Verify step 2 email. Reject step 2. Verify rejection email goes to submitter (resolved from notification_config field token).
- [ ] Try a re-used token → "already actioned" UI.
- [ ] Try expired link (manually set `expires_at` in DB) → "expired" UI.
- [ ] Run GF importer with a sample export → drafts created → fields match.

## Source of truth

- This file (`.planning/MILESTONE-gravity-forms-replacement.md`) is the latest checkpoint.
- All branches: `git branch -r | grep feat/form-`.
- Code lives in `pspm-form-engine` repo, organization `rzilem`.
