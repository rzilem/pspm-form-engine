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

function isPdfFile(file: UploadedFile): boolean {
  const mime = file.mimeType.toLowerCase();
  if (mime === "application/pdf") return true;
  const lower = file.filename.toLowerCase();
  return lower.endsWith(".pdf");
}

function isMergeableImage(file: UploadedFile): boolean {
  const mime = file.mimeType.toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg") return true;
  const lower = file.filename.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg")
  );
}

/** Whether this upload will be merged (metadata-only — no download). */
function isMergeCandidate(file: UploadedFile, mergeImages: boolean): boolean {
  if (isPdfFile(file)) return true;
  if (mergeImages && isMergeableImage(file)) return true;
  return false;
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
  file: UploadedFile,
): Promise<number> {
  try {
    const mime = file.mimeType.toLowerCase();
    const lower = file.filename.toLowerCase();
    const image =
      mime === "image/png" || lower.endsWith(".png")
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
      path: file.path,
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
      if (!isMergeCandidate(file, cfg.mergeImages)) continue;

      if (projectedSize + file.size > MAX_MERGED_BYTES) {
        logger.warn("PDF merge: skipping upload — would exceed combined size cap", {
          path: file.path,
          fileSize: file.size,
          projectedBytes: projectedSize,
          cap: MAX_MERGED_BYTES,
        });
        continue;
      }

      const bytes = await downloadUpload(file.path);
      if (!bytes) continue;

      let added = 0;
      if (isPdfFile(file)) {
        added = await appendPdfPages(merged, bytes, file.path);
      } else if (cfg.mergeImages && isMergeableImage(file)) {
        added = await appendImagePage(merged, bytes, file);
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