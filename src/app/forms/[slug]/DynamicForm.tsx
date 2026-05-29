"use client";

import { useMemo } from "react";
import { FormEngine } from "@/components/forms/FormEngine";
import { DynamicField } from "@/components/forms/DynamicField";
import {
  buildSubmissionSchema,
  resolveVisibleFieldIds,
  type FieldType,
  type FormDefinition,
} from "@/lib/form-definitions";

// Field types compact enough to sit two-per-row when the form is wide.
// Everything else (composites, multi-option, long text, layout, uploads)
// spans the full width to stay readable. Driven by the FORM's own width via
// a container query, so a narrow iframe stays single-column regardless of the
// viewport.
const HALF_WIDTH_TYPES = new Set<FieldType>([
  "text",
  "email",
  "phone",
  "number",
  "date",
  "time",
  "select",
]);

interface DynamicFormProps {
  definition: FormDefinition;
  // Builder live-preview: render exactly as end users see it but never submit.
  preview?: boolean;
}

/**
 * Client-side wrapper around FormEngine that derives a Zod schema and
 * default values from a FormDefinition, then renders one DynamicField per
 * entry in field_schema. The server-side validator at /api/submit
 * recomputes the schema independently — this client copy is purely UX
 * (pre-submit error display).
 */
export function DynamicForm({ definition, preview = false }: DynamicFormProps) {
  const schema = useMemo(
    () => buildSubmissionSchema(definition.field_schema),
    [definition.field_schema],
  );

  // Default values shape mirrors the field types so react-hook-form has
  // something to register against on first render. Section breaks are
  // skipped (no value).
  const defaultValues = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const f of definition.field_schema) {
      if (f.type === "section_break" || f.type === "html") continue;
      if (f.type === "consent") out[f.id] = false;
      else if (f.type === "checkbox_group" || f.type === "file_upload")
        out[f.id] = [];
      else if (f.type === "name") out[f.id] = { first: "", last: "" };
      else if (f.type === "address")
        out[f.id] = { street: "", city: "", state: "", zip: "" };
      else out[f.id] = "";
    }
    return out;
  }, [definition.field_schema]);

  return (
    <FormEngine
      schema={schema}
      formSlug={definition.slug}
      defaultValues={defaultValues}
      confirmationMessage={definition.confirmation_message}
      recaptcha={definition.recaptcha_required}
      preview={preview}
    >
      {({ watch }) => {
        // Compute visibility with the SAME transitive resolver the server uses,
        // so the rendered fields always match what the server will validate and
        // keep — a field gated on a now-hidden ancestor is hidden here too.
        const values = watch() as Record<string, unknown>;
        const visible = resolveVisibleFieldIds(
          definition.field_schema,
          values,
        );
        return (
          // @container makes the column count respond to the form's own width
          // (not the viewport), so a narrow embed iframe stays single-column
          // while a wide/full-width embed lays compact fields two-per-row.
          <div className="@container">
            <div className="grid grid-cols-1 gap-5 @2xl:grid-cols-2">
              {definition.field_schema
                .filter((field) => visible.has(field.id))
                .map((field) => (
                  <div
                    key={field.id}
                    className={
                      HALF_WIDTH_TYPES.has(field.type) ? "" : "@2xl:col-span-2"
                    }
                  >
                    <DynamicField
                      field={field}
                      formSlug={definition.slug}
                      preview={preview}
                    />
                  </div>
                ))}
            </div>
          </div>
        );
      }}
    </FormEngine>
  );
}
