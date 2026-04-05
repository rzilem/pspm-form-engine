"use client";

import { useState, useCallback, useRef } from "react";
import {
  FormProvider,
  useForm,
  Controller,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormLayout } from "@/components/forms/FormLayout";
import { StepWizard, type StepDefinition } from "@/components/forms/StepWizard";
import { BookingCalendar } from "@/components/booking/BookingCalendar";
import { BookingSummary } from "@/components/booking/BookingSummary";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { FileUpload } from "@/components/forms/FileUpload";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { SignaturePad } from "@/components/forms/SignaturePad";
import { StripePayment } from "@/components/forms/StripePayment";
import { reservationSchema, type ReservationFormData } from "@/lib/schemas";
import { formatTime12h } from "@/lib/booking";

const SUBMIT_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/booking/reserve`
  : "/api/booking/reserve";

interface ReservationConfig {
  title: string;
  subtitle: string;
  amenitySlug: string;
  amenityName: string;
  datePickerLabel: string;
  consentText: string;
  amountCents: number;
  formSlug: string;
  confirmationMessage: string;
}

function ReservationForm({ config }: { config: ReservationConfig }) {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [leaseFiles, setLeaseFiles] = useState<File[]>([]);
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);
  const [manageUrl, setManageUrl] = useState<string | null>(null);
  const holdIdRef = useRef<string | null>(null);
  const sessionIdRef = useRef(crypto.randomUUID());

  // Suppress unused var — files stored for upload
  void leaseFiles;

  const form = useForm<ReservationFormData>({
    resolver: zodResolver<ReservationFormData>(reservationSchema) as Resolver<ReservationFormData>,
    defaultValues: {
      reservationDate: "",
      reservationTime: "",
      startTime: "",
      endTime: "",
      streetAddress: "",
      city: "",
      state: "TX",
      zip: "",
      firstName: "",
      lastName: "",
      propertyStatus: undefined,
      phone: "",
      email: "",
      textUpdates: [],
      attendeeCount: undefined as unknown as number,
      purposeOfFunction: "",
      activitiesPlanned: "",
      alcoholApproval: undefined,
      consentTerms: undefined as unknown as true,
      consentCleaning: undefined as unknown as true,
      signature: "",
      stripePaymentId: "",
    },
    mode: "onTouched",
  });

  const { control, register, watch, setValue, formState: { errors, isSubmitting } } = form;
  const propertyStatus = watch("propertyStatus");
  const reservationDate = watch("reservationDate");
  const startTime = watch("startTime");
  const endTime = watch("endTime");

  const amountFormatted = `$${(config.amountCents / 100).toFixed(2)}`;

  const handlePaymentSuccess = useCallback(
    (paymentIntentId: string) => {
      setValue("stripePaymentId", paymentIntentId);
    },
    [setValue]
  );

  const handleSlotSelected = useCallback(
    (date: string, start: string, end: string) => {
      setValue("reservationDate", date);
      setValue("startTime", start);
      setValue("endTime", end);
      // Set reservationTime as display string for backward compat
      setValue("reservationTime", `${formatTime12h(start)} - ${formatTime12h(end)}`);
    },
    [setValue]
  );

  const handleHoldCreated = useCallback((hId: string, _expiresAt: string) => {
    holdIdRef.current = hId;
  }, []);

  async function onSubmit() {
    setSubmitError(null);

    // Re-validate the entire form before submitting — guards against edge cases
    // where the wizard step validation was skipped or fields changed after step completion
    const isValid = await form.trigger();
    if (!isValid) {
      setSubmitError("Please review your answers — some fields are missing or invalid.");
      return;
    }

    // Confirm Stripe payment first
    const stripeEl = document.getElementById("stripe-confirm-fn") as
      | (HTMLElement & { confirmPayment?: () => Promise<boolean> })
      | null;

    if (stripeEl?.confirmPayment) {
      const success = await stripeEl.confirmPayment();
      if (!success) {
        setSubmitError("Payment was not completed. Please try again.");
        return;
      }
    }

    const data = form.getValues();

    try {
      const response = await fetch(SUBMIT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formSlug: config.formSlug,
          amenitySlug: config.amenitySlug,
          sessionId: sessionIdRef.current,
          holdId: holdIdRef.current,
          data,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        confirmation_code?: string;
        manage_url?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? `Submission failed (${response.status})`);
      }

      setConfirmationCode(body.confirmation_code ?? null);
      setManageUrl(body.manage_url ?? null);
      setSubmitted(true);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setSubmitError(message);
    }
  }

  if (submitted) {
    return (
      <FormLayout title={config.title} subtitle={config.subtitle}>
        <div
          className="text-center py-12 space-y-6"
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
          <p className="text-lg font-medium text-navy">
            {config.confirmationMessage}
          </p>

          {confirmationCode && (
            <div className="space-y-3">
              <div className="bg-primary-light rounded-[8px] px-6 py-4 inline-block">
                <p className="text-xs text-muted uppercase tracking-wide">Confirmation Code</p>
                <p className="text-2xl font-bold text-primary tracking-wider">{confirmationCode}</p>
              </div>

              {reservationDate && startTime && endTime && (
                <BookingSummary
                  amenityName={config.amenityName}
                  date={reservationDate}
                  startTime={startTime}
                  endTime={endTime}
                  amountCents={config.amountCents}
                />
              )}

              {manageUrl && (
                <div className="pt-2">
                  <a
                    href={manageUrl}
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    Manage Your Reservation
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      </FormLayout>
    );
  }

  const steps: StepDefinition<ReservationFormData>[] = [
    {
      label: "Schedule",
      fields: ["reservationDate", "reservationTime"],
      render: () => (
        <BookingCalendar
          amenitySlug={config.amenitySlug}
          label={config.datePickerLabel}
          required
          error={errors.reservationDate ?? errors.reservationTime}
          onSlotSelected={handleSlotSelected}
          onHoldCreated={handleHoldCreated}
        />
      ),
    },
    {
      label: "Your Information",
      fields: [
        "streetAddress",
        "city",
        "state",
        "zip",
        "firstName",
        "lastName",
        "propertyStatus",
        "phone",
        "email",
      ],
      render: () => (
        <div className="space-y-4">
          <p className="text-sm font-medium text-navy">
            Falcon Pointe Address
          </p>
          <TextInput
            label="Street Address"
            required
            {...register("streetAddress")}
            error={errors.streetAddress}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <TextInput
              label="City"
              required
              {...register("city")}
              error={errors.city}
            />
            <TextInput
              label="State"
              required
              {...register("state")}
              error={errors.state}
            />
            <TextInput
              label="ZIP"
              required
              {...register("zip")}
              error={errors.zip}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextInput
              label="First Name"
              required
              {...register("firstName")}
              error={errors.firstName}
            />
            <TextInput
              label="Last Name"
              required
              {...register("lastName")}
              error={errors.lastName}
            />
          </div>

          <Controller
            name="propertyStatus"
            control={control}
            render={({ field }) => (
              <RadioGroup
                name="propertyStatus"
                label="Property Status"
                required
                options={[
                  { label: "I am the property Owner", value: "I am the property Owner" },
                  { label: "I am the tenant on the property", value: "I am the tenant on the property" },
                ]}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.propertyStatus}
              />
            )}
          />

          {propertyStatus === "I am the tenant on the property" && (
            <div className="animate-fade-in">
              <FileUpload
                name="leaseUpload"
                label="Please upload a copy of the active lease"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                multiple={false}
                required
                maxSizeMb={10}
                onChange={(files) => setLeaseFiles(files)}
              />
            </div>
          )}

          <TextInput
            label="Phone"
            type="tel"
            required
            {...register("phone")}
            error={errors.phone}
          />
          <TextInput
            label="Email"
            type="email"
            required
            {...register("email")}
            error={errors.email}
          />

          <Controller
            name="textUpdates"
            control={control}
            render={({ field }) => (
              <CheckboxGroup
                name="textUpdates"
                label="Do you want to receive text updates for this reservation?"
                options={[{ label: "Yes", value: "Yes" }]}
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      ),
    },
    {
      label: "Agreement",
      fields: [
        "attendeeCount",
        "purposeOfFunction",
        "activitiesPlanned",
        "alcoholApproval",
        "consentTerms",
        "consentCleaning",
        "signature",
      ],
      render: () => (
        <div className="space-y-4">
          {/* Booking summary at top of agreement step */}
          {reservationDate && startTime && endTime && (
            <BookingSummary
              amenityName={config.amenityName}
              date={reservationDate}
              startTime={startTime}
              endTime={endTime}
              amountCents={config.amountCents}
            />
          )}

          <p className="text-sm font-medium text-navy">Function Details</p>

          <TextInput
            label="Number of Proposed Attendees (Total)"
            type="number"
            required
            min={1}
            {...register("attendeeCount")}
            error={errors.attendeeCount}
          />

          <TextArea
            label="Purpose of Function"
            required
            {...register("purposeOfFunction")}
            error={errors.purposeOfFunction}
          />

          <TextArea
            label="Activities Planned"
            required
            {...register("activitiesPlanned")}
            error={errors.activitiesPlanned}
          />

          <Controller
            name="alcoholApproval"
            control={control}
            render={({ field }) => (
              <RadioGroup
                name="alcoholApproval"
                label="Are you requesting approval to serve alcohol?"
                required
                options={[
                  { label: "Yes", value: "Yes" },
                  { label: "No", value: "No" },
                ]}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.alcoholApproval}
              />
            )}
          />

          <Controller
            name="consentTerms"
            control={control}
            render={({ field }) => (
              <ConsentCheckbox
                name="consentTerms"
                label={config.consentText}
                required
                checked={field.value === true}
                onChange={(checked) => field.onChange(checked ? true : undefined)}
                error={errors.consentTerms as { message?: string } | undefined}
              />
            )}
          />

          <Controller
            name="consentCleaning"
            control={control}
            render={({ field }) => (
              <ConsentCheckbox
                name="consentCleaning"
                label="I accept responsibility for cleaning the venue after use and agree to pay for any damages to the facility or equipment."
                required
                checked={field.value === true}
                onChange={(checked) => field.onChange(checked ? true : undefined)}
                error={errors.consentCleaning as { message?: string } | undefined}
              />
            )}
          />

          <Controller
            name="signature"
            control={control}
            render={({ field }) => (
              <SignaturePad
                label="Hosting Resident(s) Signature"
                required
                onChange={field.onChange}
                error={errors.signature}
              />
            )}
          />
        </div>
      ),
    },
    {
      label: "Payment",
      fields: [],
      render: () => (
        <div className="space-y-4">
          {/* Summary before payment */}
          {reservationDate && startTime && endTime && (
            <BookingSummary
              amenityName={config.amenityName}
              date={reservationDate}
              startTime={startTime}
              endTime={endTime}
              amountCents={config.amountCents}
            />
          )}

          <StripePayment
            amountCents={config.amountCents}
            label="Reservation Deposit"
            onPaymentSuccess={handlePaymentSuccess}
          />

          {submitError && (
            <div
              className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
              role="alert"
            >
              {submitError}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <FormLayout title={config.title} subtitle={config.subtitle}>
      <FormProvider {...form}>
        <form noValidate onSubmit={(e) => e.preventDefault()}>
          <StepWizard<ReservationFormData>
            steps={steps}
            form={form}
            submitLabel={`Complete Reservation & Pay ${amountFormatted}`}
            onSubmit={onSubmit}
            isSubmitting={isSubmitting}
          />
        </form>
      </FormProvider>
    </FormLayout>
  );
}

export { ReservationForm };
export type { ReservationConfig };
