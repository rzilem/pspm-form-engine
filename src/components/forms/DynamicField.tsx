"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { SelectField } from "@/components/ui/SelectField";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { DynamicFileUpload } from "@/components/forms/DynamicFileUpload";
import DOMPurify from "isomorphic-dompurify";
import { SignaturePad } from "@/components/forms/SignaturePad";
import type {
  FieldDefinition,
  FieldOption,
  LineItemValue,
  ListRowValue,
  UploadedFile,
} from "@/lib/form-definitions";
import {
  lineItemTotal,
  formatMoney,
  resolveListColumns,
} from "@/lib/form-definitions";

const SCALAR_READONLY_TYPES = new Set<FieldDefinition["type"]>([
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "radio",
  "select",
  "date",
  "time",
]);

function isScalarReadOnly(field: FieldDefinition): boolean {
  return Boolean(field.readOnly && SCALAR_READONLY_TYPES.has(field.type));
}

interface DynamicFieldProps {
  field: FieldDefinition;
  // Required by file_upload to bind /api/upload to a published form. Other
  // field types ignore it; making it a separate prop (not threading through
  // a context) keeps DynamicField a pure component for unit tests.
  formSlug: string;
  // Builder live-preview: passed to file_upload so the dropzone never posts a
  // real staged upload while editing.
  preview?: boolean;
  // Live grand total computed by the parent (DynamicForm) — only the `total`
  // field type reads it.
  computedTotal?: number;
}

/**
 * Renders one form_definition field. Reads value/error/onChange from the
 * surrounding react-hook-form FormProvider (set up by FormEngine.tsx).
 *
 * Conditional fields: if `field.conditionalOn` is set, the field is hidden
 * unless the watched trigger field equals the configured value(s). Server-
 * side validation (in form-definitions.ts buildSubmissionSchema) is the
 * source of truth — this UI gate is purely cosmetic.
 */
