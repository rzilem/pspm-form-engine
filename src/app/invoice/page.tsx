"use client";

import { useState, useMemo } from "react";
import { Controller } from "react-hook-form";
import { FormLayout } from "@/components/forms/FormLayout";
import { FormEngine } from "@/components/forms/FormEngine";
import { ConditionalField } from "@/components/forms/ConditionalField";
import { FileUpload } from "@/components/forms/FileUpload";
import { SelectField } from "@/components/ui/SelectField";
import { TextInput } from "@/components/ui/TextInput";
import { ProductLineItem } from "@/components/forms/ProductLineItem";
import { TotalDisplay } from "@/components/forms/TotalDisplay";
import {
  invoiceFormSchema,
  COMMUNITY_NAMES,
  INVOICE_TYPES,
  type InvoiceFormData,
} from "@/lib/schemas";

const COMMUNITY_OPTIONS = [
  ...COMMUNITY_NAMES.map((name) => ({ label: name, value: name })),
  {
    label: "--- More communities will be loaded dynamically ---",
    value: "__placeholder__",
  },
];

const INVOICE_TYPE_OPTIONS = INVOICE_TYPES.map((t) => ({
  label: t,
  value: t,
}));

const UTILITY_FIELDS = [
  { key: "electric" as const, label: "Electric" },
  { key: "gas" as const, label: "Gas" },
  { key: "internet" as const, label: "Internet" },
  { key: "phone" as const, label: "Phone" },
  { key: "trash" as const, label: "Trash" },
  { key: "water" as const, label: "Water" },
];

