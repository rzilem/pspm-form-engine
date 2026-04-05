import { Resend } from "resend";
import { logger } from "@/lib/logger";
import { formatTime12h } from "@/lib/booking";

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

/** Send email notification for generic form submissions */
export async function sendFormNotification(
  formSlug: string,
  data: Record<string, unknown>
): Promise<void> {
  const resend = getResend();
  if (!resend) {
    logger.info("Email skipped — RESEND_API_KEY not configured", { formSlug });
    return;
  }

  const config = FORM_EMAIL_CONFIG[formSlug];
  if (!config) {
    logger.warn("No email config for form", { formSlug });
    return;
  }

  const { to, subject, body } = config(data);

  await resend.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html: wrapHtml(subject, body),
  });

  logger.info("Form notification email sent", { formSlug, to });
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

interface EmailConfig {
  to: string[];
  subject: string;
  body: string;
}

const FORM_EMAIL_CONFIG: Record<string, (data: Record<string, unknown>) => EmailConfig> = {
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