export function DynamicField({
  field,
  formSlug,
  preview = false,
  computedTotal = 0,
}: DynamicFieldProps) {
  const { register, formState, control } = useFormContext();

  // Conditional visibility is decided by the parent (DynamicForm) via the
  // shared transitive resolver, so this component only renders fields that
  // should be shown and never needs to gate itself.

  const errMsg = formState.errors[field.id]?.message as string | undefined;
  const error = errMsg ? { message: errMsg } : undefined;

  if (field.type === "section_break") {
    return (
      <div className="border-t border-border pt-4 mt-2">
        <h2 className="text-base font-semibold text-navy">{field.label}</h2>
        {field.helpText && (
          <p className="text-sm text-muted mt-1">{field.helpText}</p>
        )}
      </div>
    );
  }

  if (field.type === "html") {
    // Display-only rich-content block. Admin-authored, but rendered to public
    // users INSIDE the submission <form> — so sanitize on every render with a
    // strict display-only allow-list (no form controls/script/iframe/style, so
    // a pasted <button>/<input> can't hijack or submit the form).
    const clean = DOMPurify.sanitize(field.html ?? "", {
      ALLOWED_TAGS: [
        "h1", "h2", "h3", "h4", "h5", "h6",
        "p", "br", "hr", "span", "div",
        "ul", "ol", "li",
        "a", "strong", "em", "b", "i", "u", "s",
        "blockquote", "code", "pre", "img",
        "table", "thead", "tbody", "tr", "th", "td",
      ],
      ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "title"],
      // Belt-and-suspenders: never allow interactive/scripting markup even if
      // a future ALLOWED_TAGS edit adds it.
      FORBID_TAGS: ["form", "input", "button", "textarea", "select", "option", "script", "style", "iframe"],
    });
    if (!clean.trim()) return null;
    return (
      <div
        className="text-sm text-foreground [&_a]:text-primary [&_a]:underline [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-navy [&_h2]:font-semibold [&_h2]:text-navy [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    );
  }

  if (field.type === "total") {
    // Read-only, auto-calculated. The parent recomputes computedTotal on every
    // change with the same helper the server uses to store the value.
    return (
      <div className="flex items-center justify-between border-t-2 border-border pt-3 mt-1">
        <span className="text-base font-semibold text-navy">
          {field.label || "Total"}
        </span>
        <span className="text-xl font-bold text-navy tabular-nums">
          {formatMoney(computedTotal)}
        </span>
      </div>
    );
  }

  if (field.type === "line_items" && field.lineItemMode === "preset") {
    const presets = field.presetItems ?? [];
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue={[]}
        render={({ field: controllerField }) => {
          const rows: Array<Record<string, unknown>> = Array.isArray(
            controllerField.value,
          )
            ? (controllerField.value as Array<Record<string, unknown>>)
            : [];
          const qtyFor = (idx: number) => {
            const row = rows.find((r) => Number(r.presetIndex) === idx);
            return row ? String(row.quantity ?? "") : "";
          };
          const setQty = (idx: number, raw: string) => {
            const others = rows.filter((r) => Number(r.presetIndex) !== idx);
            const n = parseInt(raw, 10);
            if (!raw || !Number.isFinite(n) || n <= 0) {
              controllerField.onChange(others);
              return;
            }
            const p = presets[idx];
            controllerField.onChange([
              ...others,
              {
                presetIndex: idx,
                description: p?.label ?? "",
                amount: p?.price ?? 0,
                quantity: n,
              },
            ]);
          };
          // Preset prices come from the field config; quantity always applies.
          const subtotal = rows.reduce((s, r) => s + lineItemTotal(r, true), 0);
          return (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">
                {field.label}
                {field.required && (
                  <span className="text-error ml-0.5" aria-hidden="true">*</span>
                )}
              </legend>
              {field.helpText && <p className="text-xs text-muted">{field.helpText}</p>}
              {presets.length === 0 && (
                <p className="text-xs text-muted">No items configured.</p>
              )}
              <div className="flex flex-col gap-2">
                {presets.map((p, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-3 rounded-[8px] border border-border bg-white px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{p.label}</p>
                      <p className="text-xs text-muted">
                        {formatMoney(Number(p.price) || 0)} each
                      </p>
                    </div>
                    <label className="text-xs text-muted">Qty</label>
                    <input
                      aria-label={`${p.label} quantity`}
                      type="number"
                      min={0}
                      step={1}
                      value={qtyFor(idx)}
                      placeholder="0"
                      onChange={(e) => setQty(idx, e.target.value)}
                      className="w-16 shrink-0 rounded-[8px] border border-border bg-white px-2 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-end pt-1">
                <span className="text-sm text-muted">
                  Subtotal:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatMoney(subtotal)}
                  </span>
                </span>
              </div>
              {error && (
                <p className="text-xs text-error" role="alert">
                  {error.message}
                </p>
              )}
            </fieldset>
          );
        }}
      />
    );
  }

  if (field.type === "line_items") {
    const showQty = Boolean(field.allowQuantity);
    // Rows are stored leniently while editing (amount/quantity as raw strings);
    // the submission schema coerces them to numbers and the server recomputes
    // the authoritative total, so typing decimals is never reformatted mid-keystroke.
    type EditRow = {
      description?: string;
      amount?: string | number;
      quantity?: string | number;
    };
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue={[]}
        render={({ field: controllerField }) => {
          const rows: EditRow[] = Array.isArray(controllerField.value)
            ? (controllerField.value as EditRow[])
            : [];
          const setRows = (next: EditRow[]) => controllerField.onChange(next);
          const update = (i: number, patch: Partial<EditRow>) =>
            setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
          const addRow = () =>
            setRows([
              ...rows,
              { description: "", amount: "", ...(showQty ? { quantity: 1 } : {}) },
            ]);
          const removeRow = (i: number) =>
            setRows(rows.filter((_, idx) => idx !== i));
          const subtotal = rows.reduce(
            (s, r) => s + lineItemTotal(r as LineItemValue, showQty),
            0,
          );
          return (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">
                {field.label}
                {field.required && (
                  <span className="text-error ml-0.5" aria-hidden="true">*</span>
                )}
              </legend>
              {field.helpText && <p className="text-xs text-muted">{field.helpText}</p>}
              {rows.length === 0 && (
                <p className="text-xs text-muted">No line items yet.</p>
              )}
              <div className="flex flex-col gap-2">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <input
                      aria-label={`Line ${i + 1} description`}
                      type="text"
                      value={row.description ?? ""}
                      placeholder="Description"
                      onChange={(e) => update(i, { description: e.target.value })}
                      className="flex-1 min-w-0 rounded-[8px] border border-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                    />
                    {showQty && (
                      <input
                        aria-label={`Line ${i + 1} quantity`}
                        type="number"
                        min={0}
                        step={1}
                        value={row.quantity ?? ""}
                        placeholder="Qty"
                        onChange={(e) => update(i, { quantity: e.target.value })}
                        className="w-16 shrink-0 rounded-[8px] border border-border bg-white px-2 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                      />
                    )}
                    <div className="relative w-28 shrink-0">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">$</span>
                      <input
                        aria-label={`Line ${i + 1} amount`}
                        type="text"
                        inputMode="decimal"
                        value={row.amount ?? ""}
                        placeholder="0.00"
                        onChange={(e) =>
                          update(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })
                        }
                        className="w-full rounded-[8px] border border-border bg-white pl-7 pr-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove line ${i + 1}`}
                      onClick={() => removeRow(i)}
                      className="shrink-0 rounded-[8px] border border-error text-error px-2.5 py-2 text-sm hover:bg-error-light"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={addRow}
                  className="text-sm font-medium text-primary hover:text-primary-hover"
                >
                  + Add line
                </button>
                <span className="text-sm text-muted">
                  Subtotal:{" "}
                  <span className="font-semibold text-foreground tabular-nums">
                    {formatMoney(subtotal)}
                  </span>
                </span>
              </div>
              {error && (
                <p className="text-xs text-error" role="alert">
                  {error.message}
                </p>
              )}
            </fieldset>
          );
        }}
      />
    );
  }

  if (field.type === "list") {
    const columns = resolveListColumns(field);
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue={[]}
        render={({ field: controllerField }) => {
          const rows: ListRowValue[] = Array.isArray(controllerField.value)
            ? (controllerField.value as ListRowValue[])
            : [];
          const setRows = (next: ListRowValue[]) => controllerField.onChange(next);
          const emptyRow = (): ListRowValue => {
            const row: ListRowValue = {};
            for (const c of columns) row[c.id] = "";
            return row;
          };
          const baseRows = (): ListRowValue[] =>
            rows.length > 0 ? rows : field.required ? [emptyRow()] : [];
          const update = (i: number, colId: string, val: string) => {
            const base = baseRows();
            setRows(
              base.map((r, idx) => (idx === i ? { ...r, [colId]: val } : r)),
            );
          };
          const addRow = () => setRows([...baseRows(), emptyRow()]);
          const removeRow = (i: number) => {
            const next = baseRows().filter((_, idx) => idx !== i);
            if (next.length === 0 && field.required) {
              setRows([emptyRow()]);
            } else {
              setRows(next);
            }
          };
          const displayRows = baseRows();
          return (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">
                {field.label}
                {field.required && (
                  <span className="text-error ml-0.5" aria-hidden="true">*</span>
                )}
              </legend>
              {field.helpText && (
                <p className="text-xs text-muted">{field.helpText}</p>
              )}
              <div className="overflow-x-auto -mx-1 px-1">
                <table className="w-full min-w-[280px] border-collapse text-sm">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th
                          key={c.id}
                          className="border border-border bg-muted/40 px-2 py-1.5 text-left text-xs font-medium text-foreground"
                        >
                          {c.label}
                        </th>
                      ))}
                      <th className="w-10 border border-border bg-muted/40" aria-label="Remove row" />
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={columns.length + 1}
                          className="border border-border px-2 py-2 text-xs text-muted"
                        >
                          No rows yet.
                        </td>
                      </tr>
                    )}
                    {displayRows.map((row, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c.id} className="border border-border p-1">
                            <input
                              aria-label={`Row ${i + 1}, ${c.label}`}
                              type="text"
                              value={row[c.id] ?? ""}
                              onChange={(e) => update(i, c.id, e.target.value)}
                              className="w-full min-w-[80px] rounded-[8px] border border-border bg-white px-2 py-2 text-base focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
                            />
                          </td>
                        ))}
                        <td className="border border-border p-1 text-center">
                          <button
                            type="button"
                            aria-label={`Remove row ${i + 1}`}
                            onClick={() => removeRow(i)}
                            className="rounded-[8px] border border-error text-error px-2 py-1 text-sm hover:bg-error-light"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={addRow}
                  className="text-sm font-medium text-primary hover:text-primary-hover"
                >
                  + Add row
                </button>
              </div>
              {error && (
                <p className="text-xs text-error" role="alert">
                  {error.message}
                </p>
              )}
            </fieldset>
          );
        }}
      />
    );
  }

  if (field.type === "consent") {
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue={false}
        render={({ field: controllerField }) => (
          <ConsentCheckbox
            name={field.id}
            label={field.label}
            detailText={field.helpText}
            required={field.required}
            error={error}
            checked={Boolean(controllerField.value)}
            onChange={(c) => controllerField.onChange(c)}
          />
        )}
      />
    );
  }

  if (field.type === "image_choice") {
    const readOnly = isScalarReadOnly(field);
    const locked = readOnly || preview;
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue={field.multiple ? [] : ""}
        render={({ field: controllerField }) => (
          <ImageChoiceField
            field={field}
            options={field.options ?? []}
            multiple={Boolean(field.multiple)}
            required={field.required}
            error={error}
            disabled={locked}
            value={controllerField.value}
            onChange={controllerField.onChange}
            onBlur={controllerField.onBlur}
          />
        )}
      />
    );
  }

  if (field.type === "radio") {
    const readOnly = isScalarReadOnly(field);
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue=""
        render={({ field: controllerField }) => (
          <div
            className={readOnly ? "pointer-events-none opacity-80" : undefined}
            aria-readonly={readOnly || undefined}
          >
            <RadioGroup
              name={field.id}
              label={field.label}
              options={field.options ?? []}
              required={field.required}
              error={error}
              value={controllerField.value ?? ""}
              onChange={readOnly ? undefined : controllerField.onChange}
              onBlur={controllerField.onBlur}
            />
          </div>
        )}
      />
    );
  }

  if (field.type === "checkbox_group") {
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue={[]}
        render={({ field: controllerField }) => (
          <CheckboxGroup
            name={field.id}
            label={field.label}
            options={field.options ?? []}
            required={field.required}
            error={error}
            value={Array.isArray(controllerField.value) ? controllerField.value : []}
            onChange={controllerField.onChange}
          />
        )}
      />
    );
  }

  if (field.type === "select") {
    const readOnly = isScalarReadOnly(field);
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue=""
        render={({ field: controllerField }) => (
          <div
            className={readOnly ? "pointer-events-none opacity-80" : undefined}
            aria-readonly={readOnly || undefined}
          >
            <SelectField
              label={field.label}
              required={field.required}
              error={error}
              helperText={field.helpText}
              options={field.options ?? []}
              placeholder="Select…"
              name={controllerField.name}
              value={controllerField.value ?? ""}
              onChange={readOnly ? undefined : controllerField.onChange}
              onBlur={controllerField.onBlur}
              ref={controllerField.ref}
            />
          </div>
        )}
      />
    );
  }

  if (field.type === "textarea") {
    const readOnly = isScalarReadOnly(field);
    return (
      <TextArea
        label={field.label}
        required={field.required}
        error={error}
        helperText={field.helpText}
        placeholder={field.placeholder}
        rows={5}
        readOnly={readOnly}
        {...register(field.id)}
      />
    );
  }

  if (field.type === "name") {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">
          {field.label}
          {field.required && (
            <span className="text-error ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextInput
            label="First"
            required={field.required}
            {...register(`${field.id}.first`)}
          />
          <TextInput
            label="Last"
            required={field.required}
            {...register(`${field.id}.last`)}
          />
        </div>
        {error && (
          <p className="text-xs text-error" role="alert">
            {error.message}
          </p>
        )}
      </fieldset>
    );
  }

  if (field.type === "file_upload") {
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue={[]}
        render={({ field: controllerField }) => (
          <DynamicFileUpload
            name={field.id}
            label={field.label}
            formSlug={formSlug}
            required={field.required}
            multiple
            helpText={field.helpText}
            error={error}
            preview={preview}
            value={
              Array.isArray(controllerField.value)
                ? (controllerField.value as UploadedFile[])
                : []
            }
            onChange={(files) => controllerField.onChange(files)}
          />
        )}
      />
    );
  }

  if (field.type === "signature") {
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue=""
        render={({ field: controllerField }) => (
          <SignaturePad
            label={field.label}
            required={field.required}
            error={error}
            value={
              typeof controllerField.value === "string"
                ? controllerField.value
                : ""
            }
            onChange={(dataUrl) => controllerField.onChange(dataUrl)}
          />
        )}
      />
    );
  }

  if (field.type === "address") {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-foreground">
          {field.label}
          {field.required && (
            <span className="text-error ml-0.5" aria-hidden="true">
              *
            </span>
          )}
        </legend>
        <TextInput
          label="Street"
          required={field.required}
          {...register(`${field.id}.street`)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextInput
            label="City"
            required={field.required}
            {...register(`${field.id}.city`)}
          />
          <TextInput
            label="State"
            required={field.required}
            {...register(`${field.id}.state`)}
          />
          <TextInput
            label="ZIP"
            required={field.required}
            {...register(`${field.id}.zip`)}
          />
        </div>
        {error && (
          <p className="text-xs text-error" role="alert">
            {error.message}
          </p>
        )}
      </fieldset>
    );
  }

  // Default: text-ish input (text, email, phone, number, date)
  const htmlType =
    field.type === "email"
      ? "email"
      : field.type === "phone"
        ? "tel"
        : field.type === "number"
          ? "number"
          : field.type === "date"
            ? "date"
            : field.type === "time"
              ? "time"
              : "text";

  const readOnly = isScalarReadOnly(field);
  const mask =
    (field.type === "text" || field.type === "phone") && field.mask
      ? field.mask
      : undefined;

  return (
    <TextInput
      label={field.label}
      type={htmlType}
      required={field.required}
      error={error}
      helperText={field.helpText}
      placeholder={field.placeholder}
      mask={mask}
      readOnly={readOnly}
      {...register(field.id)}
    />
  );
}