export default function InvoicePage() {
  return (
    <FormLayout
      title="Invoicing System"
      subtitle="Submit utility invoices and community purchases."
    >
      <FormEngine<InvoiceFormData>
        schema={invoiceFormSchema}
        formSlug="invoice"
        defaultValues={{
          communityName: "",
          invoiceType: undefined,
          accountNumber: "",
          customInvoiceDescription: "",
          electric: 0,
          gas: 0,
          internet: 0,
          phone: 0,
          trash: 0,
          water: 0,
          communityPurchase: 0,
          amount: 0,
        }}
        confirmationMessage="Thank you. Your invoice has been submitted successfully. A PDF will be generated and sent to the invoicing team."
      >
        {({ errors, register, control, watch, setValue }) => (
          <InvoiceFormFields
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

/** Inner component that uses watch for reactivity */
function InvoiceFormFields({
  errors,
  register,
  control,
  watch,
  setValue,
}: {
  errors: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<InvoiceFormData>>[0]["children"]
    >
  >[0]["errors"];
  register: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<InvoiceFormData>>[0]["children"]
    >
  >[0]["register"];
  control: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<InvoiceFormData>>[0]["children"]
    >
  >[0]["control"];
  watch: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<InvoiceFormData>>[0]["children"]
    >
  >[0]["watch"];
  setValue: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<InvoiceFormData>>[0]["children"]
    >
  >[0]["setValue"];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const invoiceType = watch("invoiceType");
  const communityName = watch("communityName");

  // Watch all amount fields for running total
  const electric = watch("electric") ?? 0;
  const gas = watch("gas") ?? 0;
  const internet = watch("internet") ?? 0;
  const phone = watch("phone") ?? 0;
  const trash = watch("trash") ?? 0;
  const water = watch("water") ?? 0;
  const communityPurchase = watch("communityPurchase") ?? 0;
  const amount = watch("amount") ?? 0;

  const total = useMemo(() => {
    if (invoiceType === "Utility Reimbursement") {
      return (
        (electric || 0) +
        (gas || 0) +
        (internet || 0) +
        (phone || 0) +
        (trash || 0) +
        (water || 0)
      );
    }
    if (invoiceType === "Community Purchase") {
      return communityPurchase || 0;
    }
    if (invoiceType === "Invoice" || invoiceType === "Insurance") {
      return amount || 0;
    }
    return 0;
  }, [invoiceType, electric, gas, internet, phone, trash, water, communityPurchase, amount]);

  // Suppress unused var warnings — files are stored for Phase 3
  void files;

  return (
    <>
      {/* Community Name */}
      <Controller
        name="communityName"
        control={control}
        render={({ field }) => (
          <SelectField
            label="Community Name"
            options={COMMUNITY_OPTIONS}
            placeholder="Select a community..."
            required
            value={field.value}
            onChange={(e) => field.onChange(e.target.value)}
            onBlur={field.onBlur}
            error={errors.communityName}
          />
        )}
      />

      {/* Invoice Type — only show when community is selected */}
      {communityName && communityName !== "__placeholder__" && (
        <div className="animate-fade-in">
          <Controller
            name="invoiceType"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Type of Invoice"
                options={INVOICE_TYPE_OPTIONS}
                placeholder="Select invoice type..."
                required
                value={field.value ?? ""}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
                error={errors.invoiceType}
              />
            )}
          />
        </div>
      )}

      {/* Account # — show for Utility Reimbursement or Insurance */}
      <ConditionalField
        watchField="invoiceType"
        showWhen={["Utility Reimbursement", "Insurance"]}
      >
        <TextInput
          label="Account #"
          required
          {...register("accountNumber")}
          error={errors.accountNumber}
        />
      </ConditionalField>

      {/* Custom Invoice Description — show for Invoice or Insurance */}
      <ConditionalField
        watchField="invoiceType"
        showWhen={["Invoice", "Insurance"]}
      >
        <TextInput
          label="Create a Custom Invoice"
          {...register("customInvoiceDescription")}
          error={errors.customInvoiceDescription}
        />
      </ConditionalField>

      {/* Utility Reimbursement line items */}
      <ConditionalField watchField="invoiceType" showWhen="Utility Reimbursement">
        <div className="space-y-3">
          <p className="text-sm font-medium text-navy">
            Enter amounts for each utility
          </p>
          {UTILITY_FIELDS.map((field) => (
            <Controller
              key={field.key}
              name={field.key}
              control={control}
              render={({ field: controllerField }) => (
                <ProductLineItem
                  label={field.label}
                  value={controllerField.value ?? 0}
                  onChange={(val) => controllerField.onChange(val)}
                  error={
                    errors[field.key as keyof typeof errors] as
                      | { message?: string }
                      | undefined
                  }
                />
              )}
            />
          ))}
        </div>
      </ConditionalField>

      {/* Community Purchase line item */}
      <ConditionalField watchField="invoiceType" showWhen="Community Purchase">
        <div className="space-y-3">
          <p className="text-sm font-medium text-navy">
            Enter purchase amount
          </p>
          <Controller
            name="communityPurchase"
            control={control}
            render={({ field }) => (
              <ProductLineItem
                label="Community Purchase"
                value={field.value ?? 0}
                onChange={(val) => field.onChange(val)}
                error={errors.communityPurchase}
              />
            )}
          />
        </div>
      </ConditionalField>

      {/* Invoice / Insurance amount */}
      <ConditionalField watchField="invoiceType" showWhen={["Invoice", "Insurance"]}>
        <div className="space-y-3">
          <p className="text-sm font-medium text-navy">Enter amount</p>
          <Controller
            name="amount"
            control={control}
            render={({ field }) => (
              <ProductLineItem
                label="Amount"
                value={field.value ?? 0}
                onChange={(val) => field.onChange(val)}
                error={errors.amount}
              />
            )}
          />
        </div>
      </ConditionalField>

      {/* Running Total */}
      {invoiceType && <TotalDisplay total={total} label="Running Total" />}

      {/* File Upload */}
      <FileUpload
        name="files"
        label="Upload Statement or Receipt"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
        multiple
        required
        maxSizeMb={10}
        onChange={(uploadedFiles) => {
          setFiles(uploadedFiles);
          setValue("_files" as keyof InvoiceFormData, uploadedFiles as never);
        }}
      />

      {/* PDF note */}
      <p className="text-xs text-muted italic">
        PDF will be generated after submission.
      </p>
    </>
  );
}
