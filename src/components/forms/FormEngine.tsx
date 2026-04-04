"use client";

import { useState } from "react";
import {
  FormProvider,
  useForm,
  type DefaultValues,
  type FieldErrors,
  type FieldValues,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { Button } from "@/components/ui/Button";

const SUBMIT_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/submit`
  : "/api/submit";

interface FormEngineProps<T extends FieldValues> {
  schema: z.ZodType<T>;
  formSlug: string;
  defaultValues: DefaultValues<T>;
  confirmationMessage: string;
  children: (props: {
    errors: FieldErrors<T>;
    register: ReturnType<typeof useForm<T>>["register"];
    control: ReturnType<typeof useForm<T>>["control"];
    watch: ReturnType<typeof useForm<T>>["watch"];
    setValue: ReturnType<typeof useForm<T>>["setValue"];
  }) => React.ReactNode;
}

function FormEngine<T extends FieldValues>({
  schema,
  formSlug,
  defaultValues,
  confirmationMessage,
  children,
}: FormEngineProps<T>) {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const methods = useForm<T>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(schema as any) as Resolver<T>,
    defaultValues,
    mode: "onTouched",
  });

  const {
    handleSubmit,
    register,
    control,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = methods;

  async function onSubmit(data: T) {
    setSubmitError(null);
    try {
      const response = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ formSlug, data }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `Submission failed (${response.status})`);
      }

      setSubmitted(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setSubmitError(message);
    }
  }

  if (submitted) {
    return (
      <div
        className="text-center py-12 space-y-4"
        role="status"
        aria-live="polite"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-green/10 mb-2">
          <svg
            className="w-8 h-8 text-brand-green"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <p className="text-lg font-medium text-navy">{confirmationMessage}</p>
      </div>
    );
  }

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="space-y-6"
      >
        {children({
          errors,
          register,
          control,
          watch,
          setValue,
        })}

        {/* reCAPTCHA placeholder */}
        <div
          className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-xs text-muted"
          aria-label="reCAPTCHA verification"
        >
          <svg
            className="w-5 h-5 text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <span>
            Protected by reCAPTCHA.{" "}
            <span className="text-muted/60">(Integration pending)</span>
          </span>
        </div>

        {submitError && (
          <div
            className="rounded-lg border border-error bg-error-light px-4 py-3 text-sm text-error"
            role="alert"
          >
            {submitError}
          </div>
        )}

        <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
          Submit
        </Button>
      </form>
    </FormProvider>
  );
}

export { FormEngine };
export type { FormEngineProps };
