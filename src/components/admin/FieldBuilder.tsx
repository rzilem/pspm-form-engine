"use client";

import { useCallback } from "react";
import { TextInput } from "@/components/ui/TextInput";
import { SelectField } from "@/components/ui/SelectField";
import { Button } from "@/components/ui/Button";
import {
  FIELD_TYPES,
  type FieldDefinition,
  type FieldOption,
  type FieldType,
} from "@/lib/form-definitions";

interface FieldBuilderProps {
  value: FieldDefinition[];
  onChange: (next: FieldDefinition[]) => void;
}

// Human-friendly labels for the type dropdown. Falls back to the raw key.
const TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  textarea: "Paragraph (textarea)",
  email: "Email",
  phone: "Phone",
  number: "Number",
  radio: "Radio buttons",
  checkbox_group: "Checkboxes (multi-select)",
  select: "Dropdown (select)",
  date: "Date",
  name: "Name (first + last)",
  address: "Address",
  consent: "Consent checkbox",
  file_upload: "File upload",
  signature: "Signature",
  section_break: "Section heading",
};

const TYPE_OPTIONS = FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));

// Field types that surface an option list (value/label pairs).
const TYPES_WITH_OPTIONS: ReadonlySet<FieldType> = new Set<FieldType>([
  "radio",
  "select",
  "checkbox_group",
]);

// Field types that take a free-text placeholder. Choice/structured types ignore it.
const TYPES_WITH_PLACEHOLDER: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
]);

// Field types whose validation block exposes length + pattern controls.
const TYPES_WITH_LENGTH_VALIDATION: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "textarea",
]);

/**
 * Generate a stable, collision-free id for a NEWLY added field.
 *
 * Existing fields keep their original id (imported forms use numeric strings
 * like "1","6" that downstream submission data + notification tokens reference
 * — renumbering them would orphan that data). New fields get a slug of the
 * label, or `field_<n>` when the label is empty/non-alphanumeric. The result
 * is clamped to the 1-64 char contract in form-definitions.ts.
 */
function makeFieldId(label: string, taken: ReadonlySet<string>): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);

  const base = slug || "field";
  if (!taken.has(base) && base.length <= 64) return base;

  for (let n = 2; n < 100000; n += 1) {
    const candidate = `${base}_${n}`.slice(0, 64);
    if (!taken.has(candidate)) return candidate;
  }
  // Practically unreachable; guarantees a return for the type checker.
  return `field_${Date.now()}`.slice(0, 64);
}

export function FieldBuilder({ value, onChange }: FieldBuilderProps) {
  const updateField = useCallback(
    (index: number, patch: Partial<FieldDefinition>) => {
      const next = value.map((f, i) => (i === index ? { ...f, ...patch } : f));
      const updated = next[index];
      // A section break can't be a trigger (no submitted value), so if this
      // field just became one, drop conditional logic in fields that pointed at
      // it — a dangling trigger would hide/wrongly-show dependents at runtime.
      if (updated?.type === "section_break") {
        const id = updated.id;
        onChange(
          next.map((f, i) =>
            i !== index && f.conditionalOn?.fieldId === id
              ? { ...f, conditionalOn: undefined }
              : f,
          ),
        );
        return;
      }
      onChange(next);
    },
    [value, onChange],
  );

  const moveField = useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= value.length) return;
      const next = value.slice();
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      onChange(next);
    },
    [value, onChange],
  );

  const deleteField = useCallback(
    (index: number) => {
      const f = value[index];
      const name = f?.label?.trim() || f?.id || "this field";
      if (!confirm(`Delete "${name}"? This cannot be undone until you save.`)) return;
      const deletedId = f?.id;
      // Also drop any conditional logic that pointed at the deleted field —
      // a dangling conditionalOn.fieldId would leave dependents permanently
      // hidden (or wrongly shown for equals: "") at runtime.
      onChange(
        value
          .filter((_, i) => i !== index)
          .map((other) =>
            other.conditionalOn?.fieldId === deletedId
              ? { ...other, conditionalOn: undefined }
              : other,
          ),
      );
    },
    [value, onChange],
  );

  const addField = useCallback(() => {
    const taken = new Set(value.map((f) => f.id));
    const id = makeFieldId("", taken);
    const next: FieldDefinition = {
      id,
      label: "New field",
      type: "text",
      required: false,
    };
    onChange([...value, next]);
  }, [value, onChange]);

  return (
    <div className="space-y-4">
      {value.length === 0 && (
        <p className="rounded-[8px] border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
          No fields yet. Click <strong>Add field</strong> to build your form.
        </p>
      )}

      {value.map((field, index) => (
        <FieldCard
          key={field.id}
          field={field}
          index={index}
          total={value.length}
          allFields={value}
          onPatch={(patch) => updateField(index, patch)}
          onMoveUp={() => moveField(index, -1)}
          onMoveDown={() => moveField(index, 1)}
          onDelete={() => deleteField(index)}
        />
      ))}

      <Button type="button" variant="outline" onClick={addField}>
        + Add field
      </Button>
    </div>
  );
}

