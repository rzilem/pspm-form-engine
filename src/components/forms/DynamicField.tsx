"use client";

import { Controller, useFormContext } from "react-hook-form";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { SelectField } from "@/components/ui/SelectField";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { DynamicFileUpload } from "@/components/forms/DynamicFileUpload";
import { SignaturePad } from "@/components/forms/SignaturePad";
import type { FieldDefinition, UploadedFile } from "@/lib/form-definitions";

interface DynamicFieldProps {
  field: FieldDefinition;
  // Required by file_upload to bind /api/upload to a published form. Other
  // field types ignore it; making it a separate prop (not threading through
  // a context) keeps DynamicField a pure component for unit tests.
  formSlug: string;
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
export function DynamicField({ field, formSlug }: DynamicFieldProps) {
  const { register, formState, control, watch } = useFormContext();

  // Conditional visibility. Watching directly so the UI re-evaluates on
  // every change without us writing a useEffect.
  if (field.conditionalOn) {
    const triggerValue = watch(field.conditionalOn.fieldId);
    const matches = Array.isArray(field.conditionalOn.equals)
      ? field.conditionalOn.equals.includes(String(triggerValue ?? ""))
      : String(triggerValue ?? "") === field.conditionalOn.equals;
    if (!matches) return null;
  }

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
        <TextInput label="Street" {...register(`${field.id}.street`)} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TextInput label="City" {...register(`${field.id}.city`)} />
          <TextInput label="State" {...register(`${field.id}.state`)} />
          <TextInput label="ZIP" {...register(`${field.id}.zip`)} />
        </div>
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
