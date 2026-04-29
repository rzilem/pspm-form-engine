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
  confirmation_message: z.string().min(1).max(500),
  recaptcha_required: z.boolean(),
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

  for (const f of fields) {
    if (f.type === "section_break") continue;

    let leaf: z.ZodTypeAny;

    switch (f.type) {
      case "email":
        leaf = z.string().email("Please enter a valid email address");
        break;
      case "phone":
        leaf = z.string().min(7).max(40);
        break;
      case "number":
        leaf = z.coerce.number();
        if (f.validation?.min !== undefined) {
          leaf = (leaf as z.ZodNumber).min(f.validation.min);
        }
        if (f.validation?.max !== undefined) {
          leaf = (leaf as z.ZodNumber).max(f.validation.max);
        }
        break;
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
        // Consent must be checked (true) when required; ignored otherwise.
        leaf = f.required
          ? z.literal(true, { message: "You must agree to continue" })
          : z.boolean().optional();
        break;
      case "name":
        leaf = z.object({
          first: z.string().max(100),
          last: z.string().max(100),
        });
        if (f.required) {
          leaf = (leaf as z.ZodObject<z.ZodRawShape>).refine(
            (v: { first?: string; last?: string }) =>
              Boolean(v?.first?.trim()) && Boolean(v?.last?.trim()),
            { message: "First and last name are required" },
          );
        }
        break;
      case "address":
        leaf = z.object({
          street: z.string().max(200).optional(),
          city: z.string().max(100).optional(),
          state: z.string().max(50).optional(),
          zip: z.string().max(20).optional(),
        });
        break;
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
          s = s.regex(
            new RegExp(f.validation.pattern),
            f.validation.patternMessage ?? "Invalid format",
          );
        }
        leaf = s;
        break;
      }
    }

    // Required gating. For string-ish leaves we treat empty string as missing
    // so that `required: false` doesn't reject blank fields. file_upload
    // (array) and signature (string) need their own required predicates.
    if (f.required && f.type !== "consent" && f.type !== "name") {
      if (f.type === "file_upload") {
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
    } else if (!f.required && f.type !== "consent") {
      leaf = leaf.optional();
    }

    // Conditional fields: when `conditionalOn` is set the field is optional
    // unless the trigger condition is met. Server-side this is enforced via
    // a `superRefine` on the parent object; we capture the rule here via a
    // sentinel attribute the refine pass reads back.
    shape[f.id] = leaf;
  }

  let obj = z.object(shape) as unknown as z.ZodType<Record<string, unknown>>;

  // Apply conditional-required rules in a single superRefine pass so we
  // can inspect sibling fields.
  const conditionals = fields.filter(
    (f) => f.required && f.conditionalOn && f.type !== "section_break",
  );
  if (conditionals.length > 0) {
    obj = (obj as unknown as z.ZodObject<z.ZodRawShape>).superRefine(
      (data: Record<string, unknown>, ctx: z.RefinementCtx) => {
        for (const f of conditionals) {
          if (!f.conditionalOn) continue;
          const trigger = data[f.conditionalOn.fieldId];
          const matches = Array.isArray(f.conditionalOn.equals)
            ? f.conditionalOn.equals.includes(String(trigger ?? ""))
            : String(trigger ?? "") === f.conditionalOn.equals;
          if (!matches) continue;
          const value = data[f.id];
          const missing =
            value === undefined ||
            value === null ||
            (typeof value === "string" && value.trim() === "") ||
            (Array.isArray(value) && value.length === 0);
          if (missing) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `${f.label} is required`,
              path: [f.id],
            });
          }
        }
      },
    ) as unknown as z.ZodType<Record<string, unknown>>;
  }

  return obj;
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
