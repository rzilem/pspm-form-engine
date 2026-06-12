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
  "time",
  "name",
  "address",
  "consent",
  "file_upload",
  "signature",
  "section_break",
  "html",
  "line_items",
  "total",
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

// One row of a line_items field: a description + a non-negative amount and an
// optional quantity. Stored as an array on the submission; the grand total is
// always recomputed server-side (a client-sent total is never trusted).
export const lineItemValueSchema = z.object({
  description: z.string().max(300).optional().default(""),
  // Amounts arrive as free-typed strings from the client. Coerce defensively:
  // anything non-numeric/negative becomes 0 (rounded to cents) rather than
  // failing the whole submission. lineItemTotal applies the same leniency, so
  // the displayed and stored totals stay in lockstep.
  amount: z.preprocess((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  }, z.number().min(0).max(10_000_000)),
  // Empty/blank/invalid quantity → undefined (treated as 1 by lineItemTotal),
  // matching the client so a cleared qty box doesn't zero the line on the
  // server while showing ×1 in the browser.
  quantity: z.preprocess((v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    // Blank → undefined (free mode counts that as 1). NEGATIVE → 0 (not
    // undefined) so it stays distinguishable and gets dropped/zeroed rather
    // than silently defaulting to 1 — closes a required-preset bypass via
    // {quantity:-1}. Fractional → floored. Never rejects the whole submission.
    if (!Number.isFinite(n)) return undefined;
    if (n < 0) return 0;
    return Math.min(Math.floor(n), 100_000);
  }, z.number().int().min(0).max(100_000).optional()),
  // Preset mode only: which preset item this row selects. The server re-derives
  // description + amount from the field's presetItems[presetIndex] (a client
  // can never set its own price), then strips this key from the stored row.
  presetIndex: z.coerce.number().int().min(0).optional(),
});
export type LineItemValue = z.infer<typeof lineItemValueSchema>;

// ── Field definition (one object per question on the form) ─────────────
const fieldOptionSchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
});
export type FieldOption = z.infer<typeof fieldOptionSchema>;

// ── Conditional logic (GF Conditional Logic parity) ─────────────────────
// Accepts BOTH the legacy single-condition shape stored on imported forms
// AND the new multi-condition shape. Everything downstream normalizes first.
export const CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
  "is_empty",
  "is_not_empty",
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const conditionOperatorSchema = z.enum(CONDITION_OPERATORS);

const conditionRowSchema = z.object({
  fieldId: z.string().min(1),
  operator: conditionOperatorSchema,
  value: z.string().optional(),
});

const legacyConditionalSchema = z.object({
  fieldId: z.string().min(1),
  equals: z.union([z.string(), z.array(z.string())]),
});

const multiConditionalSchema = z.object({
  logic: z.enum(["all", "any"]),
  conditions: z.array(conditionRowSchema).min(1),
});

export const conditionalSchema = z.union([
  legacyConditionalSchema,
  multiConditionalSchema,
]);
export type ConditionalLogic = z.infer<typeof conditionalSchema>;

export type NormalizedConditionRow = {
  fieldId: string;
  operator: ConditionOperator;
  value?: string;
};

export type NormalizedConditional = {
  logic: "all" | "any";
  conditions: NormalizedConditionRow[];
};

/** True when `c` is the legacy `{ fieldId, equals }` shape. */
export function isLegacyConditional(
  c: ConditionalLogic,
): c is z.infer<typeof legacyConditionalSchema> {
  return "equals" in c && !("logic" in c);
}

/**
 * Map any stored conditional (legacy or new) to one internal representation.
 * Legacy `equals: string[]` → logic "any" with one equals row per value (OR).
 */
export function normalizeCondition(c: ConditionalLogic): NormalizedConditional {
  if (isLegacyConditional(c)) {
    const values = Array.isArray(c.equals) ? c.equals : [c.equals];
    return {
      logic: "any",
      conditions: values.map((v) => ({
        fieldId: c.fieldId,
        operator: "equals" as const,
        value: v,
      })),
    };
  }
  return { logic: c.logic, conditions: c.conditions };
}

const VALUE_REQUIRED_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "greater_than",
  "less_than",
]);

