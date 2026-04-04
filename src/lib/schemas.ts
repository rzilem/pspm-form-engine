import { z } from "zod";

// ── Community names (shared across invoice & billback) ──────────────
export const COMMUNITY_NAMES = [
  "2000 Lightsey Condominiums",
  "3114 SOCO Condominium Association, Inc.",
  "5708 Sutherlin Condominiums Inc.",
  "901 Bouldin Owners Association Inc",
  "9525 At The Loop Condominium Owners Association, INC",
] as const;

export type CommunityName = (typeof COMMUNITY_NAMES)[number];

// ── Management Proposal Form ─────────────────────────────────────────
export const proposalFormSchema = z
  .object({
    intent: z.enum(
      [
        "Send us a request for a Management Proposal",
        "Call us now",
        "Schedule a call with Senior Management Team",
      ],
      { message: "Please select an option" }
    ),
    proposalType: z
      .enum(["HOA", "Condo Association"])
      .optional(),
    currentStatus: z
      .enum(["Another Management Company", "Developer", "Self Managed"])
      .optional(),
    associationName: z.string().max(200).optional(),
    numberOfUnits: z.coerce.number().int().positive().optional(),
    streetAddress: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(50).optional(),
    zip: z.string().max(10).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    email: z.union([z.string().email(), z.literal("")]).optional(),
    phone: z.string().max(20).optional(),
    features: z
      .array(
        z.enum([
          "Park",
          "Pool",
          "Amenity Center",
          "Security Gate",
          "Private Roads",
        ])
      )
      .optional(),
    additionalInfo: z.string().max(5000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.intent !== "Send us a request for a Management Proposal") return;

    const requiredFields: Array<{
      field: keyof typeof data;
      message: string;
    }> = [
      { field: "proposalType", message: "Please select a proposal type" },
      { field: "currentStatus", message: "Please select your current status" },
      { field: "associationName", message: "Association name is required" },
      { field: "numberOfUnits", message: "Number of units is required" },
      { field: "firstName", message: "First name is required" },
      { field: "lastName", message: "Last name is required" },
      { field: "email", message: "Email is required" },
      { field: "phone", message: "Phone number is required" },
    ];

    for (const { field, message } of requiredFields) {
      const value = data[field];
      if (value === undefined || value === "" || value === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message,
          path: [field],
        });
      }
    }

    if (data.email && data.email !== "" && !data.email.includes("@")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please enter a valid email address",
        path: ["email"],
      });
    }
  });

export type ProposalFormData = z.infer<typeof proposalFormSchema>;

// ── Invoicing System Form ────────────────────────────────────────────
export const INVOICE_TYPES = [
  "Utility Reimbursement",
  "Community Purchase",
  "Invoice",
  "Insurance",
] as const;

export type InvoiceType = (typeof INVOICE_TYPES)[number];

const dollarAmount = z.coerce
  .number()
  .min(0, "Amount must be 0 or greater")
  .multipleOf(0.01, "Amount must have at most 2 decimal places");

export const invoiceFormSchema = z
  .object({
    communityName: z.string().min(1, "Please select a community"),
    invoiceType: z.enum(
      ["Utility Reimbursement", "Community Purchase", "Invoice", "Insurance"],
      { message: "Please select an invoice type" }
    ),
    accountNumber: z.string().max(100).optional(),
    customInvoiceDescription: z.string().max(500).optional(),
    // Utility Reimbursement line items
    electric: dollarAmount.optional(),
    gas: dollarAmount.optional(),
    internet: dollarAmount.optional(),
    phone: dollarAmount.optional(),
    trash: dollarAmount.optional(),
    water: dollarAmount.optional(),
    // Community Purchase line item
    communityPurchase: dollarAmount.optional(),
    // Invoice / Insurance line item
    amount: dollarAmount.optional(),
  })
  .superRefine((data, ctx) => {
    // Account number required for Utility Reimbursement and Insurance
    if (
      (data.invoiceType === "Utility Reimbursement" ||
        data.invoiceType === "Insurance") &&
      (!data.accountNumber || data.accountNumber.trim() === "")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Account number is required",
        path: ["accountNumber"],
      });
    }
  });

export type InvoiceFormData = z.infer<typeof invoiceFormSchema>;

// ── Manager Billback Tool Form ───────────────────────────────────────
export interface BillbackLineItemConfig {
  key: string;
  label: string;
  fixedPrice: number;
  userDefinedPrice: boolean;
}

export const BILLBACK_LINE_ITEMS: BillbackLineItemConfig[] = [
  { key: "meetingOverages", label: "Meeting Time Overages (Over 2 Hours)", fixedPrice: 75, userDefinedPrice: false },
  { key: "additionalMeetingHours", label: "Additional Meeting Hours", fixedPrice: 125, userDefinedPrice: false },
  { key: "weekendMeetingHours", label: "Weekend Meeting Hours (Fri-Sun)", fixedPrice: 200, userDefinedPrice: false },
  { key: "meetingMinutes", label: "Meeting Minutes", fixedPrice: 125, userDefinedPrice: false },
  { key: "emergencyRepairs", label: "Emergency Repairs/On-Site Hours", fixedPrice: 115, userDefinedPrice: false },
  { key: "projectManagement", label: "Project Management Hours", fixedPrice: 130, userDefinedPrice: false },
  { key: "additionalOfficeHours", label: "Additional Office Hours (Research)", fixedPrice: 55, userDefinedPrice: false },
  { key: "courtLegal", label: "Court/Legal Proceeding Hours", fixedPrice: 200, userDefinedPrice: false },
  { key: "additionalServices", label: "Additional Services", fixedPrice: 0, userDefinedPrice: true },
];

