/**
 * Per-submission PDF generation for dynamic forms.
 *
 * Replaces Gravity PDF for forms managed via form_definitions. Builds a
 * branded "letterhead + field table + footer" PDF and returns a Buffer
 * suitable for emailing as an attachment or uploading to storage.
 *
 * Implementation: @react-pdf/renderer (pure JS, no system deps, already
 * proven in pspm-onboarding-portal). React-style template components
 * stay readable while supporting flexible layouts later.
 *
 * Trade-offs:
 *  - One template ('default') ships in v1. Custom per-form templates are
 *    Phase 2.1; the schema (`pdf_config.template`) leaves room.
 *  - File uploads / signatures / payment fields aren't surfaced in the
 *    PDF until Phase 1.3 lands them as form-engine data — they currently
 *    can't be captured in dynamic forms anyway.
 */
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Font,
} from "@react-pdf/renderer";
import type { FieldDefinition, FormDefinition } from "@/lib/form-definitions";
import { logger } from "@/lib/logger";

// PSPM brand palette (mirrors src/index.css custom properties).
// Hardcoded here because @react-pdf/renderer can't read CSS variables.
const COLORS = {
  primary: "#3A4DA8",
  navy: "#1B4F72",
  brandGreen: "#4CB648",
  border: "#E5E7EB",
  muted: "#6B7280",
  foreground: "#1A1A1A",
  bg: "#FFFFFF",
};

// react-pdf needs explicit font registration. Helvetica is the built-in
// default, so we don't need to ship custom fonts in v1. Inter would
// match the web UI but adds binary download to Cloud Run cold starts.
Font.registerHyphenationCallback((word) => [word]); // disable hyphenation

const styles = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: COLORS.foreground,
  },
  header: {
    borderBottomWidth: 3,
    borderBottomColor: COLORS.primary,
    paddingBottom: 12,
    marginBottom: 24,
  },
  brand: {
    fontSize: 14,
    color: COLORS.primary,
    fontWeight: "bold",
  },
  brandSub: {
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: COLORS.navy,
    marginBottom: 4,
  },
  meta: {
    fontSize: 9,
    color: COLORS.muted,
    marginBottom: 16,
  },
  description: {
    fontSize: 10,
    color: COLORS.foreground,
    marginBottom: 16,
    lineHeight: 1.4,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.navy,
    marginTop: 16,
    marginBottom: 6,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  table: {
    flexDirection: "column",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  rowZebra: {
    backgroundColor: "#FAFAFA",
  },
  labelCell: {
    width: "35%",
    paddingRight: 8,
    fontWeight: "bold",
    color: COLORS.navy,
  },
  valueCell: {
    width: "65%",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 48,
    right: 48,
    fontSize: 8,
    color: COLORS.muted,
    textAlign: "center",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 8,
  },
});

// Format a single value for the PDF cell. Mirrors lib/email.ts logic so
// the same submission renders identically across email body and PDF.
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
      .map((x) => String(x))
      .join(" ");
  }
  return "";
}

/**
 * The default PDF template — branded letterhead with field/value table
 * grouped by section_break boundaries.
 */
function DefaultFormDocument({
  definition,
  data,
  submissionId,
  submittedAt,
}: {
  definition: FormDefinition;
  data: Record<string, unknown>;
  submissionId: string;
  submittedAt: Date;
}) {
  const phone = process.env.NEXT_PUBLIC_PSPM_PHONE ?? "512-251-6122";
  const website = process.env.NEXT_PUBLIC_PSPM_WEBSITE ?? "psprop.net";
  const address =
    process.env.NEXT_PUBLIC_PSPM_ADDRESS ??
    "1490 Rusk Rd, Ste. 301, Round Rock, TX 78665";

  // Group fields by section_break boundaries so PDFs of long forms with
  // visual sections in the UI render with the same hierarchy on paper.
  type Group = { heading: string | null; fields: FieldDefinition[] };
  const groups: Group[] = [];
  let current: Group = { heading: null, fields: [] };
  for (const f of definition.field_schema) {
    if (f.type === "section_break") {
      if (current.fields.length > 0) groups.push(current);
      current = { heading: f.label, fields: [] };
    } else {
      current.fields.push(f);
    }
  }
  if (current.fields.length > 0) groups.push(current);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.brand}>PS Property Management</Text>
          <Text style={styles.brandSub}>
            {phone} · {website}
          </Text>
        </View>

        <Text style={styles.title}>{definition.title}</Text>
        <Text style={styles.meta}>
          Submitted {submittedAt.toLocaleString("en-US", { timeZone: "America/Chicago" })} ·
          Reference: {submissionId.slice(0, 8)}
        </Text>

        {definition.description ? (
          <Text style={styles.description}>{definition.description}</Text>
        ) : null}

        {groups.map((g, gi) => (
          <View key={gi} wrap={false}>
            {g.heading ? <Text style={styles.sectionHeading}>{g.heading}</Text> : null}
            <View style={styles.table}>
              {g.fields.map((f, fi) => {
                const v = formatValue(data[f.id]);
                if (v === "" || v === "—") return null;
                return (
                  <View
                    key={f.id}
                    style={[styles.row, fi % 2 === 1 ? styles.rowZebra : {}]}
                  >
                    <Text style={styles.labelCell}>{f.label}</Text>
                    <Text style={styles.valueCell}>{v}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>
            PS Property Management · {address}
          </Text>
          <Text>
            This document was generated automatically from the {definition.title} submission. Reference {submissionId}.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Render a submission to a PDF Buffer. Returns null on render failure
 * (caller decides whether to block submission or fall back to no-PDF
 * email — current callers fall back, since intake should never be lost).
 *
 * @react-pdf/renderer's pdf().toBuffer() returns a Node Readable stream
 * (the name is historical); consumed here into a single Buffer for
 * Resend's attachment field.
 */
export async function generateFormPdf(
  definition: FormDefinition,
  data: Record<string, unknown>,
  submissionId: string,
  submittedAt: Date = new Date(),
): Promise<Buffer | null> {
  if (!definition.pdf_config?.enabled) return null;

  try {
    const doc = (
      <DefaultFormDocument
        definition={definition}
        data={data}
        submissionId={submissionId}
        submittedAt={submittedAt}
      />
    );
    const stream = await pdf(doc).toBuffer();
    return await streamToBuffer(stream as unknown as NodeJS.ReadableStream);
  } catch (err) {
    logger.error("Form PDF render failed", {
      slug: definition.slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Consume a Node Readable into a single Buffer. Avoids `stream/consumers`
// because some Cloud Run Node base images flag it on older Node versions;
// the manual consumer keeps deploy targets wide.
async function streamToBuffer(
  stream: NodeJS.ReadableStream,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Build the filename used for email attachments and storage paths.
 * Sanitizes prefix so filesystem/HTTP-header-unfriendly chars never reach
 * Resend's attachment field.
 */
export function getPdfFilename(
  definition: FormDefinition,
  submissionId: string,
): string {
  const rawPrefix = definition.pdf_config?.filenamePrefix ?? definition.slug;
  const safePrefix = rawPrefix
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || definition.slug;
  return `${safePrefix}-${submissionId.slice(0, 8)}.pdf`;
}
