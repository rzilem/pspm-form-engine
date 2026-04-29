import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { formatTime12h } from "@/lib/booking";
import { populateCarrierWorkbook } from "@/lib/insurance-xlsx";
import type { InsuranceFormData } from "@/lib/schemas-insurance";
import { loadFormDefinition } from "@/lib/form-loader";
import {
  resolveRecipients,
  type FormDefinition,
  type FieldDefinition,
} from "@/lib/form-definitions";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_EMAIL = "PSPM Forms <forms@psprop.net>";

function getResend(): Resend | null {
  if (!RESEND_API_KEY) return null;
  return new Resend(RESEND_API_KEY);
}

/** Send email notification for generic form submissions.
 *
 * Resolution order:
 *  1. Legacy hand-coded FORM_EMAIL_CONFIG entry (proposal, invoice, ...)
 *  2. Dynamic notification_config on form_definitions
 *
 * When the resolver in /api/submit already loaded the definition it can
 * pass it via `definition` to skip the lookup; otherwise we re-fetch by
 * slug.
 */
export async function sendFormNotification(
  formSlug: string,
  data: Record<string, unknown>,
  definition?: FormDefinition,
): Promise<void> {
  const resend = getResend();
  if (!resend) {
    logger.info("Email skipped — RESEND_API_KEY not configured", { formSlug });
    return;
  }

  // Legacy path
  const legacyConfig = FORM_EMAIL_CONFIG[formSlug];
  if (legacyConfig) {
    const { to, subject, body, attachments } = await legacyConfig(data);
    await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: wrapHtml(subject, body),
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
    logger.info("Form notification email sent (legacy)", {
      formSlug,
      to,
      attachmentCount: attachments?.length ?? 0,
    });
    return;
  }

  // Dynamic path — load the form_definition if not provided
  const def = definition ?? (await loadFormDefinition(formSlug));
  if (!def) {
    logger.warn("No email config and no form_definition for slug", { formSlug });
    return;
  }

  const rules = def.notification_config.rules ?? [];
  if (rules.length === 0) {
    logger.info("form_definition has no notification rules — skipping email", { formSlug });
    return;
  }

  const body = renderDynamicEmailBody(def, data);
  let sent = 0;

  for (const rule of rules) {
    // Conditional gate (e.g. only notify when contactReason == "billing")
    if (rule.conditional) {
      const trigger = data[rule.conditional.fieldId];
      const matches = Array.isArray(rule.conditional.equals)
        ? rule.conditional.equals.includes(String(trigger ?? ""))
        : String(trigger ?? "") === rule.conditional.equals;
      if (!matches) continue;
    }

    const recipients = resolveRecipients(rule.recipients, data);
    if (recipients.length === 0) {
      logger.warn("Notification rule resolved to empty recipient list", {
        formSlug,
        rule: rule.subject,
      });
      continue;
    }

    const subject = renderTemplate(rule.subject, data);
    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject,
      html: wrapHtml(subject, body),
    });
    sent++;
  }

  logger.info("Form notification email sent (dynamic)", {
    formSlug,
    rulesEvaluated: rules.length,
    rulesSent: sent,
  });
}

// Render a rule's subject template against submission data.
// Supports `{{field.<id>}}` mustache references; unknown fields render as
// the empty string (loud failure would block legitimate emails over a typo).
function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(
    /\{\{\s*field\.([a-zA-Z0-9_-]+)\s*\}\}/g,
    (_match, fieldId: string) => {
      const v = data[fieldId];
      if (v === undefined || v === null) return "";
      if (typeof v === "string" || typeof v === "number") return String(v);
      // Composite fields (name, address) render as space-joined non-empty parts
      if (typeof v === "object") {
        return Object.values(v as Record<string, unknown>)
          .filter((x) => typeof x === "string" && x.trim() !== "")
          .join(" ");
      }
      return "";
    },
  );
}

