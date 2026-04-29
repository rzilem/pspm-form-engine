/**
 * Gravity Forms JSON → FormDefinition importer.
 *
 * Source format: the JSON produced by `Forms → Import/Export → Export Forms`
 * in WP admin (or the REST endpoint /wp-json/gf/v2/forms/<id>). Both produce
 * the same shape: `{ "0": { ...form }, "version": "..." }` for full exports,
 * or a single form object for the REST GET. This module accepts either.
 *
 * The mapping is deliberately conservative — when in doubt we land on
 * "text" rather than skip. Unsupported types (page break, list, post-*)
 * emit a `warnings` entry so the admin can decide whether to redo by hand.
 */
import { z } from "zod";
import {
  fieldDefinitionSchema,
  notificationConfigSchema,
  type FieldDefinition,
  type FieldOption,
  type NotificationConfig,
} from "@/lib/form-definitions";

// ── GF export schema (the parts we use) ────────────────────────────────
// GF mixes string and integer types in JSON ("isRequired" can be true,
// "1", or "" depending on version), so everything passes through a
// loose-typed parse and gets coerced explicitly.

const gfChoiceSchema = z.object({
  text: z.string().optional(),
  value: z.string().optional(),
}).passthrough();

const gfFieldSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    type: z.string(),
    label: z.string().optional(),
    adminLabel: z.string().optional(),
    isRequired: z.unknown().optional(),
    placeholder: z.string().optional(),
    description: z.string().optional(),
    choices: z.array(gfChoiceSchema).optional(),
    inputs: z.array(z.unknown()).optional(),
    pageNumber: z.union([z.string(), z.number()]).optional(),
    cssClass: z.string().optional(),
  })
  .passthrough();

const gfNotificationSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    to: z.string().optional(),
    toType: z.string().optional(),
    subject: z.string().optional(),
    message: z.string().optional(),
    isActive: z.unknown().optional(),
  })
  .passthrough();

const gfFormSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    title: z.string(),
    description: z.string().optional(),
    fields: z.array(gfFieldSchema).default([]),
    notifications: z
      .union([
        z.array(gfNotificationSchema),
        z.record(z.string(), gfNotificationSchema),
      ])
      .optional(),
    confirmation: z
      .object({
        message: z.string().optional(),
      })
      .passthrough()
      .optional(),
    confirmations: z
      .union([
        z.array(z.unknown()),
        z.record(z.string(), z.unknown()),
      ])
      .optional(),
  })
  .passthrough();

export type GfField = z.infer<typeof gfFieldSchema>;

// Top-level: GF export is `{ "0": form, "1": form, ..., "version": "..." }`.
// We accept either that shape, an array of forms, or a single form object.
function extractForms(raw: unknown): GfFormPart[] {
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw)) {
      return raw.flatMap((r) => extractForms(r));
    }
    const obj = raw as Record<string, unknown>;
    // Single form
    if ("title" in obj && "fields" in obj) {
      const parsed = gfFormSchema.safeParse(obj);
      if (parsed.success) return [parsed.data];
      return [];
    }
    // Multi-form export: numeric keys point at forms.
    const items: GfFormPart[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (k === "version") continue;
      const parsed = gfFormSchema.safeParse(v);
      if (parsed.success) items.push(parsed.data);
    }
    return items;
  }
  return [];
}

type GfFormPart = z.infer<typeof gfFormSchema>;

// ── Field type mapping ─────────────────────────────────────────────────
// Each GF type lands on one of our FieldDefinition types or generates a
// warning when we don't have a 1:1 mapping. Composites (name, address)
// flatten to our composite types; "fileupload" → file_upload; "list" →
// warning.
const FIELD_TYPE_MAP: Record<string, FieldDefinition["type"] | null> = {
  text: "text",
  textarea: "textarea",
  email: "email",
  phone: "phone",
  number: "number",
  radio: "radio",
  checkbox: "checkbox_group",
  select: "select",
  multiselect: "select", // close enough for v1
  date: "date",
  name: "name",
  address: "address",
  consent: "consent",
  fileupload: "file_upload",
  signature: "signature",
  section: "section_break",
  hidden: "text", // map to text so the value still gets captured
  // Unsupported — warn and skip. Listed explicitly so we don't silently
  // map them via the default.
  page: null,
  list: null,
  post_title: null,
  post_content: null,
  post_image: null,
  product: null,
  total: null,
  shipping: null,
  option: null,
  quantity: null,
  donation: null,
  creditcard: null,
  password: null,
  captcha: null,
  html: null,
};