interface ImageChoiceFieldProps {
  field: FieldDefinition;
  options: FieldOption[];
  multiple: boolean;
  required?: boolean;
  error?: { message?: string };
  disabled?: boolean;
  value: unknown;
  onChange: (v: string | string[]) => void;
  onBlur?: () => void;
}

function ImageChoiceField({
  field,
  options,
  multiple,
  required,
  error,
  disabled,
  value,
  onChange,
  onBlur,
}: ImageChoiceFieldProps) {
  const groupRef = useRef<HTMLDivElement>(null);
  const errorId = `image-choice-${field.id}-error`;

  const selectedSet = new Set(
    multiple
      ? Array.isArray(value)
        ? value.map(String)
        : []
      : value !== undefined && value !== null && value !== ""
        ? [String(value)]
        : [],
  );

  const toggle = useCallback(
    (optValue: string) => {
      if (disabled) return;
      if (multiple) {
        const current = Array.isArray(value) ? value.map(String) : [];
        if (current.includes(optValue)) {
          onChange(current.filter((v) => v !== optValue));
        } else {
          onChange([...current, optValue]);
        }
      } else {
        onChange(optValue);
      }
      onBlur?.();
    },
    [disabled, multiple, onChange, onBlur, value],
  );

  const focusOption = useCallback((index: number) => {
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>(
      "[data-image-choice-option]",
    );
    buttons?.[index]?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number, optValue: string) => {
      if (disabled) return;
      const count = options.length;
      if (!multiple && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        toggle(optValue);
        return;
      }
      if (!multiple && (e.key === "ArrowRight" || e.key === "ArrowDown")) {
        e.preventDefault();
        focusOption((index + 1) % count);
        return;
      }
      if (!multiple && (e.key === "ArrowLeft" || e.key === "ArrowUp")) {
        e.preventDefault();
        focusOption((index - 1 + count) % count);
        return;
      }
      if (multiple && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        toggle(optValue);
      }
    },
    [disabled, focusOption, multiple, options.length, toggle],
  );

  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="text-sm font-medium text-foreground">
        {field.label}
        {required && (
          <span className="text-error ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </legend>
      {field.helpText && (
        <p className="text-xs text-muted">{field.helpText}</p>
      )}
      <div
        ref={groupRef}
        role={multiple ? "group" : "radiogroup"}
        aria-label={field.label}
        aria-readonly={disabled || undefined}
        className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${
          disabled ? "opacity-80 pointer-events-none" : ""
        }`}
      >
        {options.map((opt, index) => {
          const selected = selectedSet.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              data-image-choice-option
              role={multiple ? "checkbox" : "radio"}
              aria-checked={selected}
              disabled={disabled}
              onClick={() => toggle(opt.value)}
              onKeyDown={(e) => handleKeyDown(e, index, opt.value)}
              className={`flex flex-col rounded-[8px] border-2 overflow-hidden text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40
                ${
                  selected
                    ? "border-primary ring-2 ring-primary/30"
                    : "border-border hover:border-primary/50"
                }`}
            >
              {opt.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={opt.image}
                  alt=""
                  className="w-full aspect-[4/3] object-cover bg-gray-100"
                />
              ) : (
                <div className="w-full aspect-[4/3] bg-primary-light flex items-center justify-center px-2">
                  <span className="text-sm font-medium text-primary text-center line-clamp-3">
                    {opt.label}
                  </span>
                </div>
              )}
              <span className="px-2 py-2 text-sm text-foreground text-center">
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error.message}
        </p>
      )}
    </fieldset>
  );
}
