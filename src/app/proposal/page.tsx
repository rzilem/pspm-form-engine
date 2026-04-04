"use client";

import { Controller } from "react-hook-form";
import { FormLayout } from "@/components/forms/FormLayout";
import { FormEngine } from "@/components/forms/FormEngine";
import { ConditionalField } from "@/components/forms/ConditionalField";
import { FileUpload } from "@/components/forms/FileUpload";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { CheckboxGroup } from "@/components/ui/CheckboxGroup";
import { proposalFormSchema, type ProposalFormData } from "@/lib/schemas";

const PSPM_PHONE = process.env.NEXT_PUBLIC_PSPM_PHONE ?? "512-251-6122";

const INTENT_OPTIONS = [
  {
    label: "Send us a request for a Management Proposal",
    value: "Send us a request for a Management Proposal",
  },
  { label: "Call us now", value: "Call us now" },
  {
    label: "Schedule a call with Senior Management Team",
    value: "Schedule a call with Senior Management Team",
  },
];

const PROPOSAL_TYPE_OPTIONS = [
  { label: "HOA", value: "HOA" },
  { label: "Condo Association", value: "Condo Association" },
];

const CURRENT_STATUS_OPTIONS = [
  { label: "Another Management Company", value: "Another Management Company" },
  { label: "Developer", value: "Developer" },
  { label: "Self Managed", value: "Self Managed" },
];

const FEATURE_OPTIONS = [
  { label: "Park", value: "Park" },
  { label: "Pool", value: "Pool" },
  { label: "Amenity Center", value: "Amenity Center" },
  { label: "Security Gate", value: "Security Gate" },
  { label: "Private Roads", value: "Private Roads" },
];

export default function ProposalPage() {
  return (
    <FormLayout
      title="Request a Management Proposal"
      subtitle="Let us know how we can serve your community."
    >
      <FormEngine<ProposalFormData>
        schema={proposalFormSchema}
        formSlug="proposal"
        defaultValues={{
          intent: undefined,
          proposalType: undefined,
          currentStatus: undefined,
          associationName: "",
          numberOfUnits: undefined,
          streetAddress: "",
          city: "",
          state: "",
          zip: "",
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          features: [],
          additionalInfo: "",
        }}
        confirmationMessage="Thank you for your interest in PS Property Management. Our team will review your request and be in touch within 1 business day."
      >
        {({ errors, register, control, setValue }) => (
          <>
            {/* Intent selector */}
            <Controller
              name="intent"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  name="intent"
                  label="I would like to"
                  options={INTENT_OPTIONS}
                  required
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  error={errors.intent}
                />
              )}
            />

            {/* CONDITIONAL: Call us now */}
            <ConditionalField watchField="intent" showWhen="Call us now">
              <div className="rounded-[12px] border-2 border-primary bg-primary-light p-6 text-center space-y-2">
                <h2 className="text-lg font-bold text-navy">Call us now!</h2>
                <a
                  href={`tel:${PSPM_PHONE.replace(/-/g, "")}`}
                  className="text-2xl font-bold text-primary hover:underline"
                >
                  {PSPM_PHONE}
                </a>
                <p className="text-sm text-muted">
                  Our team is available Monday - Friday, 8:00 AM - 5:00 PM CST.
                </p>
              </div>
            </ConditionalField>

            {/* CONDITIONAL: Schedule a call */}
            <ConditionalField
              watchField="intent"
              showWhen="Schedule a call with Senior Management Team"
            >
              <div className="rounded-[12px] border-2 border-primary bg-primary-light p-6 text-center space-y-2">
                <h2 className="text-lg font-bold text-navy">
                  Schedule an Information Call
                </h2>
                <p className="text-sm text-muted">
                  Call us at{" "}
                  <a
                    href={`tel:${PSPM_PHONE.replace(/-/g, "")}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {PSPM_PHONE}
                  </a>{" "}
                  and ask to schedule a call with our Senior Management Team.
                  We&apos;ll find a time that works for your board.
                </p>
              </div>
            </ConditionalField>

            {/* CONDITIONAL: Full proposal form */}
            <ConditionalField
              watchField="intent"
              showWhen="Send us a request for a Management Proposal"
            >
              <div className="space-y-6">
                {/* Proposal Type */}
                <Controller
                  name="proposalType"
                  control={control}
                  render={({ field }) => (
                    <RadioGroup
                      name="proposalType"
                      label="I am requesting a proposal for a"
                      options={PROPOSAL_TYPE_OPTIONS}
                      required
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      onBlur={field.onBlur}
                      error={errors.proposalType}
                    />
                  )}
                />

                {/* Current Status */}
                <Controller
                  name="currentStatus"
                  control={control}
                  render={({ field }) => (
                    <RadioGroup
                      name="currentStatus"
                      label="We are currently..."
                      options={CURRENT_STATUS_OPTIONS}
                      required
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      onBlur={field.onBlur}
                      error={errors.currentStatus}
                    />
                  )}
                />

                {/* Association Details */}
                <TextInput
                  label="Name of Association"
                  required
                  {...register("associationName")}
                  error={errors.associationName}
                />

                <TextInput
                  label="Number of Homes or Units"
                  type="number"
                  required
                  min={1}
                  {...register("numberOfUnits")}
                  error={errors.numberOfUnits}
                />

                {/* Address */}
                <div className="space-y-4">
                  <p className="text-sm font-medium text-foreground">
                    Association Address
                  </p>
                  <TextInput
                    label="Street Address"
                    {...register("streetAddress")}
                    error={errors.streetAddress}
                  />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <TextInput
                      label="City"
                      className="col-span-2"
                      {...register("city")}
                      error={errors.city}
                    />
                    <TextInput
                      label="State"
                      {...register("state")}
                      error={errors.state}
                    />
                    <TextInput
                      label="ZIP"
                      {...register("zip")}
                      error={errors.zip}
                    />
                  </div>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <TextInput
                    label="First Name"
                    required
                    autoComplete="given-name"
                    {...register("firstName")}
                    error={errors.firstName}
                  />
                  <TextInput
                    label="Last Name"
                    required
                    autoComplete="family-name"
                    {...register("lastName")}
                    error={errors.lastName}
                  />
                </div>

                <TextInput
                  label="Email"
                  type="email"
                  required
                  autoComplete="email"
                  {...register("email")}
                  error={errors.email}
                />

                <TextInput
                  label="Phone"
                  type="tel"
                  required
                  autoComplete="tel"
                  {...register("phone")}
                  error={errors.phone}
                />

                {/* Association Features */}
                <Controller
                  name="features"
                  control={control}
                  render={({ field }) => (
                    <CheckboxGroup
                      name="features"
                      label="Association Features"
                      options={FEATURE_OPTIONS}
                      value={field.value ?? []}
                      onChange={(values) => field.onChange(values)}
                      error={errors.features}
                    />
                  )}
                />

                {/* Additional Info */}
                <TextArea
                  label="Additional Information or Requirements"
                  {...register("additionalInfo")}
                  error={errors.additionalInfo}
                />

                {/* File Upload */}
                <FileUpload
                  name="files"
                  label="Upload Documents"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  multiple
                  maxSizeMb={10}
                  onChange={(files) => {
                    // Files will be handled in Phase 3 with Supabase Storage
                    setValue("_files" as keyof ProposalFormData, files as never);
                  }}
                />
              </div>
            </ConditionalField>
          </>
        )}
      </FormEngine>
    </FormLayout>
  );
}
