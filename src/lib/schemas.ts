import { z } from "zod";

// ── Contact Us Form ──────────────────────────────────────────────────
export const contactFormSchema = z.object({
  userType: z.enum(["Homeowner", "Real Estate / Title Company", "Other"], {
    message: "Please select who you are",
  }),
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  email: z.string().min(1, "Email is required").email("Please enter a valid email address"),
  department: z.enum(
    ["Customer Service", "Accounting", "Maintenance Request", "Other"],
    { message: "Please select a department" }
  ),
  message: z
    .string()
    .min(10, "Please provide at least 10 characters")
    .max(5000),
  contactMethod: z.enum(["Email", "Phone Call"], {
    message: "Please select a contact method",
  }),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;

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

// ── Generic submission wrapper ───────────────────────────────────────
export const submissionSchema = z.object({
  formSlug: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export type SubmissionPayload = z.infer<typeof submissionSchema>;