function isTriggerValueEmpty(raw: unknown): boolean {
  if (raw === undefined || raw === null || raw === "") return true;
  if (Array.isArray(raw)) {
    if (raw.length === 0) return true;
    return raw.every(
      (v) => v === undefined || v === null || String(v).trim() === "",
    );
  }
  if (typeof raw === "object") {
    return Object.values(raw as Record<string, unknown>).every(
      (v) => v === undefined || v === null || String(v).trim() === "",
    );
  }
  return false;
}

function evaluateConditionRow(
  row: NormalizedConditionRow,
  values: Record<string, unknown>,
  isTriggerVisible: (fieldId: string) => boolean,
): boolean {
  if (!row.fieldId) return false;
  if (!isTriggerVisible(row.fieldId)) return false;

  if (
    VALUE_REQUIRED_OPERATORS.has(row.operator) &&
    (row.value === undefined || row.value === "")
  ) {
    return false;
  }

  const tv = values[row.fieldId];

  switch (row.operator) {
    case "is_empty":
      return isTriggerValueEmpty(tv);
    case "is_not_empty":
      return !isTriggerValueEmpty(tv);
    case "equals": {
      const expected = row.value ?? "";
      if (Array.isArray(tv)) {
        return tv.map((v) => String(v)).includes(expected);
      }
      return String(tv ?? "") === expected;
    }
    case "not_equals": {
      const expected = row.value ?? "";
      if (Array.isArray(tv)) {
        return !tv.map((v) => String(v)).includes(expected);
      }
      return String(tv ?? "") !== expected;
    }
    case "contains": {
      const needle = row.value ?? "";
      if (Array.isArray(tv)) {
        return tv.map((v) => String(v)).includes(needle);
      }
      return String(tv ?? "").includes(needle);
    }
    case "not_contains": {
      const needle = row.value ?? "";
      if (Array.isArray(tv)) {
        return !tv.map((v) => String(v)).includes(needle);
      }
      return !String(tv ?? "").includes(needle);
    }
    case "greater_than":
    case "less_than": {
      const left = Number(tv);
      const right = Number(row.value);
      if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
      return row.operator === "greater_than" ? left > right : left < right;
    }
    default:
      return false;
  }
}

/**
 * Evaluate a conditional gate against submission values.
 * `isTriggerVisible` enforces transitive hide: a condition whose trigger
 * field is hidden counts as false (pass resolveVisibleFieldIds's `isVisible`).
 * For notification rules (no visibility graph), pass `() => true`.
 */
export function evaluateCondition(
  conditional: ConditionalLogic | undefined,
  values: Record<string, unknown>,
  isTriggerVisible: (fieldId: string) => boolean,
): boolean {
  if (!conditional) return true;
  try {
    const { logic, conditions } = normalizeCondition(conditional);
    if (conditions.length === 0) return false;
    const results = conditions.map((row) =>
      evaluateConditionRow(row, values, isTriggerVisible),
    );
    return logic === "all" ? results.every(Boolean) : results.some(Boolean);
  } catch {
    return false;
  }
}

/** Whether any condition row references `fieldId` (legacy or multi shape). */
export function conditionalReferencesField(
  conditional: ConditionalLogic | undefined,
  fieldId: string,
): boolean {
  if (!conditional) return false;
  if (isLegacyConditional(conditional)) {
    return conditional.fieldId === fieldId;
  }
  return conditional.conditions.some((c) => c.fieldId === fieldId);
}

export const fieldDefinitionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  options: z.array(fieldOptionSchema).optional(),
  // Raw HTML body for an "html" display block (rendered sanitized; never a
  // submission value). Ignored by every other field type.
  html: z.string().max(20000).optional(),
  // line_items: show a per-row quantity column (line total = amount × qty).
  // Ignored by every other field type.
  allowQuantity: z.boolean().optional(),
  // line_items: "free" (default) lets submitters type description + amount;
  // "preset" offers a fixed list of admin-priced items (submitters only choose
  // quantities, never the price). Quantity always applies in preset mode.
  lineItemMode: z.enum(["free", "preset"]).optional(),
  presetItems: z
    .array(
      z.object({
        // No min length here — a leftover/in-progress preset row must not block
        // saving a field that isn't a preset line_items field. The refine below
        // enforces non-empty labels only when the field actually IS one.
        label: z.string().max(200),
        // Normalize to cents so the displayed (toFixed 2) and computed/stored
        // prices never diverge on a >2-decimal entry like 0.015.
        price: z.preprocess((v) => {
          const n = Number(v);
          return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
        }, z.number().min(0).max(10_000_000)),
      }),
    )
    .max(100)
    .optional(),
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
}).refine(
  // Only enforce preset rules when the field IS a preset line_items field — a
  // preset field needs ≥1 item, each with a non-blank label. For any other
  // field type, leftover presetItems are ignored (so changing a field's type
  // away from line_items never blocks the save).
  (d) => {
    if (d.type !== "line_items" || d.lineItemMode !== "preset") return true;
    const items = d.presetItems ?? [];
    return items.length > 0 && items.every((it) => it.label.trim() !== "");
  },
  {
    message: "Preset line items need at least one item, each with a label",
    path: ["presetItems"],
  },
);
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

