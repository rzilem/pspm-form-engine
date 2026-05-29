"use client";

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
import type { FieldDefinition, LineItemValue, UploadedFile } from "@/lib/form-definitions";
import { lineItemTotal, formatMoney } from "@/lib/form-definitions";

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

  if (field.type === "radio") {
    return (
      <Controller
        name={field.id}
        control={control}
        defaultValue=""
        render={({ field: controllerField }) => (
          <RadioGroup
            name={field.id}
            label={field.label}
            options={field.options ?? []}
            required={field.required}
            error={error}
            value={controllerField.value ?? ""}
            onChange={controllerField.onChange}
            onBlur={controllerField.onBlur}
          />
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
    return (
      <SelectField
        label={field.label}
        required={field.required}
        error={error}
        helperText={field.helpText}
        options={field.options ?? []}
        placeholder="Select…"
        {...register(field.id)}
      />
    );
  }

  if (field.type === "textarea") {
    return (
      <TextArea
        label={field.label}
        required={field.required}
        error={error}
        helperText={field.helpText}
        placeholder={field.placeholder}
        rows={5}
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

  return (
    <TextInput
      label={field.label}
      type={htmlType}
      required={field.required}
      error={error}
      helperText={field.helpText}
      placeholder={field.placeholder}
      {...register(field.id)}
    />
  );
}
