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
  Image,
  StyleSheet,
  pdf,
  Font,
} from "@react-pdf/renderer";
import type {
  FieldDefinition,
  FormDefinition,
  UploadedFile,
} from "@/lib/form-definitions";
import {
  lineItemTotal,
  formatMoney,
  resolveVisibleFieldIds,
  formatFieldDisplayText,
  getSelectedImageChoiceOptions,
} from "@/lib/form-definitions";
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
  fileList: {
    flexDirection: "column",
    gap: 2,
  },
  fileItem: {
    fontSize: 9,
    color: COLORS.foreground,
  },
  signatureImage: {
    width: 200,
    height: 80,
    objectFit: "contain",
  },
  choiceThumbRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  choiceThumb: {
    width: 36,
    height: 36,
    objectFit: "cover",
    marginRight: 6,
    borderRadius: 2,
  },
  // Itemized line-items table (invoice-style).
  liTable: {
    marginTop: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  liHeaderRow: {
    flexDirection: "row",
    backgroundColor: COLORS.navy,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  liHeaderText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "bold",
  },
  liRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  liRowZebra: { backgroundColor: "#FAFBFF" },
  liDescCol: { flex: 1, paddingRight: 6 },
  liNumCol: { width: 70, textAlign: "right" },
  liQtyCol: { width: 38, textAlign: "right" },
  liTotalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 4,
    marginBottom: 6,
    paddingTop: 6,
    borderTopWidth: 2,
    borderTopColor: COLORS.navy,
  },
  liGrandLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.navy,
    marginRight: 16,
  },
  liGrandValue: {
    fontSize: 12,
    fontWeight: "bold",
    color: COLORS.navy,
  },
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Whether a field has submission data worth showing in the PDF (mirrors the
// null checks in renderValueCell / renderLineItemsTable / renderTotalRow).
function wouldRenderFieldInPdf(
  field: FieldDefinition,
  value: unknown,
): boolean {
  if (field.type === "file_upload") {
    const files = Array.isArray(value) ? value : [];
    return files.length > 0;
  }
  if (field.type === "signature") {
    return typeof value === "string" && value.startsWith("data:image/");
  }
  if (field.type === "line_items") {
    return Array.isArray(value) && value.length > 0;
  }
  if (field.type === "total") {
    return value !== undefined && value !== null;
  }
  const text = formatFieldDisplayText(field, value);
  return text !== "" && text !== "—";
}

// Decide whether a row should render at all and what its value cell is.
// Returns null when the field is empty (caller skips it). For file_upload
// + signature returns a JSX cell; for everything else returns a string
// the caller wraps in <Text>.
function renderValueCell(
  field: FieldDefinition,
  value: unknown,
): React.ReactNode | null {
  if (field.type === "file_upload") {
    const files = Array.isArray(value) ? (value as UploadedFile[]) : [];
    if (files.length === 0) return null;
    return (
      <View style={styles.fileList}>
        {files.map((f, i) => (
          <Text key={i} style={styles.fileItem}>
            • {f.filename} ({formatFileSize(f.size)})
          </Text>
        ))}
      </View>
    );
  }
  if (field.type === "signature") {
    if (typeof value !== "string" || !value.startsWith("data:image/")) {
      return null;
    }
    // Suppress react-pdf's known limitation: large data URLs slow render.
    // We already cap at 2MB server-side via the Zod schema.
    // Image is @react-pdf/renderer's PDF primitive, not <img>; alt-text rule
    // doesn't apply here.
    // eslint-disable-next-line jsx-a11y/alt-text
    return <Image src={value} style={styles.signatureImage} />;
  }
  // line_items + total are rendered full-width as an itemized invoice table by
  // the document body (renderLineItemsTable / renderTotalRow), not as a
  // label/value cell — so they fall through here and are skipped.
  if (field.type === "line_items" || field.type === "total") return null;
  if (field.type === "image_choice") {
    const selections = getSelectedImageChoiceOptions(field, value);
    if (selections.length === 0) return null;
    const withImages = selections.filter((s) => s.image);
    if (withImages.length === 0) {
      return <Text>{formatFieldDisplayText(field, value)}</Text>;
    }
    return (
      <View>
        {selections.map((s) => (
          <View key={s.value} style={styles.choiceThumbRow}>
            {s.image ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={s.image} style={styles.choiceThumb} />
            ) : null}
            <Text>{s.label}</Text>
          </View>
        ))}
      </View>
    );
  }
  const text = formatFieldDisplayText(field, value);
  if (text === "" || text === "—") return null;
  return <Text>{text}</Text>;
}

