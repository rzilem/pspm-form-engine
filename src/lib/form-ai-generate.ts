/**
 * AI form generation: parse, validate, and repair LLM output against the
 * canonical fieldDefinitionSchema. Used by POST /api/admin/forms/generate.
 */
import { z } from "zod";
import {
  FIELD_TYPES,
  fieldDefinitionSchema,
  mintFieldId,
  type FieldDefinition,
  type FieldType,
} from "@/lib/form-definitions";

export const MAX_GENERATED_FIELDS = 40;
export const MAX_PROMPT_LENGTH = 4000;

const FIELD_TYPE_SET = new Set<string>(FIELD_TYPES);

/** Types we tell the model to prefer — all FIELD_TYPES remain valid server-side. */
export const AI_FIELD_TYPE_GUIDANCE = [
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
  "page_break",
  "html",
] as const;

const generatedFormShapeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  fields: z.array(z.unknown()),
});

export type GeneratedFormPayload = z.infer<typeof generatedFormShapeSchema>;

export function isAiGenerationConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-6";
}

/** Extract `{ title, description, fields }` from raw model output (tool input or JSON text). */
export function extractGeneratedFormPayload(raw: unknown): GeneratedFormPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  // Tool input may nest under a tool name key — accept flat shape only.
  const candidate = {
    title: obj.title,
    description: obj.description ?? "",
    fields: obj.fields,
  };

  const parsed = generatedFormShapeSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/** Try to parse a JSON string; strip markdown fences if present. */
export function parseJsonFromModelText(text: string): unknown | null {
  let trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fence) trimmed = fence[1].trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

const OPTION_FIELD_TYPES = new Set<FieldType>([
  "radio",
  "checkbox_group",
  "select",
  "image_choice",
]);

function coerceFieldType(raw: unknown): FieldType | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  return FIELD_TYPE_SET.has(t) ? (t as FieldType) : null;
}

function coerceString(raw: unknown, max: number): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  return s.slice(0, max);
}

function repairOptions(raw: unknown): FieldDefinition["options"] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<FieldDefinition["options"]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = coerceString(row.label, 200);
    if (!label) continue;
    const value = coerceString(row.value, 200) ?? label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 200);
    if (!value) continue;
    out.push({ value, label });
    if (out.length >= 50) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Coerce one raw field object toward FieldDefinition shape before Zod validation.
 * Drops unknown types; strips LLM-provided ids (re-minted later).
 */
export function coerceRawField(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;

  const type = coerceFieldType(src.type);
  if (!type) return null;

  const label = coerceString(src.label, 200);
  if (!label && type !== "section_break" && type !== "page_break" && type !== "html") {
    return null;
  }

  const out: Record<string, unknown> = {
    id: "pending",
    label: label ?? (type === "section_break" ? "Section" : type === "page_break" ? "Page break" : "Content"),
    type,
    required: Boolean(src.required),
  };

  const helpText = coerceString(src.helpText ?? src.help_text, 500);
  if (helpText) out.helpText = helpText;

  const placeholder = coerceString(src.placeholder, 200);
  if (placeholder) out.placeholder = placeholder;

  if (OPTION_FIELD_TYPES.has(type)) {
    const options = repairOptions(src.options);
    if (options) out.options = options;
    else if (type !== "image_choice") {
      out.options = [
        { value: "option_1", label: "Option 1" },
        { value: "option_2", label: "Option 2" },
      ];
    }
  }

  if (type === "html") {
    const html = coerceString(src.html, 20000);
    if (html) out.html = html;
  }

  if (type === "consent") {
    out.required = true;
  }

  return out;
}

/**
 * Validate and repair an array of raw field objects: mint ids, drop invalid
 * entries, cap at MAX_GENERATED_FIELDS.
 */
export function validateAndRepairGeneratedFields(rawFields: unknown[]): FieldDefinition[] {
  const taken = new Set<string>();
  const out: FieldDefinition[] = [];

  for (const raw of rawFields) {
    if (out.length >= MAX_GENERATED_FIELDS) break;

    const coerced = coerceRawField(raw);
    if (!coerced) continue;

    const label = String(coerced.label);
    const id = mintFieldId(label, taken);
    taken.add(id);
    coerced.id = id;

    const parsed = fieldDefinitionSchema.safeParse(coerced);
    if (parsed.success) {
      out.push(parsed.data);
    }
  }

  return out;
}

export type ProcessGeneratedFormResult =
  | { ok: true; title: string; description: string; fields: FieldDefinition[] }
  | { ok: false; error: string };

/**
 * Full pipeline: extract shape from model output, validate fields, require
 * at least one field.
 */
export function processGeneratedForm(raw: unknown): ProcessGeneratedFormResult {
  const payload = extractGeneratedFormPayload(raw);
  if (!payload) {
    return { ok: false, error: "Model output was not a valid form object (need title + fields array)." };
  }

  const title = payload.title.trim();
  if (!title) {
    return { ok: false, error: "Generated form is missing a title." };
  }

  const fields = validateAndRepairGeneratedFields(
    Array.isArray(payload.fields) ? payload.fields : [],
  );

  if (fields.length === 0) {
    return { ok: false, error: "No valid fields could be parsed from the model output." };
  }

  const description = (payload.description ?? "").trim().slice(0, 2000);

  return { ok: true, title, description, fields };
}

export function buildAiFormSystemPrompt(): string {
  const types = AI_FIELD_TYPE_GUIDANCE.join(", ");
  const allTypes = FIELD_TYPES.join(", ");

  return `You are a form builder assistant for PS Property Management's dynamic form engine.

Available field types (use ONLY these — any other type will be rejected):
${allTypes}

Prefer these commonly useful types when appropriate: ${types}.

Each field object shape:
{
  "id": string (ignored — server reassigns),
  "label": string (required for input fields; section_break uses it as heading),
  "type": one of the allowed types,
  "required": boolean (default false; consent should be required),
  "helpText": optional string,
  "placeholder": optional string,
  "options": optional array of { "value": string, "label": string } for radio, checkbox_group, select, image_choice,
  "html": optional string for type "html" only
}

Rules:
- Return a practical HOA/community-management form matching the user's description.
- Use section_break to group related fields; page_break for multi-page wizards when the form is long.
- For choice fields always include at least two options with distinct value/label pairs.
- Do not include payment, line_items, list, total, or image_choice unless the user explicitly asks.
- Never invent fields the user did not imply; keep forms focused.
- Maximum ${MAX_GENERATED_FIELDS} fields.

You MUST call the submit_form_definition tool with:
{ "title": string, "description": string, "fields": FieldDefinition[] }`;
}

export const SUBMIT_FORM_DEFINITION_TOOL = {
  name: "submit_form_definition",
  description:
    "Submit the generated form definition with title, description, and fields array.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: { type: "string", description: "Form title shown to respondents" },
      description: {
        type: "string",
        description: "Short intro text shown above the form",
      },
      fields: {
        type: "array",
        description: "Ordered list of form fields",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            type: { type: "string" },
            required: { type: "boolean" },
            helpText: { type: "string" },
            placeholder: { type: "string" },
            options: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  value: { type: "string" },
                  label: { type: "string" },
                },
                required: ["value", "label"],
              },
            },
            html: { type: "string" },
          },
          required: ["label", "type"],
        },
      },
    },
    required: ["title", "fields"],
  },
};