interface FieldCardProps {
  field: FieldDefinition;
  index: number;
  total: number;
  allFields: FieldDefinition[];
  onPatch: (patch: Partial<FieldDefinition>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function FieldCard({
  field,
  index,
  total,
  allFields,
  onPatch,
  onMoveUp,
  onMoveDown,
  onDelete,
}: FieldCardProps) {
  const isSectionBreak = field.type === "section_break";
  const showOptions = TYPES_WITH_OPTIONS.has(field.type);
  const showPlaceholder = TYPES_WITH_PLACEHOLDER.has(field.type);
  const showLengthValidation = TYPES_WITH_LENGTH_VALIDATION.has(field.type);
  const showNumberValidation = field.type === "number";
  const showValidationSection = showLengthValidation || showNumberValidation;

  // Flag a malformed regex so the admin sees it here. The schema builder also
  // guards new RegExp, so a bad pattern is ignored rather than crashing the
  // form — but silently ignoring it would be surprising.
  let patternError: string | undefined;
  if (field.validation?.pattern) {
    try {
      new RegExp(field.validation.pattern);
    } catch {
      patternError = "Not a valid regular expression — this pattern will be ignored.";
    }
  }

  return (
    <div className="rounded-[12px] border border-border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-muted">
          #{index + 1} · id: <span className="text-foreground">{field.id}</span>
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index === 0}
            onClick={onMoveUp}
            aria-label="Move field up"
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={index === total - 1}
            onClick={onMoveDown}
            aria-label="Move field down"
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onDelete}
            aria-label="Delete field"
            className="!border-error !text-error hover:!bg-error-light"
          >
            Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextInput
          label={isSectionBreak ? "Heading text" : "Label"}
          value={field.label}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
        <SelectField
          label="Type"
          value={field.type}
          onChange={(e) => onPatch({ type: e.target.value as FieldType })}
          options={TYPE_OPTIONS}
        />
      </div>

      {!isSectionBreak && (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={field.required ?? false}
            onChange={(e) => onPatch({ required: e.target.checked })}
            className="w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40"
          />
          Required
        </label>
      )}

      <TextInput
        label={isSectionBreak ? "Sub-heading / help text" : "Help text"}
        value={field.helpText ?? ""}
        onChange={(e) => onPatch({ helpText: e.target.value || undefined })}
        helperText="Optional. Shown under the field."
      />

      {showPlaceholder && (
        <TextInput
          label="Placeholder"
          value={field.placeholder ?? ""}
          onChange={(e) => onPatch({ placeholder: e.target.value || undefined })}
          helperText="Optional. Greyed-out hint text inside the field."
        />
      )}

      {showOptions && (
        <OptionsEditor
          options={field.options ?? []}
          onChange={(options) => onPatch({ options })}
        />
      )}

      {showValidationSection && (
        <details className="rounded-[8px] border border-border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Validation (optional)
          </summary>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {showLengthValidation && (
              <>
                <NumberInput
                  label="Min length"
                  value={field.validation?.minLength}
                  onChange={(n) =>
                    onPatch({ validation: patchValidation(field, { minLength: n }) })
                  }
                />
                <NumberInput
                  label="Max length"
                  value={field.validation?.maxLength}
                  onChange={(n) =>
                    onPatch({ validation: patchValidation(field, { maxLength: n }) })
                  }
                />
                <TextInput
                  label="Pattern (regex)"
                  value={field.validation?.pattern ?? ""}
                  onChange={(e) =>
                    onPatch({
                      validation: patchValidation(field, {
                        pattern: e.target.value || undefined,
                      }),
                    })
                  }
                  className="sm:col-span-2"
                  helperText="Advanced. e.g. ^[A-Z]{2}[0-9]{4}$"
                  error={patternError ? { message: patternError } : undefined}
                />
                <TextInput
                  label="Pattern error message"
                  value={field.validation?.patternMessage ?? ""}
                  onChange={(e) =>
                    onPatch({
                      validation: patchValidation(field, {
                        patternMessage: e.target.value || undefined,
                      }),
                    })
                  }
                  className="sm:col-span-2"
                />
              </>
            )}
            {showNumberValidation && (
              <>
                <NumberInput
                  label="Minimum value"
                  value={field.validation?.min}
                  onChange={(n) =>
                    onPatch({ validation: patchValidation(field, { min: n }) })
                  }
                />
                <NumberInput
                  label="Maximum value"
                  value={field.validation?.max}
                  onChange={(n) =>
                    onPatch({ validation: patchValidation(field, { max: n }) })
                  }
                />
              </>
            )}
          </div>
        </details>
      )}

      <ConditionalEditor
        field={field}
        allFields={allFields}
        index={index}
        onPatch={onPatch}
      />
    </div>
  );
}

