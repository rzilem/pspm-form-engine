"use client";

import { useState, useMemo, useCallback } from "react";
import { Controller } from "react-hook-form";
import { FormLayout } from "@/components/forms/FormLayout";
import { FormEngine } from "@/components/forms/FormEngine";
import { FileUpload } from "@/components/forms/FileUpload";
import { SelectField } from "@/components/ui/SelectField";
import { TextArea } from "@/components/ui/TextArea";
import { BillbackLineItem } from "@/components/forms/BillbackLineItem";
import { TotalDisplay } from "@/components/forms/TotalDisplay";
import {
  billbackFormSchema,
  COMMUNITY_NAMES,
  BILLBACK_LINE_ITEMS,
  type BillbackFormData,
} from "@/lib/schemas";

const COMMUNITY_OPTIONS = [
  ...COMMUNITY_NAMES.map((name) => ({ label: name, value: name })),
  {
    label: "--- More communities will be loaded dynamically ---",
    value: "__placeholder__",
  },
];

function buildDefaultLineItems(): Record<
  string,
  { quantity: number; customPrice?: number }
> {
  const items: Record<string, { quantity: number; customPrice?: number }> = {};
  for (const item of BILLBACK_LINE_ITEMS) {
    items[item.key] = {
      quantity: 0,
      customPrice: item.userDefinedPrice ? 0 : undefined,
    };
  }
  return items;
}

export default function BillbackPage() {
  return (
    <FormLayout
      title="Manager Billback Tool"
      subtitle="Submit billback invoices for manager services and meeting overages."
    >
      <FormEngine<BillbackFormData>
        schema={billbackFormSchema}
        formSlug="billback"
        defaultValues={{
          communityName: "",
          notes: "",
          lineItems: buildDefaultLineItems(),
        }}
        confirmationMessage="Thank you. Your billback has been submitted successfully. A PDF will be generated and sent to the billing team."
      >
        {({ errors, control, register, watch, setValue }) => (
          <BillbackFormFields
            errors={errors}
            control={control}
            register={register}
            watch={watch}
            setValue={setValue}
          />
        )}
      </FormEngine>
    </FormLayout>
  );
}

function BillbackFormFields({
  errors,
  control,
  register,
  watch,
  setValue,
}: {
  errors: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<BillbackFormData>>[0]["children"]
    >
  >[0]["errors"];
  control: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<BillbackFormData>>[0]["children"]
    >
  >[0]["control"];
  register: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<BillbackFormData>>[0]["children"]
    >
  >[0]["register"];
  watch: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<BillbackFormData>>[0]["children"]
    >
  >[0]["watch"];
  setValue: Parameters<
    NonNullable<
      Parameters<typeof FormEngine<BillbackFormData>>[0]["children"]
    >
  >[0]["setValue"];
}) {
  const [files, setFiles] = useState<File[]>([]);
  const lineItems = watch("lineItems");

  // Suppress unused var warning — files stored for Phase 3
  void files;

  const total = useMemo(() => {
    if (!lineItems) return 0;
    let sum = 0;
    for (const config of BILLBACK_LINE_ITEMS) {
      const item = lineItems[config.key];
      if (!item) continue;
      const qty = item.quantity || 0;
      const price = config.userDefinedPrice
        ? item.customPrice ?? 0
        : config.fixedPrice;
      sum += price * qty;
    }
    return Math.round(sum * 100) / 100;
  }, [lineItems]);

  const handleQuantityChange = useCallback(
    (key: string, qty: number) => {
      const current = lineItems?.[key] ?? { quantity: 0 };
      setValue(`lineItems.${key}`, { ...current, quantity: qty });
    },
    [lineItems, setValue]
  );

  const handleCustomPriceChange = useCallback(
    (key: string, price: number) => {
      const current = lineItems?.[key] ?? { quantity: 0 };
      setValue(`lineItems.${key}`, { ...current, customPrice: price });
    },
    [lineItems, setValue]
  );

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

      {/* Notes */}
      <TextArea
        label="Notes"
        required
        {...register("notes")}
        error={errors.notes}
      />

      {/* Line Items */}
      <div className="space-y-1">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 pb-2 border-b-2 border-navy/20">
          <span className="text-xs font-semibold text-navy uppercase tracking-wider">
            Service
          </span>
          <span className="text-xs font-semibold text-navy uppercase tracking-wider w-24 text-right">
            Price
          </span>
          <span className="text-xs font-semibold text-navy uppercase tracking-wider w-16 text-center">
            Qty
          </span>
          <span className="text-xs font-semibold text-navy uppercase tracking-wider w-24 text-right">
            Total
          </span>
        </div>

        {BILLBACK_LINE_ITEMS.map((config) => {
          const item = lineItems?.[config.key];
          return (
            <BillbackLineItem
              key={config.key}
              label={config.label}
              fixedPrice={config.fixedPrice}
              userDefinedPrice={config.userDefinedPrice}
              quantity={item?.quantity ?? 0}
              customPrice={item?.customPrice ?? 0}
              onQuantityChange={(qty) =>
                handleQuantityChange(config.key, qty)
              }
              onCustomPriceChange={
                config.userDefinedPrice
                  ? (price) => handleCustomPriceChange(config.key, price)
                  : undefined
              }
            />
          );
        })}
      </div>

      {/* Running Total */}
      <TotalDisplay total={total} label="Running Total" />

      {/* File Upload (optional) */}
      <FileUpload
        name="files"
        label="Upload Statement or Receipt"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
        multiple
        maxSizeMb={10}
        onChange={(uploadedFiles) => {
          setFiles(uploadedFiles);
          setValue("_files" as keyof BillbackFormData, uploadedFiles as never);
        }}
      />

      {/* PDF note */}
      <p className="text-xs text-muted italic">
        PDF will be generated after submission.
      </p>
    </>
  );
}
