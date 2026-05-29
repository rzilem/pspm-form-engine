# PSPM Form Engine — Build Handoff

_Last updated: 2026-05-29. Live revision: **`pspm-form-engine-00020-mlt`** at
https://pspm-form-engine-lg3jjwzbga-uc.a.run.app_

This is a dynamic, admin-built form engine that is replacing Gravity Forms on
psprop.net. An admin builds forms in a visual builder; the same schema renders
the public form, validates submissions server-side, and produces notification
emails + branded PDFs. This doc is the single place to pick up the build.

---

## TL;DR — current state

A capable dynamic form engine is LIVE. Seven phases shipped 2026-05-29 (revs
00013→00020). It covers the bulk of the Gravity Forms migration: a Studio
two-pane builder with live preview, the full common field palette, HTML/time
fields, a commerce path (free + preset-priced line items with a
server-authoritative total), and an invoice-style PDF.

**The biggest remaining work is not more engine features — it's migrating the
real GF forms onto the engine and publishing them** (see "Next: migrate real
forms"). Publishing makes a form live, so it needs Ricky's go-ahead per form.

---

## What's DONE (all live in rev 00020)

| Phase | Delivers | Rev |
|---|---|---|
| P1 | Per-form width (`full`/`boxed`); embed fills the iframe; container-query responsive field grid | 00013 |
| P2 | Studio builder: `/admin/forms/[id]/edit` two-pane (editor + **live preview**), Full/Boxed + Desktop/Mobile toggles, sticky toolbar, JSON behind "Advanced" | 00014 |
| P3 | `html` block (DOMPurify-sanitized, display-only allow-list) + `time` field; GF importer maps both | 00016 |
| P4a | `line_items` (free-entry: description + amount + optional qty) + `total` (server-authoritative, recomputed in a schema transform) | 00017 |
| P4a-2 | Preset-priced line items (`lineItemMode: free \| preset`); price re-derived server-side from admin presets — a submitter can never set the price | 00019 |
| P4b | Invoice-style PDF: `line_items` → full-width itemized table, `total` → emphasized row; shared `formatMoney` (thousands separators) across PDF/form/email | 00020 |

Field types (`FIELD_TYPES` in `src/lib/form-definitions.ts`): text, textarea,
email, phone, number, radio, checkbox_group, select, date, time, name, address,
consent, file_upload, signature, section_break, html, line_items, total.

---

## Branch stack (origin: `rzilem/pspm-form-engine`)

Each phase is a branch stacked on the previous; the **tip contains all phases**.
All pushed, **none merged to master**.

```
ad21961 (deployed baseline, pre-survey)
  └─ feat/embed-full-width-deploy   (P1)
       └─ feat/studio-builder        (P2)
            └─ feat/form-html-time-fields   (P3)
                 └─ feat/form-commerce-fields    (P4a)
                      └─ feat/form-preset-line-items   (P4a-2)
                           └─ feat/form-invoice-pdf     (P4b)  ← TIP, == live rev 00020
```

Notes:
- A **parallel session's survey/live-polling feature** lives on
  `feat/form-engine-golive-and-builder` (commits `d15f2a3`, `d510bb7`, …). It is
  NOT in the deployed engine and these branches deliberately exclude it. Don't
  merge it in without coordinating with that work.
- To merge to master when ready: decide whether master should also get the
  survey work, then merge the stack (squash or merge-commit) — currently master
  is behind everything.

---

## Deploy process

Form-engine deploys from source (no `cloudbuild.yaml`):

```
gcloud run deploy pspm-form-engine --source . --region us-central1 \
  --project command-center-484415 --quiet
```

- Run it from the **checked-out branch's working tree** (deploys the working dir).
- `package.json` MUST keep `"packageManager": "pnpm@10.33.0"` — corepack pulls
  pnpm 11 in the container, which hard-fails `ERR_PNPM_IGNORED_BUILDS` on
  sharp/unrs-resolver. (Lesson: `pin-packagemanager-for-cloud-build`.)
- `gcloud run deploy --source .` keeps existing env vars/secrets (merge).
- Build artifacts: clear `.next` when switching branches if tsc/build complains
  about stale route types (e.g. survey routes from a prior build).

Post-deploy smoke: `curl /admin/forms` → 200; grep the served edit-route JS
bundle for a known new string to confirm the bundle shipped, e.g.
`curl <edit-url> | grep -oE '/_next/static/chunks/[^"]+\.js'` then grep a chunk
for "Line items (priced)".

---

## QA process (MANDATORY before any push — matches CLAUDE.md)

`qa-agent` is NOT installed on ai-pc, so run the gates manually:

1. `npx tsc --noEmit` → 0 errors
2. `npx eslint <changed files>` → 0 (repo-wide `pnpm lint` is noisy from the
   untracked `.omc/` dir — lint the changed files)
3. `npx next build` → exit 0
4. **Codex review** until completely clean:
   `codex review -c review.base_branch=<parent branch> "<summary of the change>"`
   — review against the PARENT branch so it sees only your diff. Codex is
   thorough on financial/validation code; expect multiple rounds.
5. For schema/total logic, write a throwaway `tsx` harness in the repo root that
   parses payloads through `buildSubmissionSchema` and asserts behavior
   (client total === server total, tampered values overridden, required
   enforced, round-trip idempotent). Delete it after.
6. For PDF changes: generate a PDF with a `tsx` harness calling
   `generateFormPdf(def, data, id)`, write it to a `.pdf`, and **read it back**
   (the Read tool renders PDFs) to verify layout.
7. Capture lessons per the Codex Lesson-Capture protocol if ≥1 finding survives
   the 3-question filter (write `feedback_*.md` to the memory dir).

---

## Architecture (how a dynamic form flows)

- **Storage:** `form_definitions` table in the **CC Supabase**
  (`hthaomwoizcyfeduptqm`). `field_schema` is JSONB (array of field objects);
  also `width`, `notification_config`, `pdf_config`, `workflow_config`,
  `recaptcha_required`, `confirmation_message`, `status`.
- **Schema contract:** `src/lib/form-definitions.ts` — `FIELD_TYPES`,
  `fieldDefinitionSchema`, `formDefinitionSchema`, and `buildSubmissionSchema()`
  which derives a Zod validator+**transform** from a form's fields. This file is
  the source of truth; the builder writes it, the renderer reads it, the server
  validates with it.
- **Render (public):** `src/app/forms/[slug]/page.tsx` (embed vs standalone,
  width) → `DynamicForm.tsx` (RHF + visibility + live total) →
  `DynamicField.tsx` (one component per field type).
- **Submit:** `src/app/api/submit/route.ts` re-runs `buildSubmissionSchema` (the
  server is authoritative) → stores `form_submissions` → `form-pdf.tsx` +
  `email.ts`.
- **Admin builder:** `src/app/admin/forms/[id]/edit/page.tsx` (Studio shell;
  preserves all save/validation guards) + `src/components/admin/FieldBuilder.tsx`
  (the field cards + per-type config). Admin auth: `x-admin-password` header /
  `admin_token` cookie vs `ADMIN_PASSWORD` env
  (`gcloud run services describe pspm-form-engine` to read it).

### Critical invariants (don't break these)
- **Server-authoritative computed values.** `total` is recomputed in the
  `buildSubmissionSchema` transform via `computeFormTotal`; a client-sent total
  is ignored. Preset line prices are re-derived from `presetItems[index]`.
- **Client === server.** `buildSubmissionSchema` runs in BOTH the client RHF
  `zodResolver` and the server. Its transformed output is what gets POSTed — so
  the transform must NOT strip a key the server needs (e.g. `presetIndex` is
  kept). `lineItemTotal`/`computeFormTotal`/`formatMoney` are shared so display
  and storage agree. (Lessons: `server-authoritative-value-mirror-everywhere`,
  `dual-use-schema-transform-must-not-strip-needed-keys`.)
- **Update ALL consumers when adding a field type.** Renderer (DynamicField),
  schema (FIELD_TYPES + buildSubmissionSchema), builder (FieldBuilder
  TYPE_LABELS + config), DynamicForm defaults/half-width, GF importer
  (`gravity-forms-import.ts` FIELD_TYPE_MAP — silently drops unknown), and the
  three output renderers (PDF `renderValueCell`/special blocks, email
  `renderFieldCellHtml`, admin `submissions/[id]` `formatValue`). (Lesson:
  `extend-union-update-all-consumers-incl-adapters`.)
- **HTML block** is sanitized at render with a strict display-only allow-list
  (no form controls/script/style/iframe) — it renders inside the submission
  `<form>`. (Lesson: in `feedback_extend_union_...`.)
- **Preview mode** (`preview` prop through FormEngine→DynamicForm→DynamicField→
  DynamicFileUpload) disables submit, reCAPTCHA, AND file uploads. (Lesson:
  `preview-mode-disable-all-side-effect-entry-points`.)

### DB migrations
Apply via the Supabase MCP `apply_migration` against project
`hthaomwoizcyfeduptqm` (NOT `db push` — migration tracking is desynced).
Applied so far: `20260529_form_layout_width.sql` (the `width` column). New field
config (lineItemMode/presetItems/allowQuantity/html/time) lives inside the
`field_schema` JSONB — no migration needed for those.

---

## Remaining roadmap

### Next (highest value): migrate real GF forms
Engine features are largely done; the real win is moving live forms over. From
the 2026-05-29 GF audit (28 forms; pull via the GF REST API, `GET
/wp-json/gf/v2/forms`):
- **Tier 1 (engine ready — migrate now):** Falcon Pointe Website Form, Vendor
  Application, Contact US (558 entries — a real form, separate from the
  `/contact-us-main` CTA page), Falcon Pointe Portal Request.
- **Tier 2 (needs nothing new now that HTML block exists):** Function/Reservation
  Agreement, Board Candidate Questionnaire, Manager Letter Template.
- **Tier 3 (now buildable with line_items + total + invoice PDF):** Invoicing
  System (1,795 entries — Utility Reimbursement → accounting/Debra), Manager
  Billback, CI Invoice, Utility Bill, Board Reimbursement, Letter Template.
- **Already elsewhere:** reservations → `pspm-bookings`; Bid Request → bid-wizard.
- Migration path per form: build/import via `/admin/forms/import-gf` or the
  builder → review on the deployed `/admin/forms/[id]/edit` (live preview) →
  **get Ricky's OK** → publish → swap the psprop.net embed → retire the GF form.

### 4d — online payment (Stripe) [deferred: "not sure, add later"]
Only if a form actually collects payment online. The invoice forms are
document-generators to accounting, not checkouts, so this may not be needed.
`StripePayment.tsx` + `/api/stripe` exist (from the old reservation path).
Decision needed: does any target form take a card? If yes: add a payment field
type gated on a `total`, wire PaymentIntent (amount = server total, never
client), add payment-status to the submission. Follow the pspm-bookings Stripe
pattern (restricted key, server-derived amount).

### 2b — builder polish [cosmetic]
Drag-and-drop reorder (needs a dnd lib like dnd-kit), collapsible field cards,
type-icon chips. `FieldBuilder` currently reorders with ↑↓ buttons (works). This
reworks the 11-Codex-round conditional-logic card code, so high regression risk
for visual gain — do it carefully with the harness + Codex.

### 3b — list/repeater field + deeper conditional logic
- `list` (repeater) field: ~1 live form (Letter Template). Complex (nested
  repeating groups).
- Deeper conditional logic: AND/OR + operators (contains/greater/less). Current
  `conditionalOn` is single-condition equals. 14 forms use conditional logic but
  single-condition has sufficed. Touches the shared `resolveVisibleFieldIds` +
  the builder's `ConditionalEditor`.

### Known gaps NOT built (from the audit, low real usage)
- GP Populate Anything (dynamic choices from DB/other entries) — only 2 fields
  use it live; hardcode those.
- GF Survey fields — 0 live forms use them; don't build.
- Save-and-continue / partial entries — 0 live forms; don't build.
- image_choice — only Bid Request, which is its own app.

---

## Gotchas / lessons (full text in the memory dir)
- `pin-packagemanager-for-cloud-build` — pnpm 11 breaks the container build.
- `server-authoritative-value-mirror-everywhere` — client must mirror server
  math exactly; update every output renderer.
- `dual-use-schema-transform-must-not-strip-needed-keys` — the client resolver's
  transformed output is what's POSTed.
- `extend-union-update-all-consumers-incl-adapters` — adding a field type:
  update the GF importer + all output renderers (they fail silently).
- `preview-mode-disable-all-side-effect-entry-points` — preview must disable
  file uploads, not just submit.
- `dynamic-form-conditional-visibility` / `visual-builder-constrain-to-runtime`
  — the earlier conditional-logic + builder hardening.

## Admin / config quick reference
- Service: `pspm-form-engine` (Cloud Run, us-central1, project
  command-center-484415). URL host: `pspm-form-engine-lg3jjwzbga-uc.a.run.app`.
- Supabase: CC `hthaomwoizcyfeduptqm`, table `form_definitions` +
  `form_submissions`.
- Admin password: `ADMIN_PASSWORD` env var on the service.
- Local checkout: `C:\Users\ricky\pspm-form-engine`.