export const billbackFormSchema = z.object({
  communityName: z.string().min(1, "Please select a community"),
  notes: z.string().min(1, "Notes are required").max(5000),
  // Line item quantities (keyed by item key)
  lineItems: z.record(
    z.string(),
    z.object({
      quantity: z.coerce.number().int().min(0).default(0),
      customPrice: dollarAmount.optional(),
    })
  ),
});

export type BillbackFormData = z.infer<typeof billbackFormSchema>;

// ── Falcon Pointe Portal Request ────────────────────────────────────
export const FALCON_POINTE_REQUEST_TYPES = [
  "Billing Question",
  "General Inquiry / Question",
  "ARC Application (Home Project)",
] as const;

export const MINOR_PROJECTS = [
  "Painting/Siding",
  "Doors (house/garage)",
  "Landscape (<$250)",
  "Screenings/Awnings",
  "Perimeter Fencing",
  "Outdoor Lighting",
] as const;

export const MAJOR_PROJECTS = [
  "Deck/Patio",
  "Roofing",
  "Solar Panels",
  "Landscape (>$250)",
  "Outdoor Kitchens",
  "Pools/Spas",
] as const;

export const falconPointeSchema = z
  .object({
    firstName: z.string().min(1, "First name is required").max(100),
    lastName: z.string().min(1, "Last name is required").max(100),
    address: z.string().min(1, "Address is required").max(500),
    email: z.string().email("Please enter a valid email address"),
    requestType: z.enum(
      ["Billing Question", "General Inquiry / Question", "ARC Application (Home Project)"],
      { message: "Please select a type of request" }
    ),
    // ARC fields
    minorProject: z.string().optional(),
    majorProject: z.string().optional(),
    projectDescription: z.string().max(5000).optional(),
    arcInfoConsent: z.boolean().optional(),
    arcComplianceConsent: z.boolean().optional(),
    signature: z.string().optional(),
    // Billing/General fields
    requestInformation: z.string().max(5000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.requestType === "ARC Application (Home Project)") {
      if (!data.projectDescription || data.projectDescription.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Project description is required",
          path: ["projectDescription"],
        });
      }
      if (!data.arcInfoConsent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "You must acknowledge the required information",
          path: ["arcInfoConsent"],
        });
      }
      if (!data.arcComplianceConsent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "You must acknowledge the compliance disclaimer",
          path: ["arcComplianceConsent"],
        });
      }
      if (!data.signature || data.signature.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Signature is required",
          path: ["signature"],
        });
      }
    }

    if (
      (data.requestType === "Billing Question" ||
        data.requestType === "General Inquiry / Question") &&
      (!data.requestInformation || data.requestInformation.trim() === "")
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Request information is required",
        path: ["requestInformation"],
      });
    }
  });

export type FalconPointeFormData = z.infer<typeof falconPointeSchema>;

// ── Reservation Form (shared: Indoor + Pavilion) ────────────────────
export const PROPERTY_STATUS_OPTIONS = [
  "I am the property Owner",
  "I am the tenant on the property",
] as const;

export const reservationSchema = z
  .object({
    // Step 1: Schedule
    reservationDate: z.string().min(1, "Please select a date"),
    reservationTime: z.string().min(1, "Please select a time"),
    // Step 2: Your Information
    streetAddress: z.string().min(1, "Street address is required").max(200),
    city: z.string().min(1, "City is required").max(100),
    state: z.string().min(1, "State is required").max(50),
    zip: z.string().min(1, "ZIP code is required").max(10),
    firstName: z.string().min(1, "First name is required").max(100),
    lastName: z.string().min(1, "Last name is required").max(100),
    propertyStatus: z.enum(
      ["I am the property Owner", "I am the tenant on the property"],
      { message: "Please select your property status" }
    ),
    phone: z.string().min(1, "Phone number is required").max(20),
    email: z.string().email("Please enter a valid email address"),
    textUpdates: z.array(z.string()).optional(),
    // Step 3: Function Details + Agreement
    attendeeCount: z.coerce.number().int().positive("Number of attendees is required"),
    purposeOfFunction: z.string().min(1, "Purpose of function is required").max(5000),
    activitiesPlanned: z.string().min(1, "Activities planned is required").max(5000),
    alcoholApproval: z.enum(["Yes", "No"], {
      message: "Please indicate if alcohol will be served",
    }),
    consentTerms: z.literal(true, {
      error: "You must agree to the terms and conditions",
    }),
    consentCleaning: z.literal(true, {
      error: "You must accept the cleaning and damage policy",
    }),
    signature: z.string().min(1, "Signature is required"),
    // Step 4: Payment — handled separately by Stripe
    stripePaymentId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    // Tenant requires lease upload — validated at form level via file upload
    // (file upload not in Zod schema since it's handled by FileUpload component)
    void data;
    void ctx;
  });

export type ReservationFormData = z.infer<typeof reservationSchema>;

// ── Generic submission wrapper ───────────────────────────────────────
export const submissionSchema = z.object({
  formSlug: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export type SubmissionPayload = z.infer<typeof submissionSchema>;