interface ImportWarning {
  fieldLabel: string;
  fieldType: string;
  reason: string;
}

export interface ImportResult {
  field_schema: FieldDefinition[];
  notification_config: NotificationConfig;
  description: string | null;
  confirmation_message: string;
  warnings: ImportWarning[];
  title: string;
  // Sourced from GF id; admin can override before save.
  suggestedSlug: string;
}

function coerceBool(v: unknown): boolean {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  return false;
}

function slugify(s: string, fallback: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return out || fallback;
}

function sanitizeId(rawId: unknown, idx: number): string {
  const s = String(rawId ?? `f${idx}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) return `f${idx}`;
  return s.slice(0, 64);
}

function mapField(
  gf: GfField,
  idx: number,
  warnings: ImportWarning[],
): FieldDefinition | null {
  const mappedType = FIELD_TYPE_MAP[gf.type];
  if (mappedType === undefined) {
    warnings.push({
      fieldLabel: gf.label ?? `(field ${idx})`,
      fieldType: gf.type,
      reason: "Unknown GF field type — skipped",
    });
    return null;
  }
  if (mappedType === null) {
    warnings.push({
      fieldLabel: gf.label ?? `(field ${idx})`,
      fieldType: gf.type,
      reason: "GF type has no equivalent in form-engine — skipped",
    });
    return null;
  }

  const id = sanitizeId(gf.id, idx);
  const label = (gf.label ?? gf.adminLabel ?? `Field ${idx + 1}`).slice(0, 200);
  const required = coerceBool(gf.isRequired);
  const helpText = gf.description?.slice(0, 500);
  const placeholder = gf.placeholder?.slice(0, 200);

  let options: FieldOption[] | undefined;
  if (gf.choices && (mappedType === "radio" || mappedType === "select" || mappedType === "checkbox_group")) {
    options = gf.choices
      .map((c) => {
        const value = (c.value ?? c.text ?? "").toString().slice(0, 200);
        const opLabel = (c.text ?? c.value ?? "").toString().slice(0, 200);
        if (!value || !opLabel) return null;
        return { value, label: opLabel };
      })
      .filter((c): c is FieldOption => c !== null);
    if (options.length === 0) options = undefined;
  }

  const def: FieldDefinition = {
    id,
    label,
    type: mappedType,
    required,
    helpText,
    placeholder,
    options,
  };
  // Validate against the canonical schema so a bad GF row surfaces here
  // rather than as a runtime crash later.
  const parsed = fieldDefinitionSchema.safeParse(def);
  if (!parsed.success) {
    warnings.push({
      fieldLabel: label,
      fieldType: gf.type,
      reason: `Field failed validation: ${parsed.error.issues
        .map((i) => i.message)
        .join("; ")}`,
    });
    return null;
  }
  return parsed.data;
}

function mapNotifications(
  notifs: GfFormPart["notifications"],
  fields: FieldDefinition[],
  warnings: ImportWarning[],
): NotificationConfig {
  if (!notifs) return { rules: [] };

  // Flatten array-or-object shapes into a list.
  const list = Array.isArray(notifs) ? notifs : Object.values(notifs);

  const rules: NotificationConfig["rules"] = [];
  for (const n of list) {
    if (!coerceBool(n.isActive ?? true)) continue;
    const rawTo = (n.to ?? "").toString();
    if (!rawTo) continue;
    const ruleName = (n.name ?? n.subject ?? "(unnamed notification)").toString().slice(0, 80);
    // GF supports `to` as either a literal email, comma-separated emails,
    // or a merge tag like `{Email:3}` referring to a field id. Translate
    // merge tags to {{field.<id>}} when the id matches a known field.
    // Tag forms in the wild include `{Email:3}` and `{Community Name:1:value}`
    // — the optional `:modifier` suffix needs to be tolerated, otherwise
    // recipients get silently dropped.
    const tagRe = /\{[^:}]+:(\d+)(?::[^}]*)?\}/;
    const recipients: string[] = [];
    for (const part of rawTo.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const tagMatch = trimmed.match(tagRe);
      if (tagMatch && fields.find((f) => f.id === tagMatch[1])) {
        recipients.push(`{{field.${tagMatch[1]}}}`);
        continue;
      }
      if (tagMatch) {
        // Tag pointed at a field id we couldn't find. Keep going but warn
        // so the admin knows the importer dropped a recipient and which
        // notification to fix in the editor.
        warnings.push({
          fieldLabel: ruleName,
          fieldType: "notification.to",
          reason: `Merge tag "${trimmed}" references field id ${tagMatch[1]} which is not in the imported field schema — recipient dropped`,
        });
        continue;
      }
      if (trimmed.includes("@")) {
        recipients.push(trimmed);
        continue;
      }
      // Common non-portable values:
      //   {admin_email}        — GF macro for the WP admin email
      //   2 / 8                — bare numeric user/role ids
      //   {user:email} etc.    — runtime macros that don't have a field id
      // We can't translate these, so warn instead of dropping silently.
      // Submissions on the new form would otherwise succeed but no email
      // would ever fire — see open question in MILESTONE plan.
      warnings.push({
        fieldLabel: ruleName,
        fieldType: "notification.to",
        reason: `Recipient "${trimmed}" has no portable form-engine equivalent — add a real email in the form editor before publishing`,
      });
    }
    if (recipients.length === 0) {
      // Whole rule contributed zero usable recipients; the warnings above
      // already explain why. Skip emitting an empty rule.
      continue;
    }
    const subject = (n.subject ?? "").slice(0, 300) || "Form submission";
    rules.push({ recipients, subject });
  }
  const parsed = notificationConfigSchema.safeParse({ rules });
  if (!parsed.success) return { rules: [] };
  return parsed.data;
}

function extractConfirmation(form: GfFormPart): string {
  if (form.confirmation?.message) {
    return form.confirmation.message.slice(0, 500);
  }
  if (form.confirmations) {
    const list = Array.isArray(form.confirmations)
      ? form.confirmations
      : Object.values(form.confirmations);
    for (const c of list) {
      if (
        c &&
        typeof c === "object" &&
        "message" in c &&
        typeof (c as { message?: unknown }).message === "string"
      ) {
        return ((c as { message: string }).message).slice(0, 500);
      }
    }
  }
  return "Thanks — your submission has been received.";
}

/**
 * Convert one parsed GF form to a draft FormDefinition shape (without
 * id/timestamps; the admin POST endpoint fills those in). Returns
 * warnings alongside so the admin UI can show "11 fields imported,
 * 2 skipped" before they hit save.
 */
export function convertGfForm(form: GfFormPart): ImportResult {
  const warnings: ImportWarning[] = [];
  const fields: FieldDefinition[] = [];
  for (let i = 0; i < form.fields.length; i++) {
    const mapped = mapField(form.fields[i], i, warnings);
    if (mapped) fields.push(mapped);
  }

  const title = form.title.slice(0, 200);
  const suggestedSlug = slugify(title, `gf-${form.id ?? "imported"}`);

  return {
    title,
    suggestedSlug,
    description: form.description?.slice(0, 2000) ?? null,
    field_schema: fields,
    notification_config: mapNotifications(form.notifications, fields, warnings),
    confirmation_message: extractConfirmation(form),
    warnings,
  };
}

/**
 * Top-level entry point. Hands back a list of import results — one per
 * form found in the export — so the admin can pick which to migrate.
 * Throws on unparseable JSON; never swallows.
 */
export function importGfExport(raw: unknown): ImportResult[] {
  const forms = extractForms(raw);
  return forms.map(convertGfForm);
}