// Merge a partial validation patch into the field's existing validation,
// dropping the whole object when every key ends up undefined so we don't
// persist an empty `validation: {}`.
function patchValidation(
  field: FieldDefinition,
  patch: Partial<NonNullable<FieldDefinition["validation"]>>,
): FieldDefinition["validation"] {
  const merged = { ...field.validation, ...patch };
  const hasAny = Object.values(merged).some((v) => v !== undefined);
  return hasAny ? merged : undefined;
}

interface NumberInputProps {
  label: string;
  value: number | undefined;
  onChange: (n: number | undefined) => void;
}

// Wraps TextInput for numeric values: empty string clears to undefined so an
// optional bound isn't forced to 0.
function NumberInput({ label, value, onChange }: NumberInputProps) {
  return (
    <TextInput
      label={label}
      type="number"
      value={value ?? ""}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const n = Number(raw);
        onChange(Number.isFinite(n) ? n : undefined);
      }}
    />
  );
}

interface OptionsEditorProps {
  options: FieldOption[];
  onChange: (next: FieldOption[]) => void;
}

function OptionsEditor({ options, onChange }: OptionsEditorProps) {
  const updateOption = (index: number, patch: Partial<FieldOption>) => {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };
  const removeOption = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };
  const addOption = () => {
    onChange([...options, { value: "", label: "" }]);
  };

  return (
    <div className="rounded-[8px] border border-border px-3 py-3 space-y-2">
      <p className="text-sm font-medium text-foreground">Options</p>
      {options.length === 0 && (
        <p className="text-xs text-muted">No options yet. Add at least one choice.</p>
      )}
      {options.map((opt, i) => (
        <div key={i} className="flex items-end gap-2">
          <TextInput
            label="Value"
            value={opt.value}
            onChange={(e) => updateOption(i, { value: e.target.value })}
            className="flex-1"
          />
          <TextInput
            label="Label"
            value={opt.label}
            onChange={(e) => updateOption(i, { label: e.target.value })}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => removeOption(i)}
            aria-label="Remove option"
            className="!border-error !text-error hover:!bg-error-light mb-0.5"
          >
            ✕
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={addOption}>
        + Add option
      </Button>
    </div>
  );
}

interface ConditionalEditorProps {
  field: FieldDefinition;
  allFields: FieldDefinition[];
  index: number;
  onPatch: (patch: Partial<FieldDefinition>) => void;
}

function ConditionalEditor({
  field,
  allFields,
  index,
  onPatch,
}: ConditionalEditorProps) {
  const enabled = Boolean(field.conditionalOn);

  // Candidate trigger fields: any OTHER field that holds a value (i.e. not a
  // section break, and not this field itself).
  const candidates = allFields.filter(
    (f, i) => i !== index && f.type !== "section_break",
  );

  const equalsValue = field.conditionalOn
    ? Array.isArray(field.conditionalOn.equals)
      ? field.conditionalOn.equals.join(", ")
      : field.conditionalOn.equals
    : "";

  const toggle = (on: boolean) => {
    if (!on) {
      onPatch({ conditionalOn: undefined });
      return;
    }
    // Don't create a condition with no trigger — an empty fieldId fails the
    // schema on save and the toggle is disabled in that case anyway.
    const firstId = candidates[0]?.id;
    if (!firstId) return;
    onPatch({ conditionalOn: { fieldId: firstId, equals: "" } });
  };

  return (
    <details className="rounded-[8px] border border-border px-3 py-2" open={enabled}>
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        Conditional logic (optional)
      </summary>
      <div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={enabled}
            disabled={candidates.length === 0}
            onChange={(e) => toggle(e.target.checked)}
            className="w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
          />
          Only show this field when another field has a specific value
        </label>
        {candidates.length === 0 && (
          <p className="text-xs text-muted">
            Add another (non–section-break) field to use as the trigger before
            enabling conditional logic.
          </p>
        )}

        {enabled && field.conditionalOn && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField
              label="When field"
              value={field.conditionalOn.fieldId}
              onChange={(e) =>
                onPatch({
                  conditionalOn: {
                    fieldId: e.target.value,
                    equals: field.conditionalOn?.equals ?? "",
                  },
                })
              }
              options={candidates.map((f) => ({
                value: f.id,
                label: f.label || f.id,
              }))}
              placeholder={candidates.length === 0 ? "No other fields" : undefined}
            />
            <TextInput
              label="Equals"
              value={equalsValue}
              onChange={(e) =>
                onPatch({
                  conditionalOn: {
                    fieldId: field.conditionalOn?.fieldId ?? "",
                    equals: e.target.value,
                  },
                })
              }
              helperText="The trigger field's value that reveals this field."
            />
          </div>
        )}
      </div>
    </details>
  );
}
