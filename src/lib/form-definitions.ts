/**
 * Form Builder runtime types + Zod schemas.
 *
 * `form_definitions.field_schema` is a JSONB column that holds an array of
 * FieldDefinition objects. The shapes here are the canonical contract: the
 * admin builder writes them, the dynamic renderer reads them, and the
 * server-side `/api/submit` resolver derives a Zod validator from them at
 * request time so submissions are type-safe even though the form was built
 * by a non-developer.
 */
import { z } from "zod";

// ── Field types supported by the dynamic renderer ───────────────────────
// Keep this list in sync with the renderer switch in
// src/components/forms/DynamicField.tsx and the option editor in
// src/app/admin/forms/[id]/edit/page.tsx.
export const FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "radio",
  "checkbox_group",
  "select",
  "date",
  "name",
  "address",
  "consent",
  "file_upload",
  "signature",
  "section_break",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

// Shape stored in submission data for file_upload fields. The /api/upload
// endpoint returns one of these per uploaded file; the form serializes an
// array on submit and the resolver re-checks each path.
export const uploadedFileSchema = z.object({
  path: z.string().regex(/^upload-sessions\/[a-zA-Z0-9-]+\/.+/, "invalid upload path"),
  filename: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(26214400),
  mimeType: z.string().min(1).max(120),
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;

// ── Field definition (one object per question on the form) ─────────────
const fieldOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});
export type FieldOption = z.infer<typeof fieldOptionSchema>;

const conditionalSchema = z.object({
  fieldId: z.string().min(1),
  equals: z.union([z.string(), z.array(z.string())]),
});

export const fieldDefinitionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  options: z.array(fieldOptionSchema).optional(),
  // Optional validation hints (max length, min/max number, etc.)
  validation: z
    .object({
      minLength: z.number().int().nonnegative().optional(),
      maxLength: z.number().int().positive().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      pattern: z.string().optional(),
      patternMessage: z.string().max(200).optional(),
    })
    .optional(),
  // Show this field only when another field has a specific value.
  // Replaces Gravity Forms' Conditional Logic.
  conditionalOn: conditionalSchema.optional(),
  // Section break uses `label` as the heading and ignores `required`.
});
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

// ── Notification routing (replaces FORM_EMAIL_CONFIG for dynamic forms) ──
// Recipients can be literal emails or {{field.<id>}} references resolved
// against the submission data at send time. e.g. "{{field.email}}" routes
// the confirmation back to the submitter.
export const notificationRuleSchema = z.object({
  recipients: z.array(z.string().min(1).max(320)).min(1),
  subject: z.string().min(1).max(300),
  // Optional conditional gate: only send if `data[fieldId]` matches `equals`.
  conditional: conditionalSchema.optional(),
});
export type NotificationRule = z.infer<typeof notificationRuleSchema>;

export const notificationConfigSchema = z.object({
  rules: z.array(notificationRuleSchema).default([]),
});
export type NotificationConfig = z.infer<typeof notificationConfigSchema>;

// ── PDF config (Phase 2: per-submission PDF generation) ────────────────
// When enabled, /api/submit renders a PDF after save and attaches it to
// the admin notification email. Templates: 'default' = branded letterhead
// with field/value table. Future templates can ship as additional values.
export const pdfConfigSchema = z.object({
  enabled: z.boolean().default(false),
  template: z.enum(["default"]).default("default"),
  // Filename prefix for the PDF; submission id is appended. Defaults to
  // the form slug. e.g. prefix='HOA-Payment-Plan' yields filenames like
  // 'HOA-Payment-Plan-<id>.pdf'.
  filenamePrefix: z.string().max(80).optional(),
});
export type PdfConfig = z.infer<typeof pdfConfigSchema>;

// ── Workflow config (Phase 4: multi-step approval engine) ──────────────
// Replaces Gravity Flow's sequential pipelines. v1 is sequential-only —
// parallel + conditional branches are scheduled for 4.1.
//
// Each step has:
//   - `id`: stable identifier referenced by history rows. Don't reuse.
//   - `assignee`: how to resolve the email at runtime.
//       - "literal": fixed `email`
//       - "field_email": pull from submission data via `fieldId` (must be
//         a string that contains "@"; resolveStepAssignee falls through
//         to admin_fallback if the field is missing/invalid)
//       - "admin_fallback": always go to ADMIN_NOTIFY_EMAIL env
//   - `actions`: which decisions this step accepts. Most workflows are
//     ["approve", "reject"]; "comment" lets the assignee request changes
//     without advancing the workflow (loops back to the previous step or
//     stays on the current step depending on the comment_loop_back flag).
//   - `due_in_days`: optional SLA — used by a future cron to nag.
//   - `email_subject`: per-step subject template; supports {{field.<id>}}
//     tokens and the {{step.label}} / {{form.title}} placeholders.
const stepAssigneeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("literal"),
    email: z.string().email().max(320),
  }),
  z.object({
    type: z.literal("field_email"),
    fieldId: z.string().min(1).max(64),
  }),
  z.object({
    type: z.literal("admin_fallback"),
  }),
]);