// Shared money formatter (display only): "$1,234.50". Used by the form UI, the
// PDF, and the email so a dollar amount renders identically everywhere.
export function formatMoney(n: unknown): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0;
  return `$${v.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Amount for a single line: amount × quantity when quantity applies, else
// amount. Rounded to cents. Shared by the client display + the server store so
// the two never disagree.
export function lineItemTotal(
  item: { amount?: unknown; quantity?: unknown },
  allowQuantity = true,
): number {
  const amountRaw = Number(item?.amount);
  if (!Number.isFinite(amountRaw) || amountRaw < 0) return 0;
  // Round the amount to cents BEFORE multiplying — the server stores the
  // rounded amount, so rounding here too keeps the displayed and stored
  // line/grand totals identical even for >2-decimal input.
  const amount = Math.round(amountRaw * 100) / 100;
  // Quantity only applies when the field's quantity column is enabled. A
  // client can't inflate the total by posting a quantity to a no-quantity
  // field — it's ignored here and stripped from the stored row.
  if (!allowQuantity) return amount;
  // Resolve quantity EXACTLY as the schema preprocess does so the displayed
  // and stored totals agree: blank/non-numeric → 1, negative → 0, otherwise
  // floor + clamp to 100k.
  const q = item?.quantity;
  let quantity: number;
  if (q === undefined || q === null || q === "") {
    quantity = 1;
  } else {
    const n = Number(q);
    if (!Number.isFinite(n)) quantity = 1;
    else if (n < 0) quantity = 0;
    else quantity = Math.min(Math.floor(n), 100_000);
  }
  return Math.round(amount * quantity * 100) / 100;
}

// Grand total = sum of every row across all line_items fields. Stored into each
// `total` field server-side; also drives the total field's live client display.
// Pure so buildSubmissionSchema and DynamicField can share it.
export function computeFormTotal(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
): number {
  let sum = 0;
  for (const f of fields) {
    if (f.type !== "line_items") continue;
    const rows = data[f.id];
    if (!Array.isArray(rows)) continue;
    // Quantity always applies in preset mode (qty of the chosen item); in free
    // mode only when the admin enabled the quantity column.
    const useQty = f.lineItemMode === "preset" || Boolean(f.allowQuantity);
    for (const row of rows) {
      sum += lineItemTotal((row ?? {}) as Record<string, unknown>, useQty);
    }
  }
  return Math.round(sum * 100) / 100;
}

// ── Notification routing (replaces FORM_EMAIL_CONFIG for dynamic forms) ──
// Recipients can be literal emails or {{field.<id>}} references resolved
// against the submission data at send time. e.g. "{{field.email}}" routes
// the confirmation back to the submitter.
export const notificationRuleSchema = z.object({
  recipients: z.array(z.string().min(1).max(320)).min(1),
  subject: z.string().min(1).max(300),
  // Optional custom email body (GF merge-tag parity). Supports
  // `{{field.<id>}}` and `{all_fields}`. When omitted the sender uses the
  // default label/value table body plus a GF-compatible plaintext part.
  body: z.string().max(8000).optional(),
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
    // Display-only blocks carry no input value. `total` is computed
    // server-side from the line_items below (a client-sent total is ignored),
    // so it's skipped here and injected by the transform at the end.
    if (f.type === "section_break" || f.type === "html" || f.type === "total")
      continue;

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
      case "line_items":
        // Each row coerced/validated; the grand total is recomputed in the
        // transform below, never taken from the client.
        leaf = z.array(lineItemValueSchema);
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
      case "time":
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
      if (
        f.type === "file_upload" ||
        f.type === "checkbox_group" ||
        f.type === "line_items"
      ) {
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

  // A required line_items field must have at least one MEANINGFUL row — the
  // leaf's .min(1) only proves the array is non-empty. Preset: a row with a
  // valid in-range index and qty > 0. Free: a row with a positive amount or a
  // non-blank description. Re-checked here (over visible fields) so an
  // all-bogus or all-blank payload can't bypass the requirement.
  if (fields.some((f) => f.type === "line_items" && f.required)) {
    obj = (obj as unknown as z.ZodObject<z.ZodRawShape>).superRefine(
      (data: Record<string, unknown>, ctx: z.RefinementCtx) => {
        const visible = resolveVisibleFieldIds(fields, data);
        for (const f of fields) {
          if (f.type !== "line_items" || !f.required || !visible.has(f.id))
            continue;
          const list = Array.isArray(data[f.id])
            ? (data[f.id] as unknown[])
            : [];
          let meaningful = 0;
          if (f.lineItemMode === "preset") {
            const presets = f.presetItems ?? [];
            meaningful = list.filter((r) => {
              const rec = (r as Record<string, unknown>) ?? {};
              const idx = Number(rec.presetIndex);
              if (!(Number.isInteger(idx) && idx >= 0 && idx < presets.length))
                return false;
              // Preset mode needs an explicit positive quantity — missing/blank
              // is NOT a selection (unlike free mode where blank counts as 1).
              const q =
                rec.quantity === undefined || rec.quantity === null
                  ? 0
                  : Number(rec.quantity);
              return Number.isFinite(q) && q > 0;
            }).length;
          } else {
            meaningful = list.filter((r) => {
              const rec = (r as Record<string, unknown>) ?? {};
              const amt = Number(rec.amount);
              const desc = String(rec.description ?? "").trim();
              return (Number.isFinite(amt) && amt > 0) || desc !== "";
            }).length;
          }
          if (meaningful === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [f.id],
              message: `${f.label} is required`,
            });
          }
        }
      },
    ) as unknown as z.ZodType<Record<string, unknown>>;
  }

  // Commerce normalization, server-authoritative. Runs after the conditional
  // transform (so hidden line_items are already stripped):
  //   1. Drop `quantity` from rows of line_items fields that don't enable the
  //      quantity column, so a client can't post a phantom qty to inflate the
  //      total or pollute the stored/output row.
  //   2. Recompute every `total` field from the normalized rows. A client-sent
  //      total was already stripped from the shape; this sets the real value.
  if (fields.some((f) => f.type === "total" || f.type === "line_items")) {
    obj = (obj as z.ZodType<Record<string, unknown>>).transform(
      (data: Record<string, unknown>) => {
        const out = { ...data };
        for (const f of fields) {
          if (f.type !== "line_items") continue;
          const rows = out[f.id];
          if (!Array.isArray(rows)) continue;
          if (f.lineItemMode === "preset") {
            // Re-derive description + amount from the admin presets by index —
            // a client can never set its own price. Drop rows whose preset
            // index is out of range, and strip the index from storage.
            const presets = f.presetItems ?? [];
            out[f.id] = rows
              .map((r) => {
                const rec = (r ?? {}) as Record<string, unknown>;
                const idx = Number(rec.presetIndex);
                const preset = Number.isInteger(idx) ? presets[idx] : undefined;
                // Drop bogus-index AND zero/negative-quantity rows (the UI
                // treats qty<=0 as unselected) so they don't clutter storage
                // or output with $0 lines.
                // Missing/blank quantity is not a selection in preset mode.
                const q =
                  rec.quantity === undefined || rec.quantity === null
                    ? 0
                    : Number(rec.quantity);
                if (!preset || !Number.isFinite(q) || q <= 0) return null;
                // Keep presetIndex: buildSubmissionSchema also runs in the
                // client zodResolver, and its transformed output is what gets
                // POSTed — stripping the index here would leave the server
                // unable to re-derive/validate it. description + amount are
                // re-derived (server-authoritative); quantity + index pass
                // through.
                const { description: _d, amount: _a, ...rest } = rec;
                void _d;
                void _a;
                return {
                  ...rest,
                  description: preset.label,
                  // Round here too — don't rely on the field def having been
                  // re-parsed through the price-normalizing schema.
                  amount: Math.round((Number(preset.price) || 0) * 100) / 100,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null);
          } else if (!f.allowQuantity) {
            // Free mode without a quantity column → strip phantom quantity.
            out[f.id] = rows.map((r) => {
              const rec = (r ?? {}) as Record<string, unknown>;
              const { quantity: _q, ...rest } = rec;
              void _q;
              return rest;
            });
          }
        }
        const total = computeFormTotal(fields, out);
        // Only persist a total into a VISIBLE total field — a conditionally
        // hidden total must not be stored/emailed/rendered when the submitter
        // never saw it (matches DynamicForm, which hides it client-side).
        const visibleNow = resolveVisibleFieldIds(fields, out);
        for (const f of fields) {
          if (f.type !== "total") continue;
          if (visibleNow.has(f.id)) out[f.id] = total;
          else delete out[f.id];
        }
        return out;
      },
    ) as unknown as z.ZodType<Record<string, unknown>>;
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
    const vis = evaluateCondition(f.conditionalOn, values, isVisible);
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

// ── Notification body merge tags (GF parity) ────────────────────────────
// Single-pass tokenizer: matches `{{field.<id>}}` and `{all_fields}` only in the
// original template so injected user values are never re-scanned as tokens.
const BODY_MERGE_TOKEN =
  /\{\{\s*field\.([a-zA-Z0-9_-]+)\s*\}\}|\{all_fields\}/g;

function escapeNotificationHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtmlFromUserValue(str: string): string {
  return str.replace(/<[^>]*>/g, "");
}

/** Plain-text display value for one field (email body merge tags + plaintext part). */
export function formatFieldDisplayText(
  field: FieldDefinition,
  raw: unknown,
): string {
  if (field.type === "section_break" || field.type === "html") return "";

  switch (field.type) {
    case "name": {
      const n = (raw ?? {}) as { first?: string; last?: string };
      return [n.first?.trim(), n.last?.trim()].filter(Boolean).join(" ");
    }
    case "address": {
      const a = (raw ?? {}) as {
        street?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
      const street = a.street?.trim() ?? "";
      const city = a.city?.trim() ?? "";
      const state = a.state?.trim() ?? "";
      const zip = a.zip?.trim() ?? "";
      const cityStateZip = [
        city,
        [state, zip].filter(Boolean).join(" "),
      ]
        .filter(Boolean)
        .join(", ");
      return [street, cityStateZip].filter(Boolean).join(", ");
    }
    case "checkbox_group": {
      if (!Array.isArray(raw) || raw.length === 0) return "";
      const opts = field.options ?? [];
      return raw
        .map((v) => {
          const hit = opts.find((o) => o.value === String(v));
          return hit?.label ?? String(v);
        })
        .join(", ");
    }
    case "radio":
    case "select": {
      if (raw === undefined || raw === null || raw === "") return "";
      const hit = (field.options ?? []).find((o) => o.value === String(raw));
      return hit?.label ?? String(raw);
    }
    case "line_items": {
      if (!Array.isArray(raw) || raw.length === 0) return "";
      const useQty =
        field.lineItemMode === "preset" || Boolean(field.allowQuantity);
      return raw
        .map((r) => {
          const row = (r ?? {}) as Record<string, unknown>;
          const desc =
            String(row.description ?? "").trim() || "(no description)";
          const amt = formatMoney(Number(row.amount) || 0);
          const qty =
            useQty &&
            row.quantity !== undefined &&
            row.quantity !== null &&
            row.quantity !== ""
              ? ` ×${row.quantity}`
              : "";
          return `${desc} — ${amt}${qty}`;
        })
        .join("\n");
    }
    case "total": {
      if (raw === undefined || raw === null) return "";
      return formatMoney(raw);
    }
    case "file_upload": {
      if (!Array.isArray(raw) || raw.length === 0) return "";
      const n = raw.length;
      return n === 1 ? "(1 file attached)" : `(${n} files attached)`;
    }
    case "consent":
      return raw === true ? "Yes" : "No";
    case "signature":
      return typeof raw === "string" && raw.startsWith("data:image/")
        ? "(signed)"
        : "";
    default: {
      if (raw === undefined || raw === null) return "";
      let s = "";
      if (typeof raw === "string") s = raw;
      else if (typeof raw === "number" || typeof raw === "boolean")
        s = String(raw);
      else if (Array.isArray(raw))
        s = raw.map((v) => String(v)).filter(Boolean).join(", ");
      else if (typeof raw === "object") {
        s = Object.values(raw as Record<string, unknown>)
          .filter(
            (x) => x !== null && x !== undefined && String(x).trim() !== "",
          )
          .map((x) => String(x))
          .join(" ");
      }
      return stripHtmlFromUserValue(s);
    }
  }
}

function formatFieldDisplayHtmlCell(
  field: FieldDefinition,
  raw: unknown,
): string {
  if (field.type === "section_break" || field.type === "html") return "";

  // Structured/special types share the same semantic value; escape for HTML.
  if (
    field.type !== "text" &&
    field.type !== "textarea" &&
    field.type !== "email" &&
    field.type !== "phone" &&
    field.type !== "number" &&
    field.type !== "date" &&
    field.type !== "time"
  ) {
    const text = formatFieldDisplayText(field, raw);
    if (!text) return "";
    return escapeNotificationHtml(text).replace(/\n/g, "<br>");
  }

  if (raw === undefined || raw === null) return "";
  let s = "";
  if (typeof raw === "string") s = raw;
  else if (typeof raw === "number" || typeof raw === "boolean") s = String(raw);
  if (!s.trim()) return "";
  return escapeNotificationHtml(s);
}

function notificationFieldsForBody(
  def: FormDefinition,
  data: Record<string, unknown>,
): FieldDefinition[] {
  const visible = resolveVisibleFieldIds(def.field_schema, data);
  return def.field_schema.filter(
    (f) =>
      visible.has(f.id) && f.type !== "section_break" && f.type !== "html",
  );
}

function renderAllFieldsHtml(
  def: FormDefinition,
  data: Record<string, unknown>,
): string {
  const rows = notificationFieldsForBody(def, data)
    .map((f) => {
      const cellHtml = formatFieldDisplayHtmlCell(f, data[f.id]);
      if (!cellHtml) return "";
      return `<tr>
        <td style="padding:6px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #f0f0f0">${escapeNotificationHtml(f.label)}</td>
        <td style="padding:6px 12px;vertical-align:top;border-bottom:1px solid #f0f0f0">${cellHtml}</td>
      </tr>`;
    })
    .join("");
  return `<table style="border-collapse:collapse;margin:16px 0;min-width:300px">${rows}</table>`;
}

function renderAllFieldsText(
  def: FormDefinition,
  data: Record<string, unknown>,
): string {
  return notificationFieldsForBody(def, data)
    .map((f) => {
      const val = formatFieldDisplayText(f, data[f.id]);
      if (!val) return "";
      return `${f.label}: ${val}`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Expand a notification body template against submission data.
 * Returns HTML (user values escaped) and plain text (HTML tags stripped
 * from user values) suitable for Resend's `html` + `text` parts.
 */
export function renderBodyTemplate(
  template: string,
  def: FormDefinition,
  data: Record<string, unknown>,
): { html: string; text: string } {
  const fieldsById = new Map(def.field_schema.map((f) => [f.id, f]));

  const expandFieldHtml = (fieldId: string): string => {
    const field = fieldsById.get(fieldId);
    if (!field) return "";
    return formatFieldDisplayHtmlCell(field, data[fieldId]);
  };

  const expandFieldText = (fieldId: string): string => {
    const field = fieldsById.get(fieldId);
    if (!field) return "";
    return formatFieldDisplayText(field, data[fieldId]);
  };

  const html = template.replace(BODY_MERGE_TOKEN, (match, fieldId?: string) => {
    if (match === "{all_fields}") return renderAllFieldsHtml(def, data);
    return expandFieldHtml(fieldId ?? "");
  });

  const text = template.replace(BODY_MERGE_TOKEN, (match, fieldId?: string) => {
    if (match === "{all_fields}") return renderAllFieldsText(def, data);
    return expandFieldText(fieldId ?? "");
  });

  return { html, text };
}

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
