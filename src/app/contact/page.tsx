"use client";

import { Controller } from "react-hook-form";
import { FormLayout } from "@/components/forms/FormLayout";
import { FormEngine } from "@/components/forms/FormEngine";
import { RadioGroup } from "@/components/ui/RadioGroup";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { contactFormSchema, type ContactFormData } from "@/lib/schemas";

const USER_TYPE_OPTIONS = [
  { label: "Homeowner", value: "Homeowner" },
  { label: "Real Estate / Title Company", value: "Real Estate / Title Company" },
  { label: "Other", value: "Other" },
];

const DEPARTMENT_OPTIONS = [
  { label: "Customer Service", value: "Customer Service" },
  { label: "Accounting", value: "Accounting" },
  { label: "Maintenance Request", value: "Maintenance Request" },
  { label: "Other", value: "Other" },
];

const CONTACT_METHOD_OPTIONS = [
  { label: "Email", value: "Email" },
  { label: "Phone Call", value: "Phone Call" },
];

export default function ContactPage() {
  return (
    <FormLayout
      title="Contact Us"
      subtitle="Get in touch with PS Property Management. We're here to help."
    >
      <FormEngine<ContactFormData>
        schema={contactFormSchema}
        formSlug="contact"
        defaultValues={{
          userType: undefined,
          firstName: "",
          lastName: "",
          email: "",
          department: undefined,
          message: "",
          contactMethod: undefined,
        }}
        confirmationMessage="Thank you for contacting PS Property Management. We will be in touch shortly."
      >
        {({ errors, register, control }) => (
          <>
            {/* I am... */}
            <Controller
              name="userType"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  name="userType"
                  label="I am..."
                  options={USER_TYPE_OPTIONS}
                  required
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  error={errors.userType}
                />
              )}
            />

            {/* Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            {/* Email */}
            <TextInput
              label="Email"
              type="email"
              required
              autoComplete="email"
              {...register("email")}
              error={errors.email}
            />

            {/* Department */}
            <Controller
              name="department"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  name="department"
                  label="I want to get in touch with..."
                  options={DEPARTMENT_OPTIONS}
                  required
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  error={errors.department}
                />
              )}
            />

            {/* Message */}
            <TextArea
              label="How can we assist you?"
              required
              {...register("message")}
              error={errors.message}
            />

            {/* Contact method */}
            <Controller
              name="contactMethod"
              control={control}
              render={({ field }) => (
                <RadioGroup
                  name="contactMethod"
                  label="How would you like to be contacted?"
                  options={CONTACT_METHOD_OPTIONS}
                  required
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                  onBlur={field.onBlur}
                  error={errors.contactMethod}
                />
              )}
            />
          </>
        )}
      </FormEngine>
    </FormLayout>
  );
}