// Full-width itemized table for a line_items field. Returns null when empty so
// the field is skipped. Columns: Description [· Qty · Unit] · Amount(line total).
function renderLineItemsTable(
  field: FieldDefinition,
  value: unknown,
): React.ReactNode | null {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length === 0) return null;
  const useQty = field.lineItemMode === "preset" || Boolean(field.allowQuantity);
  return (
    <View key={field.id} style={styles.liTable} wrap={false}>
      <View style={styles.liHeaderRow}>
        <Text style={[styles.liHeaderText, styles.liDescCol]}>
          {field.label || "Items"}
        </Text>
        {useQty ? (
          <Text style={[styles.liHeaderText, styles.liQtyCol]}>Qty</Text>
        ) : null}
        {useQty ? (
          <Text style={[styles.liHeaderText, styles.liNumCol]}>Unit</Text>
        ) : null}
        <Text style={[styles.liHeaderText, styles.liNumCol]}>Amount</Text>
      </View>
      {rows.map((r, i) => {
        const row = (r ?? {}) as Record<string, unknown>;
        const desc = String(row.description ?? "").trim() || "(no description)";
        const amt = Number(row.amount) || 0;
        const qty = row.quantity ?? 1;
        const lt = lineItemTotal(row, useQty);
        return (
          <View key={i} style={[styles.liRow, i % 2 === 1 ? styles.liRowZebra : {}]}>
            <Text style={styles.liDescCol}>{desc}</Text>
            {useQty ? <Text style={styles.liQtyCol}>{String(qty)}</Text> : null}
            {useQty ? (
              <Text style={styles.liNumCol}>{formatMoney(amt)}</Text>
            ) : null}
            <Text style={styles.liNumCol}>{formatMoney(lt)}</Text>
          </View>
        );
      })}
    </View>
  );
}

// Emphasized grand-total row. Returns null when the value is absent (e.g. a
// conditionally hidden total) so it stays out of the document.
function renderTotalRow(
  field: FieldDefinition,
  value: unknown,
): React.ReactNode | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  const total = Number.isFinite(n) ? n : 0;
  return (
    <View key={field.id} style={styles.liTotalRow} wrap={false}>
      <Text style={styles.liGrandLabel}>{field.label || "Total"}</Text>
      <Text style={styles.liGrandValue}>{formatMoney(total)}</Text>
    </View>
  );
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
  // Only include sections/fields the submitter actually saw (same visibility
  // fixpoint as the form) and drop section headings with no value-bearing rows.
  const visibleIds = resolveVisibleFieldIds(definition.field_schema, data);

  type Group = { heading: string | null; fields: FieldDefinition[] };
  const groups: Group[] = [];
  let current: Group = { heading: null, fields: [] };
  for (const f of definition.field_schema) {
    if (f.type === "page_break") {
      continue;
    }
    if (!visibleIds.has(f.id)) {
      continue;
    }
    if (f.type === "section_break") {
      if (current.fields.length > 0) groups.push(current);
      current = { heading: f.label, fields: [] };
    } else {
      current.fields.push(f);
    }
  }
  if (current.fields.length > 0) groups.push(current);

  const groupsToRender = groups.filter((g) =>
    g.fields.some((f) => wouldRenderFieldInPdf(f, data[f.id])),
  );

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

        {groupsToRender.map((g, gi) => (
          <View key={gi} wrap={false}>
            {g.heading ? <Text style={styles.sectionHeading}>{g.heading}</Text> : null}
            <View style={styles.table}>
              {g.fields.map((f, fi) => {
                // Commerce fields render full-width as an invoice table / total
                // row rather than a label|value cell.
                if (f.type === "line_items") {
                  return renderLineItemsTable(f, data[f.id]);
                }
                if (f.type === "total") {
                  return renderTotalRow(f, data[f.id]);
                }
                const cell = renderValueCell(f, data[f.id]);
                if (cell === null) return null;
                return (
                  <View
                    key={f.id}
                    style={[styles.row, fi % 2 === 1 ? styles.rowZebra : {}]}
                  >
                    <Text style={styles.labelCell}>{f.label}</Text>
                    <View style={styles.valueCell}>{cell}</View>
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
