import { z } from "zod";
import { ALL_FIELDS, SECTIONS, BUILDING_FIELDS } from "./field-map-insurance";

const buildingRowSchema = z.record(z.string(), z.string().optional());

/**
 * HOA New Business Insurance Intake — submission shape.
 *
 * Form values are kept as STRINGS in client state (the user types them)
 * and parsed downstream when the carrier XLSX/PDF is generated. The
 * required-field gate is enforced at the application layer via
 * `validateInsuranceSubmission()` because the field-map drives which
 * fields are required (single source of truth) — duplicating it as
 * static Zod chains would be a footgun.
 */
export const insuranceFormSchema = z
  .object({
    flat: z.record(z.string(), z.string().optional()),
    buildings: z.array(buildingRowSchema).min(0).max(8),
  })
  .superRefine((data, ctx) => {
    // Required-field check driven by field-map.
    for (const field of ALL_FIELDS) {
      if (!field.required) continue;
      const value = data.flat?.[field.key];
      if (value === undefined || value === null || value === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field.label} is required`,
          path: ["flat", field.key],
        });
      }
    }

    // Email/phone format checks.
    for (const field of ALL_FIELDS) {
      const value = data.flat?.[field.key];
      if (!value) continue;
      if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field.label} must be a valid email`,
          path: ["flat", field.key],
        });
      }
      if (field.type === "number" && value.trim() !== "" && !/^-?\d+(\.\d+)?$/.test(value.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${field.label} must be a number`,
          path: ["flat", field.key],
        });
      }
      if (field.type === "money" && value.trim() !== "") {
        // Strip $ and commas; allow plain or decimal.
        const cleaned = value.replace(/[$,\s]/g, "");
        if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field.label} must be a dollar amount`,
            path: ["flat", field.key],
          });
        }
      }
      if (field.type === "percent" && value.trim() !== "") {
        const cleaned = value.replace(/[%\s]/g, "");
        if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${field.label} must be a percentage`,
            path: ["flat", field.key],
          });
        }
      }
    }
  });

export type InsuranceFormData = z.infer<typeof insuranceFormSchema>;

/** Empty seed for new submissions — every flat field starts blank, one empty building row. */
export function emptyInsuranceFormData(): InsuranceFormData {
  const flat: Record<string, string> = {};
  for (const f of ALL_FIELDS) flat[f.key] = "";
  const emptyBuilding: Record<string, string> = {};
  for (const f of BUILDING_FIELDS) emptyBuilding[f.key] = "";
  return { flat, buildings: [emptyBuilding] };
}

/** Re-export sections so the page can drive its UI off the same source. */
export { SECTIONS, ALL_FIELDS, BUILDING_FIELDS };
