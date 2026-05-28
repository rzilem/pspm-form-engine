"use client";

import { useMemo } from "react";
import { FormEngine } from "@/components/forms/FormEngine";
import { DynamicField } from "@/components/forms/DynamicField";
import {
  buildSubmissionSchema,
  resolveVisibleFieldIds,
  type FormDefinition,
} from "@/lib/form-definitions";

interface DynamicFormProps {
  definition: FormDefinition;
}

/**
 * Client-side wrapper around FormEngine that derives a Zod schema and
 * default values from a FormDefinition, then renders one DynamicField per
 * entry in field_schema. The server-side validator at /api/submit
 * recomputes the schema independently — this client copy is purely UX
 * (pre-submit error display).
 */
export function DynamicForm({ definition }: DynamicFormProps) {
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
      if (f.type === "section_break") continue;
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
          <div className="space-y-5">
            {definition.field_schema
              .filter((field) => visible.has(field.id))
              .map((field) => (
                <DynamicField
                  key={field.id}
                  field={field}
                  formSlug={definition.slug}
                />
              ))}
          </div>
        );
      }}
    </FormEngine>
  );
}
