"use client";

import { useState, useCallback } from "react";
import {
  FormProvider,
  useForm,
  Controller,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { FormLayout } from "@/components/forms/FormLayout";
import { StepWizard, type StepDefinition } from "@/components/forms/StepWizard";
import { DateTimePicker } from "@/components/forms/DateTimePicker";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { FileUpload } from "@/components/forms/FileUpload";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { SignaturePad } from "@/components/forms/SignaturePad";
import { StripePayment } from "@/components/forms/StripePayment";
import { reservationSchema, type ReservationFormData } from "@/lib/schemas";

const SUBMIT_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/submit`
  : "/api/submit";

interface ReservationConfig {
  title: string;
  subtitle: string;
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

  // Suppress unused var — files stored for upload
  void leaseFiles;

  const form = useForm<ReservationFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(reservationSchema as any) as Resolver<ReservationFormData>,
    defaultValues: {
      reservationDate: "",
      reservationTime: "",
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

  const amountFormatted = `$${(config.amountCents / 100).toFixed(2)}`;

  const handlePaymentSuccess = useCallback(
    (paymentIntentId: string) => {
      setValue("stripePaymentId", paymentIntentId);
    },
    [setValue]
  );

  async function onSubmit() {
    setSubmitError(null);

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
        body: JSON.stringify({ formSlug: config.formSlug, data }),
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
      <FormLayout title={config.title} subtitle={config.subtitle}>
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
          <p className="text-lg font-medium text-navy">
            {config.confirmationMessage}
          </p>
        </div>
      </FormLayout>
    );
  }

  const steps: StepDefinition<ReservationFormData>[] = [
    {
      label: "Schedule",
      fields: ["reservationDate", "reservationTime"],
      render: () => (
        <Controller
          name="reservationDate"
          control={control}
          render={({ field: dateField }) => (
            <Controller
              name="reservationTime"
              control={control}
              render={({ field: timeField }) => (
                <DateTimePicker
                  label={config.datePickerLabel}
                  required
                  dateValue={dateField.value}
                  timeValue={timeField.value}
                  onDateChange={dateField.onChange}
                  onTimeChange={timeField.onChange}
                  error={errors.reservationDate ?? errors.reservationTime}
                />
              )}
            />
          )}
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
      label: "Function Details",
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
          <p className="text-sm text-muted">
            Event Room Reservation &mdash; {amountFormatted}
          </p>

          <StripePayment
            amountCents={config.amountCents}
            label={`Reservation Total`}
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
