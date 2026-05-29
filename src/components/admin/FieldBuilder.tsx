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
  time: "Time",
  name: "Name (first + last)",
  address: "Address",
  consent: "Consent checkbox",
  file_upload: "File upload",
  signature: "Signature",
  section_break: "Section heading",
  html: "HTML block",
  line_items: "Line items (priced)",
  total: "Total (auto-calculated)",
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

// Field types usable as a conditional trigger. The runtime resolver compares
// trigger values with String(value), so only scalar fields work — arrays
// (checkbox_group, file_upload) and objects (name, address) would stringify to
// "a,b" / "[object Object]", and a signature data-URL / consent boolean make no
// sense as an "equals" comparison.
const TRIGGER_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "date",
  "time",
  "radio",
  "select",
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
      const prev = value[index];
      const next = value.map((f, i) => (i === index ? { ...f, ...patch } : f));
      // Leaving line_items: drop its mode/preset/quantity config so a stale,
      // possibly-incomplete preset row can't block saving the new field type.
      if (
        patch.type !== undefined &&
        patch.type !== "line_items" &&
        prev?.type === "line_items"
      ) {
        next[index] = {
          ...next[index],
          lineItemMode: undefined,
          presetItems: undefined,
          allowQuantity: undefined,
        };
      }
      const updated = next[index];
      // Only scalar fields can be triggers (the resolver compares String(value)).
      // If this edit ACTUALLY changes the type from a trigger-capable one to a
      // non-scalar one, drop conditional logic in fields that pointed at it.
      // Gate on a real type change so a harmless label/help edit (or a JSON-
      // authored condition on a non-scalar trigger) isn't silently wiped.
      const becameNonTrigger =
        patch.type !== undefined &&
        patch.type !== prev?.type &&
        !TRIGGER_FIELD_TYPES.has(patch.type) &&
        TRIGGER_FIELD_TYPES.has(prev?.type as FieldType);
      if (updated && becameNonTrigger) {
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
  const isHtml = field.type === "html";
  const isTotal = field.type === "total";
  const isLineItems = field.type === "line_items";
  // Display-only blocks (heading, HTML, auto-calculated total) carry no input
  // value, so they hide the Required toggle and validation.
  const isDisplayOnly = isSectionBreak || isHtml || isTotal;
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
          label={isSectionBreak ? "Heading text" : isHtml ? "Block label (admin only, not shown)" : "Label"}
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

      {isHtml && (
        <div>
          <label className="text-sm font-medium text-foreground block mb-1">
            HTML content
          </label>
          <textarea
            className="w-full font-mono text-xs rounded-[8px] border border-border bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
            rows={6}
            value={field.html ?? ""}
            onChange={(e) => onPatch({ html: e.target.value || undefined })}
            spellCheck={false}
            placeholder="<p>Rich text shown to form viewers. Sanitized on render — scripts are stripped.</p>"
          />
          <p className="text-xs text-muted mt-1">
            Basic HTML only (headings, paragraphs, lists, links, bold). Scripts
            and event handlers are removed automatically.
          </p>
        </div>
      )}

      {isLineItems && (
        <div className="space-y-3 rounded-[8px] border border-border px-3 py-3">
          <SelectField
            label="Line item mode"
            value={field.lineItemMode ?? "free"}
            onChange={(e) =>
              onPatch(
                e.target.value === "preset"
                  ? { lineItemMode: "preset" }
                  : // Returning to free entry: clear presetItems so a stale /
                    // incomplete preset row can't fail schema validation on a
                    // field the admin no longer wants to be preset.
                    { lineItemMode: undefined, presetItems: undefined },
              )
            }
            options={[
              { value: "free", label: "Free entry — submitter types description + amount" },
              { value: "preset", label: "Preset items — you set prices, submitter picks quantities" },
            ]}
          />
          {(field.lineItemMode ?? "free") === "preset" ? (
            <PresetItemsEditor
              items={field.presetItems ?? []}
              onChange={(presetItems) =>
                onPatch({ presetItems: presetItems.length ? presetItems : undefined })
              }
            />
          ) : (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={field.allowQuantity ?? false}
                onChange={(e) => onPatch({ allowQuantity: e.target.checked || undefined })}
                className="w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40"
              />
              Show a quantity column (line total = amount × quantity)
            </label>
          )}
        </div>
      )}

      {isTotal && (
        <p className="text-xs text-muted">
          Auto-calculated from every line-items field on this form. Read-only for
          the submitter; the server recomputes it on submit.
        </p>
      )}

      {!isDisplayOnly && (
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

      {!isHtml && (
        <TextInput
          label={isSectionBreak ? "Sub-heading / help text" : "Help text"}
          value={field.helpText ?? ""}
          onChange={(e) => onPatch({ helpText: e.target.value || undefined })}
          helperText="Optional. Shown under the field."
        />
      )}

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

type PresetItem = NonNullable<FieldDefinition["presetItems"]>[number];

function PresetItemsEditor({
  items,
  onChange,
}: {
  items: PresetItem[];
  onChange: (next: PresetItem[]) => void;
}) {
  const update = (i: number, patch: Partial<PresetItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { label: "", price: 0 }]);
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">Preset items</p>
      {items.length === 0 && (
        <p className="text-xs text-muted">No items yet. Add at least one priced item.</p>
      )}
      {items.map((it, i) => (
        <div key={i} className="flex items-end gap-2">
          <TextInput
            label="Label"
            value={it.label}
            onChange={(e) => update(i, { label: e.target.value })}
            className="flex-1"
          />
          <TextInput
            label="Price ($)"
            type="number"
            value={it.price}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              update(i, { price: Number.isFinite(n) && n >= 0 ? n : 0 });
            }}
            className="w-28"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => remove(i)}
            aria-label="Remove item"
            className="!border-error !text-error hover:!bg-error-light mb-0.5"
          >
            ✕
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        + Add item
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

  // Candidate trigger fields: any OTHER scalar field (the resolver compares
  // with String(value), so arrays/objects/uploads/signatures can't be triggers).
  const candidates = allFields.filter(
    (f, i) => i !== index && TRIGGER_FIELD_TYPES.has(f.type),
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
