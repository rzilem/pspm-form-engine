"use client";

import { useState } from "react";
import { Controller } from "react-hook-form";
import { FormLayout } from "@/components/forms/FormLayout";
import { FormEngine } from "@/components/forms/FormEngine";
import { FileUpload } from "@/components/forms/FileUpload";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";
import { ConsentCheckbox } from "@/components/forms/ConsentCheckbox";
import { SignaturePad } from "@/components/forms/SignaturePad";
import {
  falconPointeSchema,
  FALCON_POINTE_REQUEST_TYPES,
  MINOR_PROJECTS,
  MAJOR_PROJECTS,
  type FalconPointeFormData,
} from "@/lib/schemas";

const REQUEST_TYPE_OPTIONS = FALCON_POINTE_REQUEST_TYPES.map((t) => ({
  label: t,
  value: t,
}));

const MINOR_PROJECT_OPTIONS = MINOR_PROJECTS.map((p) => ({
  label: p,
  value: p,
}));

const MAJOR_PROJECT_OPTIONS = MAJOR_PROJECTS.map((p) => ({
  label: p,
  value: p,
}));

export default function FalconPointePortalPage() {
  return (
    <FormLayout
      title="Falcon Pointe Portal Request"
      subtitle="Submit ARC applications, billing questions, or general inquiries."
    >
      <FormEngine<FalconPointeFormData>
        schema={falconPointeSchema}
        formSlug="falcon-pointe-portal"
        defaultValues={{
          firstName: "",
          lastName: "",
          address: "",
          email: "",
          requestType: undefined,
          minorProject: "",
          majorProject: "",
          projectDescription: "",
          arcInfoConsent: false,
          arcComplianceConsent: false,
          signature: "",
          requestInformation: "",
        }}
        confirmationMessage="We have received your inquiry. You will receive a confirmation email shortly."
      >
        {({ errors, register, control, watch, setValue }) => (
          <FalconPointeFields
            errors={errors}
            register={register}
            control={control}
            watch={watch}
            setValue={setValue}
          />
        )}
      </FormEngine>
    </FormLayout>
  );
}

type FormChildrenArgs = Parameters<
  NonNullable<Parameters<typeof FormEngine<FalconPointeFormData>>[0]["children"]>
>[0];

function FalconPointeFields({
  errors,
  register,
  control,
  watch,
  setValue,
}: {
  errors: FormChildrenArgs["errors"];
  register: FormChildrenArgs["register"];
  control: FormChildrenArgs["control"];
  watch: FormChildrenArgs["watch"];
  setValue: FormChildrenArgs["setValue"];
}) {
  const [projectFiles, setProjectFiles] = useState<File[]>([]);
  const [attachFiles, setAttachFiles] = useState<File[]>([]);

  // Suppress unused var warnings — files stored for Phase 3 upload
  void projectFiles;
  void attachFiles;

  const requestType = watch("requestType");
  const isARC = requestType === "ARC Application (Home Project)";
  const isBillingOrGeneral =
    requestType === "Billing Question" ||
    requestType === "General Inquiry / Question";

  return (
    <>
      {/* Name */}
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

      {/* Address */}
      <TextInput
        label="Address"
        required
        {...register("address")}
        error={errors.address}
      />

      {/* Email */}
      <TextInput
        label="Email"
        type="email"
        required
        {...register("email")}
        error={errors.email}
      />

      {/* Type of Request */}
      <Controller
        name="requestType"
        control={control}
        render={({ field }) => (
          <SelectField
            label="Type of Request"
            options={REQUEST_TYPE_OPTIONS}
            placeholder="Select request type..."
            required
            value={field.value ?? ""}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
            error={errors.requestType}
          />
        )}
      />

      {/* ARC Application fields */}
      {isARC && (
        <div className="space-y-4 animate-fade-in">
          <Controller
            name="minorProject"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Minor Projects"
                options={MINOR_PROJECT_OPTIONS}
                placeholder="Select if applicable..."
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
              />
            )}
          />

          <Controller
            name="majorProject"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Major Projects"
                options={MAJOR_PROJECT_OPTIONS}
                placeholder="Select if applicable..."
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
              />
            )}
          />

          <TextArea
            label="Description of the Project"
            required
            {...register("projectDescription")}
            error={errors.projectDescription}
          />

          <Controller
            name="arcInfoConsent"
            control={control}
            render={({ field }) => (
              <ConsentCheckbox
                name="arcInfoConsent"
                label="I understand that I must provide detailed project plans, contractor information, and material specifications with my ARC application."
                required
                checked={field.value === true}
                onChange={field.onChange}
                error={errors.arcInfoConsent as { message?: string } | undefined}
              />
            )}
          />

          <Controller
            name="arcComplianceConsent"
            control={control}
            render={({ field }) => (
              <ConsentCheckbox
                name="arcComplianceConsent"
                label="I acknowledge that all improvements must comply with the community's governing documents and that approval is required before any work begins."
                required
                checked={field.value === true}
                onChange={field.onChange}
                error={
                  errors.arcComplianceConsent as { message?: string } | undefined
                }
              />
            )}
          />
        </div>
      )}

      {/* Project Files — required for all request types */}
      {requestType && (
        <div className="animate-fade-in">
          <FileUpload
            name="projectFiles"
            label="Project Files"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            multiple
            required
            maxSizeMb={10}
            onChange={(files) => {
              setProjectFiles(files);
              setValue("_projectFiles" as keyof FalconPointeFormData, files as never);
            }}
          />
        </div>
      )}

      {/* Billing/General: Request Information */}
      {isBillingOrGeneral && (
        <div className="space-y-4 animate-fade-in">
          <TextArea
            label="Request Information"
            required
            {...register("requestInformation")}
            error={errors.requestInformation}
          />

          <FileUpload
            name="attachFiles"
            label="Attach Files"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
            multiple
            maxSizeMb={10}
            onChange={(files) => {
              setAttachFiles(files);
              setValue("_attachFiles" as keyof FalconPointeFormData, files as never);
            }}
          />
        </div>
      )}

      {/* ARC: Signature */}
      {isARC && (
        <div className="animate-fade-in">
          <Controller
            name="signature"
            control={control}
            render={({ field }) => (
              <SignaturePad
                label="Owner / Applicant Signature"
                required
                onChange={field.onChange}
                error={errors.signature}
              />
            )}
          />
        </div>
      )}
    </>
  );
}

