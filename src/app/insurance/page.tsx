"use client";

import { useState, useCallback } from "react";
import {
  FormProvider,
  useForm,
  useFieldArray,
  Controller,
  type Resolver,
  type Path,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";
import { RadioGroup } from "@/components/ui/RadioGroup";
import {
  insuranceFormSchema,
  emptyInsuranceFormData,
  SECTIONS,
  BUILDING_FIELDS,
  type InsuranceFormData,
} from "@/lib/schemas-insurance";
import type { FieldDef } from "@/lib/field-map-insurance";

const SUBMIT_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/submit`
  : "/api/submit";

const YESNO_OPTIONS = [
  { label: "Yes", value: "Yes" },
  { label: "No", value: "No" },
];

const YESNO_NA_OPTIONS = [
  { label: "Yes", value: "Yes" },
  { label: "No", value: "No" },
  { label: "N/A", value: "N/A" },
];

/**
 * Renders one field from the canonical field-map onto the form. Switches
 * on FieldDef.type so the page itself stays declarative — adding/renaming
 * a field never requires touching this component.
 */
function FieldRenderer({ field }: { field: FieldDef }) {
  const inputType = (() => {
    switch (field.type) {
      case "email":
        return "email";
      case "date":
        return "date";
      case "number":
      case "money":
      case "percent":
        return "text"; // Keep text so we can accept "$1,200" / "12%" etc.
      case "phone":
        return "tel";
      default:
        return "text";
    }
  })();

  if (field.type === "longtext") {
    return (
      <Controller<InsuranceFormData>
        name={`flat.${field.key}`}
        render={({ field: rhf, fieldState }) => (
          <TextArea
            label={field.label}
            helperText={field.help}
            required={field.required}
            error={fieldState.error}
            value={(rhf.value as string | undefined) ?? ""}
            onChange={rhf.onChange}
            onBlur={rhf.onBlur}
            rows={3}
          />
        )}
      />
    );
  }

  if (field.type === "yesno" || field.type === "yesnoNa") {
    return (
      <Controller<InsuranceFormData>
        name={`flat.${field.key}`}
        render={({ field: rhf, fieldState }) => (
          <div className="flex flex-col gap-1">
            <RadioGroup
              label={field.label}
              required={field.required}
              error={fieldState.error}
              options={field.type === "yesnoNa" ? YESNO_NA_OPTIONS : YESNO_OPTIONS}
              value={(rhf.value as string | undefined) ?? ""}
              onChange={rhf.onChange}
              name={`flat.${field.key}`}
            />
            {field.help && <p className="text-xs text-muted">{field.help}</p>}
          </div>
        )}
      />
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <Controller<InsuranceFormData>
        name={`flat.${field.key}`}
        render={({ field: rhf, fieldState }) => (
          <SelectField
            label={field.label}
            helperText={field.help}
            required={field.required}
            error={fieldState.error}
            placeholder="Select…"
            options={field.options!.map((o) => ({ label: o, value: o }))}
            value={(rhf.value as string | undefined) ?? ""}
            onChange={rhf.onChange}
            onBlur={rhf.onBlur}
          />
        )}
      />
    );
  }

  return (
    <Controller<InsuranceFormData>
      name={`flat.${field.key}`}
      render={({ field: rhf, fieldState }) => (
        <TextInput
          label={field.label}
          helperText={field.help}
          required={field.required}
          error={fieldState.error}
          type={inputType}
          inputMode={
            field.type === "money" || field.type === "number" || field.type === "percent"
              ? "decimal"
              : undefined
          }
          value={(rhf.value as string | undefined) ?? ""}
          onChange={rhf.onChange}
          onBlur={rhf.onBlur}
        />
      )}
    />
  );
}

/**
 * Buildings section uses useFieldArray for repeater behavior. Up to 8
 * rows (mirrors the carrier XLSX template's row range).
 */
function BuildingsRepeater() {
  const { fields, append, remove } = useFieldArray<
    InsuranceFormData,
    "buildings"
  >({
    name: "buildings",
  });

  return (
    <div className="space-y-6">
      {fields.map((row, idx) => (
        <div
          key={row.id}
          className="rounded-[12px] border border-border bg-gray-50 p-4 sm:p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-navy">Building {idx + 1}</h3>
            {fields.length > 1 && (
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-sm text-error hover:underline"
              >
                Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {BUILDING_FIELDS.map((bf) => (
              <Controller<InsuranceFormData>
                key={bf.key}
                name={`buildings.${idx}.${bf.key}`}
                render={({ field: rhf, fieldState }) => (
                  <TextInput
                    label={bf.label}
                    error={fieldState.error}
                    type={bf.type === "number" ? "text" : "text"}
                    inputMode={bf.type === "number" || bf.type === "money" ? "decimal" : undefined}
                    value={(rhf.value as string | undefined) ?? ""}
                    onChange={rhf.onChange}
                    onBlur={rhf.onBlur}
                  />
                )}
              />
            ))}
          </div>
        </div>
      ))}

      {fields.length < 8 && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const empty: Record<string, string> = {};
            for (const f of BUILDING_FIELDS) empty[f.key] = "";
            append(empty);
          }}
        >
          + Add another building
        </Button>
      )}
    </div>
  );
}

export default function InsuranceFormPage() {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);

  const methods = useForm<InsuranceFormData>({
    resolver: zodResolver(insuranceFormSchema as never) as Resolver<InsuranceFormData>,
    defaultValues: emptyInsuranceFormData(),
    mode: "onTouched",
  });

  const { handleSubmit, trigger, formState: { isSubmitting } } = methods;

  const totalSteps = SECTIONS.length + 1; // +1 for review
  const isReview = stepIndex === SECTIONS.length;
  const currentSection = SECTIONS[stepIndex];

  const goNext = useCallback(async () => {
    // Validate the fields for this section before advancing.
    if (!isReview && currentSection && currentSection.fields.length > 0) {
      const fieldNames = currentSection.fields.map(
        (f) => `flat.${f.key}` as Path<InsuranceFormData>,
      );
      const valid = await trigger(fieldNames);
      if (!valid) return;
    }
    setStepIndex((i) => Math.min(i + 1, totalSteps - 1));
  }, [currentSection, isReview, totalSteps, trigger]);

  const goPrev = useCallback(() => {
    setStepIndex((i) => Math.max(i - 1, 0));
  }, []);

  async function onSubmit(data: InsuranceFormData) {
    setSubmitError(null);
    try {
      const response = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formSlug: "insurance", data }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Submission failed (${response.status})`);
      }
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Submission failed");
    }
  }

  if (submitted) {
    return (
      <FormLayout
        title="Insurance Intake Submitted"
        subtitle="The PSPM insurance team has been notified."
      >
        <div className="text-center py-12 space-y-4" role="status" aria-live="polite">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-green-light mb-2">
            <svg className="w-8 h-8 text-brand-green" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-lg font-medium text-navy">
            Thanks — your insurance intake is in.
          </p>
          <p className="text-sm text-muted max-w-md mx-auto">
            A staff member will review the submission and convert it into a carrier-ready
            quote packet. You&rsquo;ll hear back within 1 business day.
          </p>
        </div>
      </FormLayout>
    );
  }

  return (
    <FormLayout
      title="HOA Insurance Intake"
      subtitle="Captures the data the carrier needs for a new HOA / Condo policy. ~10 minutes."
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
          {/* Stepper */}
          <ol className="flex flex-wrap gap-2 mb-2 text-xs">
            {SECTIONS.map((s, i) => (
              <li
                key={s.id}
                className={`px-2.5 py-1 rounded-full border ${
                  i === stepIndex
                    ? "bg-primary text-white border-primary"
                    : i < stepIndex
                      ? "bg-brand-blue-light text-primary border-primary/30"
                      : "bg-white text-muted border-border"
                }`}
                aria-current={i === stepIndex ? "step" : undefined}
              >
                {i + 1}. {s.title}
              </li>
            ))}
            <li
              className={`px-2.5 py-1 rounded-full border ${
                isReview ? "bg-primary text-white border-primary" : "bg-white text-muted border-border"
              }`}
            >
              {SECTIONS.length + 1}. Review
            </li>
          </ol>

          {/* Section header + fields */}
          {!isReview && currentSection && (
            <section>
              <header className="border-b border-border pb-3 mb-5">
                <h2 className="text-lg font-semibold text-navy">{currentSection.title}</h2>
                <p className="text-sm text-muted mt-0.5">{currentSection.description}</p>
              </header>

              {currentSection.id === "buildings" ? (
                <BuildingsRepeater />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {currentSection.fields.map((f) => (
                    <div
                      key={f.key}
                      className={f.half ? "" : "sm:col-span-2"}
                    >
                      <FieldRenderer field={f} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Review step */}
          {isReview && (
            <section className="space-y-6">
              <header className="border-b border-border pb-3">
                <h2 className="text-lg font-semibold text-navy">Review &amp; Submit</h2>
                <p className="text-sm text-muted mt-0.5">
                  Confirm everything looks right. Submit when ready — staff will be notified
                  immediately.
                </p>
              </header>
              {submitError && (
                <div
                  className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
                  role="alert"
                >
                  {submitError}
                </div>
              )}
              <p className="text-sm text-muted">
                Required fields are validated as you go. If anything was missed, the relevant step
                will reopen with errors highlighted.
              </p>
            </section>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <Button
              type="button"
              variant="secondary"
              onClick={goPrev}
              disabled={stepIndex === 0}
            >
              Previous
            </Button>
            {!isReview ? (
              <Button type="button" onClick={goNext}>
                Next
              </Button>
            ) : (
              <Button type="submit" loading={isSubmitting}>
                Submit Insurance Intake
              </Button>
            )}
          </div>
        </form>
      </FormProvider>
    </FormLayout>
  );
}
