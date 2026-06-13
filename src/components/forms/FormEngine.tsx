"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
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
import {
  RECAPTCHA_SITE_KEY,
  loadRecaptchaScript,
  getRecaptchaToken,
} from "@/lib/recaptcha-client";

const SUBMIT_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/submit`
  : "/api/submit";

const TEXT_LIKE_INPUT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "number",
  "password",
  "search",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
]);

// Optional reCAPTCHA v3. When NEXT_PUBLIC_RECAPTCHA_SITE_KEY is set (and the
// matching RECAPTCHA_SECRET_KEY is set server-side) the form fetches a token
// on submit and the server enforces it. When unset, the form submits without
// a token and the server fails open — the honeypot below is the always-on
// spam guard. This makes reCAPTCHA a progressive enhancement, not a fake badge.
// Shared script-load + token-fetch live in lib/recaptcha-client.

/** When set, non-final wizard pages block real submit (Enter + implicit submit). */
export type FormWizardSubmitGuard = {
  isLastPage: boolean;
  onAdvance: () => void | Promise<void>;
};

interface FormEngineProps<T extends FieldValues> {
  schema: z.ZodType<T>;
  formSlug: string;
  defaultValues: DefaultValues<T>;
  confirmationMessage: string;
  // Per-form reCAPTCHA opt-out. When false, the form skips loading/executing
  // reCAPTCHA even if NEXT_PUBLIC_RECAPTCHA_SITE_KEY is configured (e.g. private
  // forms that explicitly set recaptcha_required=false). Defaults to true.
  recaptcha?: boolean;
  // Builder live-preview mode. When true the form renders exactly as it will
  // for end users but never submits (the button is disabled and onSubmit is a
  // no-op) and never loads reCAPTCHA — so editing a form in the admin builder
  // can't post a real submission.
  preview?: boolean;
  // When true, omit the default full-width Submit button (e.g. multi-page
  // dynamic forms render their own nav + submit on the last step).
  hideDefaultSubmit?: boolean;
  /** Multi-page wizard: intercept submit/Enter until the last visible page. */
  wizardSubmitGuard?: FormWizardSubmitGuard | null;
  /** Optional actions beside Submit (e.g. Save & Continue). */
  secondaryActions?: (ctx: {
    honeypotRef: RefObject<HTMLInputElement | null>;
  }) => React.ReactNode;
  /** Save & Continue token — sent on final submit to delete the partial row. */
  resumeToken?: string;
  children: (props: {
    errors: FieldErrors<T>;
    register: ReturnType<typeof useForm<T>>["register"];
    control: ReturnType<typeof useForm<T>>["control"];
    watch: ReturnType<typeof useForm<T>>["watch"];
    setValue: ReturnType<typeof useForm<T>>["setValue"];
    /** Mutate `.current` during render — never lifts guard into parent state. */
    wizardGuardRef: RefObject<FormWizardSubmitGuard | null>;
    honeypotRef: RefObject<HTMLInputElement | null>;
  }) => React.ReactNode;
}

function FormEngine<T extends FieldValues>({
  schema,
  formSlug,
  defaultValues,
  confirmationMessage,
  recaptcha = true,
  preview = false,
  hideDefaultSubmit = false,
  wizardSubmitGuard: wizardSubmitGuardProp = null,
  secondaryActions,
  resumeToken,
  children,
}: FormEngineProps<T>) {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const wizardGuardRef = useRef<FormWizardSubmitGuard | null>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  function readWizardGuard(): FormWizardSubmitGuard | null {
    return wizardSubmitGuardProp ?? wizardGuardRef.current;
  }

  // reCAPTCHA is active only when a site key is configured AND this form hasn't
  // opted out (recaptcha=false). Drives the script load, token fetch, and the
  // Google disclosure so an opted-out form does none of them.
  const recaptchaActive = Boolean(RECAPTCHA_SITE_KEY) && recaptcha && !preview;

  // Lazy-load the reCAPTCHA v3 script only when reCAPTCHA is active.
  useEffect(() => {
    if (recaptchaActive) loadRecaptchaScript();
  }, [recaptchaActive]);

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
    // Builder preview never posts a real submission.
    if (preview) return;
    setSubmitError(null);
    try {
      // Fetch a reCAPTCHA v3 token when active. On any failure, submit without
      // one — the server fails open when no secret is set and the honeypot
      // still guards, so a script hiccup never blocks a real user.
      const recaptchaToken = recaptchaActive
        ? await getRecaptchaToken("submit")
        : undefined;

      const hp = honeypotRef.current?.value ?? "";

      const response = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formSlug,
          data,
          recaptchaToken,
          hp,
          ...(resumeToken ? { resumeToken } : {}),
        }),
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

  const wizardSubmitGuardPropRef = useRef(wizardSubmitGuardProp);
  wizardSubmitGuardPropRef.current = wizardSubmitGuardProp;

  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;

  const readWizardGuardRef = useRef(readWizardGuard);
  readWizardGuardRef.current = readWizardGuard;

  const handleFormSubmit = useCallback((e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const guard = readWizardGuardRef.current();
    if (guard && !guard.isLastPage) {
      void guard.onAdvance();
      return;
    }
    void handleSubmitRef.current((data: T) => onSubmitRef.current(data))(e);
  }, []);

  const handleFormKeyDown = useCallback((e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter") return;
    const guard = readWizardGuardRef.current();
    if (!guard || guard.isLastPage) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.tagName === "BUTTON") return;
    if (target.tagName === "TEXTAREA" || target.isContentEditable) return;
    if (target instanceof HTMLInputElement) {
      const type = target.type || "text";
      if (!TEXT_LIKE_INPUT_TYPES.has(type)) return;
      e.preventDefault();
      void guard.onAdvance();
    }
  }, []);

  if (submitted) {
    return (
      <div
        className="text-center py-12 space-y-4"
        role="status"
        aria-live="polite"
      >
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-brand-green-light mb-2">
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
        onSubmit={handleFormSubmit}
        onKeyDown={handleFormKeyDown}
        noValidate
        className="space-y-6"
      >
        {children({
          errors,
          register,
          control,
          watch,
          setValue,
          wizardGuardRef,
          honeypotRef,
        })}

        {/* Honeypot — hidden from humans, auto-filled by bots. The server
            rejects any submission where this is non-empty. Do not remove. */}
        <div
          aria-hidden="true"
          className="absolute -left-[9999px] top-0 h-0 w-0 overflow-hidden"
        >
          <label htmlFor="company_website">Company website (leave blank)</label>
          <input
            ref={honeypotRef}
            type="text"
            id="company_website"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
            defaultValue=""
          />
        </div>

        {/* reCAPTCHA disclosure — only shown when reCAPTCHA is actually active. */}
        {recaptchaActive && (
          <p className="text-xs text-muted">
            This site is protected by reCAPTCHA and the Google{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Privacy Policy
            </a>{" "}
            and{" "}
            <a
              href="https://policies.google.com/terms"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Terms of Service
            </a>{" "}
            apply.
          </p>
        )}

        {submitError && (
          <div
            className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
            role="alert"
          >
            {submitError}
          </div>
        )}

        {!hideDefaultSubmit && (
          <div className="flex flex-col sm:flex-row gap-3">
            {secondaryActions?.({ honeypotRef })}
            <Button
              type="submit"
              size="lg"
              loading={isSubmitting}
              disabled={preview}
              className="w-full sm:flex-1"
            >
              Submit
            </Button>
          </div>
        )}
      </form>
    </FormProvider>
  );
}

export { FormEngine };
export type { FormEngineProps };
