/**
 * Append submitter uploads to a generated form PDF (Gravity PDF merge_pdfs parity).
 *
 * Server-side only: file list is derived from the validated submission's
 * file_upload fields in field_schema order — never from client hints.
 */
import { PDFDocument } from "pdf-lib";
import type { FormDefinition, UploadedFile } from "@/lib/form-definitions";
import { resolveVisibleFieldIds } from "@/lib/form-definitions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const BUCKET = "form-uploads";
const MAX_MERGED_BYTES = 20 * 1024 * 1024;

/** Trusted object metadata from Supabase Storage (not client descriptor). */
type TrustedUploadMeta = {
  contentType: string;
  size: number;
};

function isTrustedPdf(meta: TrustedUploadMeta): boolean {
  return meta.contentType === "application/pdf";
}

function isTrustedMergeableImage(meta: TrustedUploadMeta): boolean {
  return meta.contentType === "image/png" || meta.contentType === "image/jpeg";
}

/** Whether this upload will be merged based on trusted storage metadata only. */
function isTrustedMergeCandidate(
  meta: TrustedUploadMeta,
  mergeImages: boolean,
): boolean {
  if (isTrustedPdf(meta)) return true;
  if (mergeImages && isTrustedMergeableImage(meta)) return true;
  return false;
}

/** Fetch real size + content-type from storage without downloading bytes. */
async function fetchUploadMetadata(
  path: string,
): Promise<TrustedUploadMeta | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(BUCKET).info(path);
  if (error || !data) {
    logger.warn("PDF merge: storage metadata lookup failed — skipping upload", {
      path,
      error: error?.message,
    });
    return null;
  }

  const contentType = (
    data.contentType ??
    data.metadata?.mimetype ??
    ""
  )
    .toLowerCase()
    .trim();
  const size =
    typeof data.size === "number" && data.size > 0
      ? data.size
      : typeof data.metadata?.size === "number" && data.metadata.size > 0
        ? data.metadata.size
        : 0;

  if (!contentType || size <= 0) {
    logger.warn("PDF merge: incomplete storage metadata — skipping upload", {
      path,
      contentType: contentType || "(missing)",
      size,
    });
    return null;
  }

  return { contentType, size };
}

/** Collect uploaded files from visible file_upload fields in schema order. */
export function collectSubmissionUploads(
  definition: FormDefinition,
  data: Record<string, unknown>,
): UploadedFile[] {
  const visibleIds = resolveVisibleFieldIds(definition.field_schema, data);
  const files: UploadedFile[] = [];
  for (const field of definition.field_schema) {
    if (field.type !== "file_upload" || !visibleIds.has(field.id)) continue;
    const val = data[field.id];
    if (!Array.isArray(val)) continue;
    for (const item of val) {
      if (
        item &&
        typeof item === "object" &&
        "path" in item &&
        typeof (item as UploadedFile).path === "string"
      ) {
        files.push(item as UploadedFile);
      }
    }
  }
  return files;
}

async function downloadUpload(path: string): Promise<Buffer | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    logger.warn("PDF merge: upload download failed", {
      path,
      error: error?.message,
    });
    return null;
  }
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

async function appendPdfPages(
  merged: PDFDocument,
  bytes: Buffer,
  path: string,
): Promise<number> {
  try {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = src.getPageIndices();
    const copied = await merged.copyPages(src, indices);
    for (const page of copied) {
      merged.addPage(page);
    }
    return bytes.length;
  } catch (err) {
    logger.warn("PDF merge: skipped corrupt or unreadable PDF", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

async function appendImagePage(
  merged: PDFDocument,
  bytes: Buffer,
  path: string,
  contentType: string,
): Promise<number> {
  try {
    const image =
      contentType === "image/png"
        ? await merged.embedPng(bytes)
        : await merged.embedJpg(bytes);
    const page = merged.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
    return bytes.length;
  } catch (err) {
    logger.warn("PDF merge: skipped unreadable image", {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * When mergeUploads is enabled, append uploaded PDFs (and optionally images)
 * after the @react-pdf base document. Falls back to basePdf on oversize total
 * or catastrophic merge failure; per-file errors are skipped.
 */
export async function mergeFormPdfWithUploads(
  basePdf: Buffer,
  definition: FormDefinition,
  data: Record<string, unknown>,
): Promise<Buffer> {
  const cfg = definition.pdf_config;
  if (!cfg?.mergeUploads) return basePdf;

  const uploads = collectSubmissionUploads(definition, data);
  if (uploads.length === 0) return basePdf;

  let projectedSize = basePdf.length;

  try {
    const merged = await PDFDocument.load(basePdf);
    let appendedBytes = 0;

    for (const file of uploads) {
      const trusted = await fetchUploadMetadata(file.path);
      if (!trusted || !isTrustedMergeCandidate(trusted, cfg.mergeImages)) {
        continue;
      }

      if (projectedSize + trusted.size > MAX_MERGED_BYTES) {
        logger.warn("PDF merge: skipping upload — would exceed combined size cap", {
          path: file.path,
          fileSize: trusted.size,
          projectedBytes: projectedSize,
          cap: MAX_MERGED_BYTES,
        });
        continue;
      }

      const bytes = await downloadUpload(file.path);
      if (!bytes) continue;

      let added = 0;
      if (isTrustedPdf(trusted)) {
        added = await appendPdfPages(merged, bytes, file.path);
      } else if (cfg.mergeImages && isTrustedMergeableImage(trusted)) {
        added = await appendImagePage(
          merged,
          bytes,
          file.path,
          trusted.contentType,
        );
      }

      if (added > 0) {
        if (projectedSize + added > MAX_MERGED_BYTES) {
          logger.warn("PDF merge: combined size cap exceeded — using base PDF only", {
            slug: definition.slug,
            projectedBytes: projectedSize + added,
            cap: MAX_MERGED_BYTES,
          });
          return basePdf;
        }
        projectedSize += added;
        appendedBytes += added;
      }
    }

    if (appendedBytes === 0) return basePdf;

    const out = await merged.save();
    return Buffer.from(out);
  } catch (err) {
    logger.error("PDF merge failed — using base PDF only", {
      slug: definition.slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return basePdf;
  }
}