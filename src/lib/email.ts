import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { formatTime12h } from "@/lib/booking";
import { populateCarrierWorkbook } from "@/lib/insurance-xlsx";
import type { InsuranceFormData } from "@/lib/schemas-insurance";
import { loadFormDefinition } from "@/lib/form-loader";
import {
  resolveRecipients,
  renderBodyTemplate,
  evaluateCondition,
  lineItemTotal,
  formatMoney,
  formatFieldDisplayText,
  getSelectedImageChoiceOptions,
  resolveListColumns,
  listRowIsMeaningful,
  resolveVisibleFieldIds,
  type FormDefinition,
  type FieldDefinition,
  type NotificationRule,
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
  pdfAttachment?: { filename: string; content: Buffer } | null,
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

  let sent = 0;

  // Build the attachment list once — same PDF goes on every rule that
  // fires for this submission. Resend accepts {filename, content: Buffer}.
  const attachments = pdfAttachment
    ? [{ filename: pdfAttachment.filename, content: pdfAttachment.content }]
    : undefined;

  for (const rule of rules) {
    // Conditional gate — shared evaluator (legacy + multi-condition shapes).
    // Notifications have no visibility graph; trigger fields are always eligible.
    if (
      rule.conditional &&
      !evaluateCondition(rule.conditional, data, () => true)
    ) {
      continue;
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
    const { html: bodyHtml, text: bodyText } = buildDynamicNotificationBodies(
      def,
      data,
      rule,
    );
    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject,
      html: wrapHtml(subject, bodyHtml),
      text: wrapPlainText(subject, bodyText),
      ...(attachments ? { attachments } : {}),
    });
    sent++;
  }

  logger.info("Form notification email sent (dynamic)", {
    formSlug,
    rulesEvaluated: rules.length,
    rulesSent: sent,
    attachedPdf: Boolean(pdfAttachment),
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

function notificationIntroHtml(def: FormDefinition): string {
  return `<p>A new submission was received for <strong>${escapeHtml(def.title)}</strong>.</p>`;
}

function notificationIntroText(def: FormDefinition): string {
  return `A new submission was received for ${def.title}.`;
}

function notificationFooterHtml(): string {
  return `<p style="color:#666;font-size:12px">File uploads are stored privately; sign in to the admin to download. Signatures are captured as images on the attached PDF.</p>`;
}

function notificationFooterText(): string {
  return "File uploads are stored privately; sign in to the admin to download. Signatures are captured as images on the attached PDF.";
}

function buildDynamicNotificationBodies(
  def: FormDefinition,
  data: Record<string, unknown>,
  rule: NotificationRule,
): { html: string; text: string } {
  if (rule.body?.trim()) {
    const customBody = rule.body.trim();
    const rendered = renderBodyTemplate(customBody, def, data);
    // CloudMailin parses Label: Value lines from the plaintext MIME part — always
    // include them even when the custom body omits `{all_fields}` (HTML stays custom).
    const supplementalAllFields = /\{all_fields\}/.test(customBody)
      ? ""
      : renderBodyTemplate("{all_fields}", def, data).text;
    return {
      html:
        notificationIntroHtml(def) + rendered.html + notificationFooterHtml(),
      text: joinPlainSections([
        notificationIntroText(def),
        rendered.text,
        supplementalAllFields,
        notificationFooterText(),
      ]),
    };
  }

  const html = renderDynamicEmailBody(def, data);
  const allFieldsText = renderBodyTemplate("{all_fields}", def, data).text;
  return {
    html,
    text: joinPlainSections([
      notificationIntroText(def),
      allFieldsText,
      notificationFooterText(),
    ]),
  };
}

function joinPlainSections(parts: string[]): string {
  return parts.filter((p) => p.trim() !== "").join("\n\n");
}

// Build a generic two-column "label | value" table from any submission.
// Used by all dynamic forms; per-form HTML customization can be added in
// a follow-up via a notification_config.template field.
function renderDynamicEmailBody(
  def: FormDefinition,
  data: Record<string, unknown>,
): string {
  const visible = resolveVisibleFieldIds(def.field_schema, data);
  const rows = def.field_schema
    .filter(
      (f: FieldDefinition) =>
        visible.has(f.id) &&
        f.type !== "section_break" &&
        f.type !== "page_break" &&
        f.type !== "html",
    )
    .map((f) => {
      const raw = data[f.id];
      const cellHtml = renderFieldCellHtml(f, raw);
      if (!cellHtml) return "";
      return `<tr>
        <td style="padding:6px 12px;font-weight:600;vertical-align:top;border-bottom:1px solid #f0f0f0">${escapeHtml(f.label)}</td>
        <td style="padding:6px 12px;vertical-align:top;border-bottom:1px solid #f0f0f0">${cellHtml}</td>
      </tr>`;
    })
    .join("");
  return `
    <p>A new submission was received for <strong>${escapeHtml(def.title)}</strong>.</p>
    <table style="border-collapse:collapse;margin:16px 0;min-width:300px">${rows}</table>
    <p style="color:#666;font-size:12px">File uploads are stored privately; sign in to the admin to download. Signatures are captured as images on the attached PDF.</p>
  `;
}

// Render the value cell as HTML (already escaped). Returns empty string
// when the field is missing/blank so the caller can skip the row entirely.
function renderFieldCellHtml(field: FieldDefinition, raw: unknown): string {
  if (field.type === "file_upload") {
    if (!Array.isArray(raw) || raw.length === 0) return "";
    const items = raw
      .filter(
        (u): u is { filename: string; size: number } =>
          Boolean(u) &&
          typeof u === "object" &&
          typeof (u as { filename?: unknown }).filename === "string",
      )
      .map((u) => `<li>${escapeHtml(u.filename)} (${formatBytes(u.size)})</li>`)
      .join("");
    if (!items) return "";
    return `<ul style="margin:0;padding-left:18px">${items}</ul>`;
  }
  if (field.type === "signature") {
    if (typeof raw !== "string" || !raw.startsWith("data:image/")) return "";
    return `<em style="color:#666">Signature captured (see attached PDF)</em>`;
  }
  if (field.type === "line_items") {
    if (!Array.isArray(raw) || raw.length === 0) return "";
    const useQty =
      field.lineItemMode === "preset" || Boolean(field.allowQuantity);
    const items = raw
      .map((r) => {
        const row = (r ?? {}) as Record<string, unknown>;
        const desc = escapeHtml(
          String(row.description ?? "").trim() || "(no description)",
        );
        const amt = formatMoney(Number(row.amount) || 0);
        const lt = formatMoney(lineItemTotal(row, useQty));
        const qty = useQty ? ` &times;${escapeHtml(String(row.quantity ?? 1))}` : "";
        return `<li>${desc} &mdash; ${amt}${qty} = ${lt}</li>`;
      })
      .join("");
    return `<ul style="margin:0;padding-left:18px">${items}</ul>`;
  }
  if (field.type === "list") {
    if (!Array.isArray(raw) || raw.length === 0) return "";
    const cols = resolveListColumns(field);
    const colIds = new Set(cols.map((c) => c.id));
    const rows = raw.filter((r) => listRowIsMeaningful(r, colIds));
    if (rows.length === 0) return "";
    const head = cols
      .map(
        (c) =>
          `<th style="padding:6px 10px;border:1px solid #e5e7eb;background:#1e3a5f;color:#fff;text-align:left;font-size:12px">${escapeHtml(c.label)}</th>`,
      )
      .join("");
    const body = rows
      .map((r) => {
        const row = (r ?? {}) as Record<string, unknown>;
        const cells = cols
          .map(
            (c) =>
              `<td style="padding:6px 10px;border:1px solid #e5e7eb;vertical-align:top">${escapeHtml(String(row[c.id] ?? "").trim())}</td>`,
          )
          .join("");
        return `<tr>${cells}</tr>`;
      })
      .join("");
    return `<table style="border-collapse:collapse;margin:8px 0;min-width:240px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }
  if (field.type === "total") {
    // A conditionally hidden total is deleted from the data — skip the row
    // entirely rather than emailing a $0.00 the submitter never saw.
    if (raw === undefined || raw === null) return "";
    return `<strong>${formatMoney(raw)}</strong>`;
  }
  if (field.type === "image_choice") {
    const selections = getSelectedImageChoiceOptions(field, raw);
    if (selections.length === 0) return "";
    const labelText = formatFieldDisplayText(field, raw);
    const thumbs = selections
      .filter((s) => s.image)
      .map(
        (s) =>
          `<img src="${escapeHtml(s.image!)}" alt="${escapeHtml(s.label)}" width="48" height="48" style="object-fit:cover;border-radius:4px;margin-right:6px;vertical-align:middle" />`,
      )
      .join("");
    if (!thumbs) return escapeHtml(labelText);
    return `${thumbs}<span>${escapeHtml(labelText)}</span>`;
  }
  const value = formatFieldDisplayText(field, raw);
  if (!value) return "";
  return escapeHtml(value);
}

function formatBytes(bytes: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Send a workflow step-assignment email with magic-link approve/reject URL.
 * Called by /api/submit on kickoff and by applyDecision on advance.
 *
 * The assignee email already came from resolveStepAssignee + admin
 * fallback, so we don't try to "fix" missing emails here — drop the
 * notification and log if recipient is empty.
 */
export async function sendWorkflowAssignmentEmail(params: {
  to: string;
  formTitle: string;
  stepLabel: string;
  actionUrl: string;
  customSubject?: string;
  submissionRef: string;
  description?: string;
  comments?: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    logger.info("Workflow assignment email skipped — no RESEND_API_KEY", {
      to: params.to,
      step: params.stepLabel,
    });
    return;
  }
  if (!params.to || !params.to.includes("@")) {
    logger.warn("Workflow assignment email has invalid recipient — skipping", {
      to: params.to,
    });
    return;
  }

  const subject =
    params.customSubject?.trim() ||
    `Action required: ${params.stepLabel} — ${params.formTitle}`;
  const body = `
    <p>You have a new <strong>${escapeHtml(params.stepLabel)}</strong> task waiting on a <strong>${escapeHtml(params.formTitle)}</strong> submission.</p>
    ${params.description ? `<p>${escapeHtml(params.description)}</p>` : ""}
    ${params.comments ? `<p><em>Previous note:</em> ${escapeHtml(params.comments)}</p>` : ""}
    <p style="margin-top:24px">
      <a href="${escapeHtml(params.actionUrl)}"
         style="display:inline-block;background:#3A4DA8;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:bold">
        Review &amp; Decide
      </a>
    </p>
    <p style="color:#666;font-size:12px;margin-top:24px">
      Reference: ${escapeHtml(params.submissionRef.slice(0, 8))}<br>
      This link expires in 30 days. Single-use; once you decide, the link
      stops working. If you didn't expect this email, just ignore it.
    </p>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: [params.to],
    subject,
    html: wrapHtml(subject, body),
  });
  logger.info("Workflow assignment email sent", {
    to: params.to,
    step: params.stepLabel,
  });
}

/**
 * Notify the original submitter that their submission was rejected
 * mid-workflow. Optional — caller passes a recipient resolved from
 * a designated email field (e.g. `email`) on the form data.
 */
export async function sendWorkflowOutcomeEmail(params: {
  to: string;
  formTitle: string;
  outcome: "approved" | "rejected";
  comments?: string;
  submissionRef: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) return;
  if (!params.to || !params.to.includes("@")) return;

  const subject = `Update on your ${params.formTitle} submission`;
  const verdict =
    params.outcome === "approved"
      ? "Your request has been approved."
      : "Your request was not approved at this time.";
  const body = `
    <p>${escapeHtml(verdict)}</p>
    ${params.comments ? `<p><em>Note from reviewer:</em> ${escapeHtml(params.comments)}</p>` : ""}
    <p style="color:#666;font-size:12px;margin-top:24px">
      Reference: ${escapeHtml(params.submissionRef.slice(0, 8))}
    </p>
  `;
  await resend.emails.send({
    from: FROM_EMAIL,
    to: [params.to],
    subject,
    html: wrapHtml(subject, body),
  });
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

/** Best-effort email with a Save & Continue resume link. */
export async function sendResumeLinkEmail(opts: {
  to: string;
  formTitle: string;
  resumeUrl: string;
}): Promise<void> {
  const resend = getResend();
  if (!resend) {
    logger.info("Resume link email skipped — RESEND_API_KEY not configured", {
      formTitle: opts.formTitle,
    });
    return;
  }

  const subject = `Continue your ${opts.formTitle} form`;
  const body = `
    <p>You started filling out <strong>${escapeHtml(opts.formTitle)}</strong> and saved your progress.</p>
    <p>Use the link below to pick up where you left off. This link expires in 30 days.</p>
    <p style="margin:24px 0">
      <a href="${escapeHtml(opts.resumeUrl)}" style="display:inline-block;background:#3A4DA8;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
        Continue your form
      </a>
    </p>
    <p style="font-size:13px;color:#666">Or copy this link:<br>
      <a href="${escapeHtml(opts.resumeUrl)}">${escapeHtml(opts.resumeUrl)}</a>
    </p>
  `;

  await resend.emails.send({
    from: FROM_EMAIL,
    to: opts.to,
    subject,
    html: wrapHtml(subject, body),
    text: wrapPlainText(
      subject,
      `Continue your ${opts.formTitle} form:\n${opts.resumeUrl}\n\nThis link expires in 30 days.`,
    ),
  });

  logger.info("Resume link email sent", { formTitle: opts.formTitle });
}

// ── HTML wrapper ─────────────────────────────────────────────────────

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a1a1a">
  <div style="border-bottom:3px solid #3A4DA8;padding-bottom:12px;margin-bottom:24px">
    <h2 style="color:#3A4DA8;margin:0">${escapeHtml(title)}</h2>
    <p style="color:#666;margin:4px 0 0;font-size:13px">PS Property Management</p>
  </div>
  ${body}
  <div style="border-top:1px solid #eee;margin-top:32px;padding-top:16px;color:#888;font-size:12px">
    <p>PS Property Management — 1490 Rusk Rd, Ste. 301, Round Rock, TX 78665 — 512-251-6122</p>
  </div>
</body></html>`;
}

function wrapPlainText(title: string, body: string): string {
  return [
    title,
    "PS Property Management",
    "",
    body,
    "",
    "—",
    "PS Property Management — 1490 Rusk Rd, Ste. 301, Round Rock, TX 78665 — 512-251-6122",
  ].join("\n");
}