export const workflowStepSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only"),
  label: z.string().min(1).max(200),
  assignee: stepAssigneeSchema,
  actions: z
    .array(z.enum(["approve", "reject", "comment"]))
    .min(1)
    .default(["approve", "reject"]),
  due_in_days: z.number().int().positive().max(365).optional(),
  email_subject: z.string().max(300).optional(),
  // When true, "comment" decisions loop back to the previous step
  // (or stay on current if this is the first step). Default false =
  // comment is recorded but workflow stays put.
  comment_loop_back: z.boolean().default(false),
});
export type WorkflowStep = z.infer<typeof workflowStepSchema>;

export const workflowConfigSchema = z.object({
  enabled: z.boolean().default(false),
  steps: z.array(workflowStepSchema).default([]),
});
export type WorkflowConfig = z.infer<typeof workflowConfigSchema>;

// Submission-side state. Persisted on form_submissions.workflow_state.
export const workflowHistoryEntrySchema = z.object({
  step_id: z.string(),
  action: z.enum(["approve", "reject", "comment", "kickoff"]),
  actor_email: z.string(),
  actor_label: z.string().optional(),
  comments: z.string().max(4000).optional(),
  decided_at: z.string(),
});
export type WorkflowHistoryEntry = z.infer<typeof workflowHistoryEntrySchema>;

export const workflowStateSchema = z.object({
  status: z.enum(["pending", "in_progress", "completed", "rejected", "expired"]),
  current_step_id: z.string().nullable(),
  history: z.array(workflowHistoryEntrySchema).default([]),
  started_at: z.string(),
  completed_at: z.string().optional(),
});
export type WorkflowState = z.infer<typeof workflowStateSchema>;

// ── Form definition (one row in form_definitions) ───────────────────────
export const formDefinitionSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, hyphens only").min(1).max(80),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable(),
  status: z.enum(["draft", "published", "archived"]),
  field_schema: z.array(fieldDefinitionSchema),
  notification_config: notificationConfigSchema,
  pdf_config: pdfConfigSchema.default({ enabled: false, template: "default" }),
  workflow_config: workflowConfigSchema.default({ enabled: false, steps: [] }),
  confirmation_message: z.string().min(1).max(500),
  recaptcha_required: z.boolean(),
  // Layout width of the rendered form. "full" fills the host container
  // (near-full-width when embedded on a page); "boxed" keeps a readable
  // max-width. Defaults to "full" so existing rows (no column) and new
  // forms embed edge-to-edge unless explicitly set boxed.
  width: z.enum(["full", "boxed"]).default("full"),
  created_by: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  published_at: z.string().nullable(),
});
export type FormDefinition = z.infer<typeof formDefinitionSchema>;