// Build a generic two-column "label | value" table from any submission.
// Used by all dynamic forms; per-form HTML customization can be added in
// a follow-up via a notification_config.template field.
function renderDynamicEmailBody(
  def: FormDefinition,
  data: Record<string, unknown>,
): string {
  const rows = def.field_schema
    .filter((f: FieldDefinition) => f.type !== "section_break")
    .map((f) => {
      const raw = data[f.id];
      const value = formatFieldValue(raw);
      if (!value) return "";
      return `<tr>
        <td style="padding:6px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #f0f0f0">${escapeHtml(f.label)}</td>
        <td style="padding:6px 12px;vertical-align:top;border-bottom:1px solid #f0f0f0">${escapeHtml(value)}</td>
      </tr>`;
    })
    .join("");
  return `
    <p>A new submission was received for <strong>${escapeHtml(def.title)}</strong>.</p>
    <table style="border-collapse:collapse;margin:16px 0;min-width:300px">${rows}</table>
  `;
}

function formatFieldValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
      .map((x) => String(x))
      .join(" ");
  }
  return "";
}

/** Send booking confirmation email */
export async function sendBookingConfirmation(params: {
  email: string;
  name: string;
  confirmationCode: string;
  amenityName: string;
  date: string;
  startTime: string;
  endTime: string;
  amount: number;
  manageUrl: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    logger.info("Booking confirmation email skipped — no RESEND_API_KEY");
    return;
  }

  const dateFormatted = new Date(params.date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  await resend.emails.send({
    from: FROM_EMAIL,
    to: [params.email],
    subject: `Reservation Confirmed — ${params.confirmationCode}`,
    html: wrapHtml(`Reservation Confirmed`, `
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>Your reservation has been confirmed!</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:bold">Confirmation</td><td style="padding:6px 12px">${escapeHtml(params.confirmationCode)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Amenity</td><td style="padding:6px 12px">${escapeHtml(params.amenityName)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Date</td><td style="padding:6px 12px">${escapeHtml(dateFormatted)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Time</td><td style="padding:6px 12px">${escapeHtml(formatTime12h(params.startTime))} – ${escapeHtml(formatTime12h(params.endTime))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Deposit</td><td style="padding:6px 12px">$${(params.amount / 100).toFixed(2)}</td></tr>
      </table>
      <p><a href="${escapeHtml(params.manageUrl)}" style="display:inline-block;background:#3A4DA8;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Manage Reservation</a></p>
      <p style="color:#666;font-size:13px">Need to cancel or reschedule? Use the link above. Cancellations made at least 48 hours in advance are eligible for a full refund.</p>
    `),
  });

  logger.info("Booking confirmation email sent", { email: params.email, code: params.confirmationCode });
}

/** Send booking reminder email (called by cron) */
export async function sendBookingReminder(params: {
  email: string;
  name: string;
  confirmationCode: string;
  amenityName: string;
  date: string;
  startTime: string;
  endTime: string;
  manageUrl: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const dateFormatted = new Date(params.date + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  await resend.emails.send({
    from: FROM_EMAIL,
    to: [params.email],
    subject: `Reminder: Your reservation is tomorrow — ${params.confirmationCode}`,
    html: wrapHtml("Reservation Reminder", `
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>This is a friendly reminder that your reservation is <strong>tomorrow</strong>.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:bold">Amenity</td><td style="padding:6px 12px">${escapeHtml(params.amenityName)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Date</td><td style="padding:6px 12px">${escapeHtml(dateFormatted)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Time</td><td style="padding:6px 12px">${escapeHtml(formatTime12h(params.startTime))} – ${escapeHtml(formatTime12h(params.endTime))}</td></tr>
      </table>
      <p><a href="${escapeHtml(params.manageUrl)}" style="display:inline-block;background:#3A4DA8;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Manage Reservation</a></p>
    `),
  });

  logger.info("Booking reminder sent", { email: params.email, code: params.confirmationCode });
}

/** Send admin notification for new booking */
export async function sendAdminBookingNotification(params: {
  confirmationCode: string;
  amenityName: string;
  residentName: string;
  date: string;
  startTime: string;
  endTime: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: ["rickyz@psprop.net"],
    subject: `New Reservation: ${params.amenityName} — ${params.confirmationCode}`,
    html: wrapHtml("New Reservation", `
      <p>A new reservation has been submitted:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:bold">Code</td><td style="padding:6px 12px">${escapeHtml(params.confirmationCode)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Resident</td><td style="padding:6px 12px">${escapeHtml(params.residentName)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Amenity</td><td style="padding:6px 12px">${escapeHtml(params.amenityName)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Date</td><td style="padding:6px 12px">${escapeHtml(params.date)}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Time</td><td style="padding:6px 12px">${escapeHtml(formatTime12h(params.startTime))} – ${escapeHtml(formatTime12h(params.endTime))}</td></tr>
      </table>
    `),
  });
}

/** Send cancellation confirmation */
export async function sendCancellationEmail(params: {
  email: string;
  name: string;
  confirmationCode: string;
  amenityName: string;
  date: string;
  refundStatus: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const refundText = params.refundStatus === "refunded"
    ? "Your deposit has been refunded to your original payment method. Please allow 5-10 business days for the refund to appear."
    : params.refundStatus === "no_refund"
    ? "This cancellation was made within the 48-hour cancellation window, so the deposit is non-refundable."
    : "There was an issue processing your refund. Please contact us at 512-251-6122.";

  await resend.emails.send({
    from: FROM_EMAIL,
    to: [params.email],
    subject: `Reservation Cancelled — ${params.confirmationCode}`,
    html: wrapHtml("Reservation Cancelled", `
      <p>Hi ${escapeHtml(params.name)},</p>
      <p>Your reservation (${escapeHtml(params.confirmationCode)}) for <strong>${escapeHtml(params.amenityName)}</strong> on ${escapeHtml(params.date)} has been cancelled.</p>
      <p>${escapeHtml(refundText)}</p>
      <p>If you have questions, call us at 512-251-6122.</p>
    `),
  });

  logger.info("Cancellation email sent", { email: params.email, code: params.confirmationCode });
}

// ── Form-specific email configs ──────────────────────────────────────

interface EmailAttachment {
  filename: string;
  content: Buffer;
}

interface EmailConfig {
  to: string[];
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
}

type EmailConfigBuilder = (
  data: Record<string, unknown>,
) => EmailConfig | Promise<EmailConfig>;

const FORM_EMAIL_CONFIG: Record<string, EmailConfigBuilder> = {
  proposal: (data) => ({
    to: ["rickyz@psprop.net"],
    subject: `New Management Proposal Request — ${data.associationName ?? "Unknown"}`,
    body: `
      <p>A new management proposal request has been submitted:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:bold">Name</td><td style="padding:6px 12px">${escapeHtml(String(data.firstName ?? ""))} ${escapeHtml(String(data.lastName ?? ""))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Association</td><td style="padding:6px 12px">${escapeHtml(String(data.associationName ?? "N/A"))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Type</td><td style="padding:6px 12px">${escapeHtml(String(data.proposalType ?? "N/A"))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Units</td><td style="padding:6px 12px">${escapeHtml(String(data.numberOfUnits ?? "N/A"))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Email</td><td style="padding:6px 12px">${escapeHtml(String(data.email ?? "N/A"))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Phone</td><td style="padding:6px 12px">${escapeHtml(String(data.phone ?? "N/A"))}</td></tr>
      </table>
    `,
  }),

  invoice: (data) => ({
    to: ["invoices@psprop.net"],
    subject: `New Invoice — ${data.communityName ?? "Unknown Community"}`,
    body: `
      <p>A new invoice has been submitted:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:bold">Community</td><td style="padding:6px 12px">${escapeHtml(String(data.communityName ?? ""))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Type</td><td style="padding:6px 12px">${escapeHtml(String(data.invoiceType ?? ""))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Account #</td><td style="padding:6px 12px">${escapeHtml(String(data.accountNumber ?? "N/A"))}</td></tr>
      </table>
    `,
  }),

  billback: (data) => ({
    to: ["mgrbillback@psprop.net"],
    subject: `New Manager Billback — ${data.communityName ?? "Unknown Community"}`,
    body: `
      <p>A new billback has been submitted:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:bold">Community</td><td style="padding:6px 12px">${escapeHtml(String(data.communityName ?? ""))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Notes</td><td style="padding:6px 12px">${escapeHtml(String(data.notes ?? "N/A"))}</td></tr>
      </table>
    `,
  }),

  "falcon-pointe-portal": (data) => ({
    to: ["rickyz@psprop.net"],
    subject: `Falcon Pointe Portal — ${data.requestType ?? "Request"}`,
    body: `
      <p>A new portal request has been submitted:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 12px;font-weight:bold">Name</td><td style="padding:6px 12px">${escapeHtml(String(data.firstName ?? ""))} ${escapeHtml(String(data.lastName ?? ""))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Address</td><td style="padding:6px 12px">${escapeHtml(String(data.address ?? ""))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Type</td><td style="padding:6px 12px">${escapeHtml(String(data.requestType ?? ""))}</td></tr>
        <tr><td style="padding:6px 12px;font-weight:bold">Email</td><td style="padding:6px 12px">${escapeHtml(String(data.email ?? ""))}</td></tr>
      </table>
    `,
  }),

  insurance: async (data) => {
    // Insurance submission: data.flat has 80+ fields, data.buildings is array.
    // Body lists every populated field for staff review; XLSX attachment is the
    // actual carrier-ready file (carrier wants their template format).
    const flat = (data.flat ?? {}) as Record<string, string>;
    const buildings = Array.isArray(data.buildings)
      ? (data.buildings as Array<Record<string, string>>)
      : [];
    const legalName = flat.legal_name || "Unknown Association";
    const renderRow = (k: string, v: string) =>
      v && v.trim() !== ""
        ? `<tr><td style="padding:4px 12px;font-weight:600;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 12px;vertical-align:top">${escapeHtml(v)}</td></tr>`
        : "";
    const flatRows = Object.entries(flat)
      .map(([k, v]) => renderRow(k, String(v ?? "")))
      .join("");
    const buildingBlocks = buildings
      .map((b, i) => {
        const inner = Object.entries(b)
          .map(([k, v]) => renderRow(k, String(v ?? "")))
          .join("");
        return inner
          ? `<h3 style="margin:20px 0 4px 0;color:#1B4F72">Building ${i + 1}</h3><table style="border-collapse:collapse">${inner}</table>`
          : "";
      })
      .join("");

    const carrierEmail = process.env.INSURANCE_CARRIER_EMAIL?.trim();
    const recipients = ["insurance@psprop.net", "rickyz@psprop.net"];
    if (carrierEmail) recipients.push(carrierEmail);

    // Generate the carrier-format XLSX. If population fails (corrupt template,
    // missing sheet, etc.), still send the email with submission detail so the
    // intake isn't silently lost — staff can regenerate from form_submissions.
    const attachments: EmailAttachment[] = [];
    let attachmentNote = "";
    try {
      const xlsxBuffer = await populateCarrierWorkbook(data as unknown as InsuranceFormData);
      const safeName = legalName.replace(/[^A-Za-z0-9 _.-]/g, "").replace(/\s+/g, "_").slice(0, 60) || "Submission";
      const today = new Date().toISOString().slice(0, 10);
      attachments.push({
        filename: `HOA_Insurance_Intake_${safeName}_${today}.xlsx`,
        content: xlsxBuffer,
      });
    } catch (err) {
      logger.error("Insurance XLSX populate failed — sending email without attachment", {
        error: err instanceof Error ? err.message : String(err),
        legalName,
      });
      attachmentNote = `<p style="color:#b91c1c;background:#fef2f2;border:1px solid #fecaca;padding:12px;border-radius:6px"><strong>Note:</strong> The carrier XLSX failed to generate automatically. Submission detail is below; staff can regenerate from <code>form_submissions</code>.</p>`;
    }

    const attachedBlurb = attachments.length > 0
      ? `<p>The carrier-ready XLSX is attached to this email. Review the field detail below before forwarding to the carrier.</p>`
      : `<p>Review and convert to a carrier-ready XLSX/PDF in the staff onboarding portal before forwarding to the carrier.</p>`;

    return {
      to: recipients,
      subject: `New Business Insurance Intake — ${legalName}`,
      body: `
        <p>A new HOA insurance intake has been submitted via psprop.net forms.</p>
        ${attachedBlurb}
        ${attachmentNote}
        <h3 style="margin:20px 0 4px 0;color:#1B4F72">Submission Detail</h3>
        <table style="border-collapse:collapse">${flatRows}</table>
        ${buildingBlocks}
      `,
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  },
};

// ── HTML wrapper ─────────────────────────────────────────────────────

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <div style="border-bottom:3px solid #3A4DA8;padding-bottom:12px;margin-bottom:24px">
    <h2 style="color:#3A4DA8;margin:0">${title}</h2>
    <p style="color:#666;margin:4px 0 0;font-size:13px">PS Property Management</p>
  </div>
  ${body}
  <div style="border-top:1px solid #eee;margin-top:32px;padding-top:16px;color:#888;font-size:12px">
    <p>PS Property Management — 1490 Rusk Rd, Ste. 301, Round Rock, TX 78665 — 512-251-6122</p>
  </div>
</body></html>`;
}