// ── Runtime: derive a Zod validator from a FormDefinition ───────────────
// Called server-side at submit time to validate `data` against the
// fields the form actually has. Each field type maps to a Zod primitive
// plus optional max length / required gating.
export function buildSubmissionSchema(
  fields: FieldDefinition[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  // Conditional fields are validated only when their condition is met. We keep
  // the field's full "present" validator here and run it inside the superRefine
  // below, so (a) a since-hidden field's stale value is ignored entirely and
  // (b) required + format are both enforced when the field is shown.
  const conditionalLeaves: { field: FieldDefinition; leaf: z.ZodTypeAny }[] = [];

  for (const f of fields) {
    if (f.type === "section_break") continue;

    let leaf: z.ZodTypeAny;

    const isConditional = Boolean(f.conditionalOn);
    // Required enforcement is applied as if the field is present/shown. For
    // non-conditional fields that is the final word; for conditional fields it
    // only takes effect via the superRefine when the condition matches.
    const requiredWhenPresent = Boolean(f.required);

    switch (f.type) {
      case "email":
        leaf = z.string().email("Please enter a valid email address");
        break;
      case "phone":
        leaf = z.string().min(7).max(40);
        break;
      case "number": {
        let num = z.coerce.number();
        if (f.validation?.min !== undefined) num = num.min(f.validation.min);
        if (f.validation?.max !== undefined) num = num.max(f.validation.max);
        // Map ""/null -> undefined BEFORE coercion so a blank value doesn't
        // become 0. A required number then rejects undefined (NaN); an optional
        // one accepts it via the .optional() applied in the gating block below.
        leaf = z.preprocess((v) => (v === "" || v === null ? undefined : v), num);
        break;
      }
      case "checkbox_group":
        leaf = z.array(z.string());
        break;
      case "file_upload":
        // Each entry is the descriptor /api/upload returned. Required
        // gating is applied below — empty array still passes the array
        // shape, then min(1) is enforced via the required block.
        leaf = z.array(uploadedFileSchema);
        break;
      case "signature":
        // PNG data URL produced by signature_pad's toDataURL("image/png").
        // Cap at ~2 MB so a malicious page can't ship a megabyte JSON
        // body; real signatures are <50 KB.
        leaf = z
          .string()
          .max(2_800_000, "Signature too large")
          .refine(
            (v) => v === "" || /^data:image\/(png|jpe?g);base64,/.test(v),
            { message: "Invalid signature" },
          );
        break;
      case "consent":
        // Consent must be checked (true) when required; optional otherwise.
        leaf = requiredWhenPresent
          ? z.literal(true, { message: "You must agree to continue" })
          : z.boolean().optional();
        break;
      case "name": {
        const base = z.object({
          first: z.string().max(100),
          last: z.string().max(100),
        });
        // Composite fields are excluded from the generic gating block below, so
        // apply required/optional here: required -> non-blank refine; optional
        // -> .optional() so an omitted value (undefined) is accepted.
        leaf = requiredWhenPresent
          ? base.refine(
              (v: { first?: string; last?: string }) =>
                Boolean(v?.first?.trim()) && Boolean(v?.last?.trim()),
              { message: "First and last name are required" },
            )
          : base.optional();
        break;
      }
      case "address": {
        const base = z.object({
          street: z.string().max(200).optional(),
          city: z.string().max(100).optional(),
          state: z.string().max(50).optional(),
          zip: z.string().max(20).optional(),
        });
        leaf = requiredWhenPresent
          ? base.refine(
              (v: {
                street?: string;
                city?: string;
                state?: string;
                zip?: string;
              }) =>
                Boolean(v?.street?.trim()) &&
                Boolean(v?.city?.trim()) &&
                Boolean(v?.state?.trim()) &&
                Boolean(v?.zip?.trim()),
              { message: `${f.label} is required` },
            )
          : base.optional();
        break;
      }
      case "date":
        leaf = z.string();
        break;
      case "radio":
      case "select":
        if (f.options && f.options.length > 0) {
          const values = f.options.map((o) => o.value) as [string, ...string[]];
          leaf = z.enum(values);
        } else {
          leaf = z.string();
        }
        break;
      case "text":
      case "textarea":
      default: {
        let s = z.string();
        if (f.validation?.minLength !== undefined) s = s.min(f.validation.minLength);
        if (f.validation?.maxLength !== undefined) {
          s = s.max(f.validation.maxLength);
        } else {
          s = s.max(f.type === "textarea" ? 10000 : 500);
        }
        if (f.validation?.pattern) {
          // A malformed pattern saved on the form must not crash schema
          // building (which runs on every render and submit). Skip an invalid
          // regex rather than throwing from `new RegExp`.
          try {
            const re = new RegExp(f.validation.pattern);
            s = s.regex(re, f.validation.patternMessage ?? "Invalid format");
          } catch {
            // Invalid pattern — ignore the constraint.
          }
        }
        leaf = s;
        break;
      }
    }

    // Required gating. For string-ish leaves we treat empty string as missing
    // so that `required: false` doesn't reject blank fields. file_upload
    // (array) and signature (string) need their own required predicates.
    if (requiredWhenPresent && f.type !== "consent" && f.type !== "name" && f.type !== "address") {
      if (f.type === "file_upload" || f.type === "checkbox_group") {
        leaf = (leaf as z.ZodArray<z.ZodTypeAny>).min(
          1,
          `${f.label} is required`,
        );
      } else if (f.type === "signature") {
        leaf = (leaf as z.ZodString).refine((v: string) => v.length > 0, {
          message: `${f.label} is required`,
        });
      } else if (leaf instanceof z.ZodString) {
        leaf = leaf.min(1, `${f.label} is required`);
      }
    } else if (
      !requiredWhenPresent &&
      f.type !== "consent" &&
      f.type !== "name" &&
      f.type !== "address"
    ) {
      // Optional field. RHF initializes most controls to "", but Zod only
      // treats `undefined` as absent — so coerce ""/null -> undefined before
      // .optional(), or a blank email/phone/select fails its format check and
      // a blank number silently coerces to 0.
      leaf = z.preprocess(
        (v) => (v === "" || v === null ? undefined : v),
        leaf.optional(),
      );
    }

    // Conditional fields are validated only when shown — defer the leaf to the
    // superRefine and keep the shape permissive so a since-hidden field's stale
    // value can never fail validation.
    if (isConditional) {
      conditionalLeaves.push({ field: f, leaf });
      shape[f.id] = z.unknown().optional();
    } else {
      shape[f.id] = leaf;
    }
  }

  let obj = z.object(shape) as unknown as z.ZodType<Record<string, unknown>>;

  if (conditionalLeaves.length > 0) {
    // Validate each conditional field with its own "present" leaf, but only
    // when it is genuinely visible. A hidden field's value (which RHF keeps
    // after the field unmounts) is neither validated nor stored.
    obj = (obj as unknown as z.ZodObject<z.ZodRawShape>)
      .superRefine((data: Record<string, unknown>, ctx: z.RefinementCtx) => {
        const visible = resolveVisibleFieldIds(fields, data);
        for (const { field: f, leaf } of conditionalLeaves) {
          if (!visible.has(f.id)) continue;
          const result = leaf.safeParse(data[f.id]);
          if (!result.success) {
            for (const issue of result.error.issues) {
              ctx.addIssue({ ...issue, path: [f.id, ...issue.path] });
            }
          }
        }
      })
      // Strip hidden conditional values from the parsed output so they are
      // never persisted/emailed/rendered, and normalize visible ones to the
      // same Zod-coerced shape non-conditional fields get (e.g. "5" -> 5).
      .transform((data: Record<string, unknown>) => {
        const visible = resolveVisibleFieldIds(fields, data);
        const out: Record<string, unknown> = { ...data };
        for (const { field: f, leaf } of conditionalLeaves) {
          if (!visible.has(f.id)) {
            delete out[f.id];
            continue;
          }
          const result = leaf.safeParse(data[f.id]);
          if (result.success) out[f.id] = result.data;
        }
        return out;
      }) as unknown as z.ZodType<Record<string, unknown>>;
  }

  return obj;
}

// Resolve which fields are currently visible for the given values. A field is
// visible unless it is gated (`conditionalOn`) by a trigger that is itself
// hidden OR whose value doesn't match — resolved transitively so a gate on a
// hidden ancestor also hides the descendant. Shared by the server validator
// (buildSubmissionSchema) and the client renderer (DynamicForm) so the two can
// never disagree about which fields count. Section breaks are always "visible".
export function resolveVisibleFieldIds(
  fields: FieldDefinition[],
  values: Record<string, unknown>,
): Set<string> {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const cache = new Map<string, boolean>();

  function isVisible(fieldId: string): boolean {
    const cached = cache.get(fieldId);
    if (cached !== undefined) return cached;
    const f = fieldsById.get(fieldId);
    if (!f) return true; // unknown trigger id → no gating
    if (!f.conditionalOn) {
      cache.set(fieldId, true);
      return true;
    }
    cache.set(fieldId, false); // provisional, guards against cycles
    const triggerId = f.conditionalOn.fieldId;
    let vis = false;
    if (triggerId && isVisible(triggerId)) {
      const tv = values[triggerId];
      vis = Array.isArray(f.conditionalOn.equals)
        ? f.conditionalOn.equals.includes(String(tv ?? ""))
        : String(tv ?? "") === f.conditionalOn.equals;
    }
    cache.set(fieldId, vis);
    return vis;
  }

  const visible = new Set<string>();
  for (const f of fields) {
    // Section breaks are headings, not data — but they can still carry
    // conditionalOn, so a heading inside a hidden branch must hide too.
    if (isVisible(f.id)) visible.add(f.id);
  }
  return visible;
}

// ── Mustache-lite recipient resolver for notification routing ───────────
// Replaces `{{field.email}}` style tokens in recipient lists. Only matches
// `{{field.<id>}}` — anything else stays literal so a plain `info@psprop.net`
// recipient doesn't get mangled.
const FIELD_TOKEN = /^\s*\{\{\s*field\.([a-zA-Z0-9_-]+)\s*\}\}\s*$/;

export function resolveRecipients(
  recipients: string[],
  data: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  for (const raw of recipients) {
    const m = raw.match(FIELD_TOKEN);
    if (!m) {
      out.push(raw.trim());
      continue;
    }
    const fieldId = m[1];
    const value = data[fieldId];
    if (typeof value === "string" && value.includes("@")) {
      out.push(value.trim());
    }
  }
  // De-dupe while preserving order; reject anything that isn't email-shaped
  // so a malformed token (e.g. {{field.notAnEmail}}) doesn't cause Resend
  // to 400 the whole notification.
  const seen = new Set<string>();
  return out.filter((e) => {
    if (!e || !e.includes("@") || seen.has(e)) return false;
    seen.add(e);
    return true;
  });
}
