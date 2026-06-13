/**
 * Save & Continue — partial form progress storage and resume helpers.
 * All reads/writes use the service-role client; anon/authenticated are denied
 * by RLS on form_partials.
 */
import crypto from "node:crypto";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import {
  uploadedFileSchema,
  resolveVisibleFieldIds,
  type FieldDefinition,
  type FormDefinition,
} from "@/lib/form-definitions";

/** Max serialized partial payload (bytes). Rejects abuse before DB write. */
export const PARTIAL_DATA_MAX_BYTES = 256 * 1024;

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
  "https://pspm-form-engine-138752496729.us-central1.run.app";

export interface FormPartialRow {
  id: string;
  form_id: string;
  slug: string;
  resume_token: string;
  data: Record<string, unknown>;
  current_page: number | null;
  expires_at: string;
}

/** Cryptographically random, URL-safe resume token (32+ bytes entropy). */
export function generateResumeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Absolute base URL for resume links (request origin when available). */
export function getResumeBaseUrl(request?: Request): string {
  if (request) {
    try {
      const origin = new URL(request.url).origin;
      if (origin && origin !== "null") return origin.replace(/\/+$/, "");
    } catch {
      // fall through
    }
  }
  return APP_URL;
}

export function buildResumeUrl(
  slug: string,
  token: string,
  request?: Request,
): string {
  const base = getResumeBaseUrl(request);
  return `${base}/forms/${slug}?resume=${encodeURIComponent(token)}`;
}

/**
 * Strip file_upload values to descriptors only (path/filename/size/mimeType).
 * Drops invalid entries rather than failing the whole save.
 */
export function sanitizePartialData(
  data: Record<string, unknown>,
  fields: FieldDefinition[],
): Record<string, unknown> {
  const fileFieldIds = new Set(
    fields.filter((f) => f.type === "file_upload").map((f) => f.id),
  );
  const out: Record<string, unknown> = { ...data };

  for (const fieldId of fileFieldIds) {
    const raw = out[fieldId];
    if (!Array.isArray(raw)) continue;
    const descriptors = raw
      .map((entry) => {
        const parsed = uploadedFileSchema.safeParse(entry);
        return parsed.success ? parsed.data : null;
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    out[fieldId] = descriptors;
  }

  return out;
}

export function partialDataByteSize(data: Record<string, unknown>): number {
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

/** Server-side fetch by slug + token; returns null if missing or expired. */
export async function loadFormPartial(
  slug: string,
  token: string,
): Promise<FormPartialRow | null> {
  const normalized = slug.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  const trimmedToken = token.trim();
  if (!trimmedToken || !/^[a-z0-9-]+$/.test(normalized)) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("form_partials")
    .select("id, form_id, slug, resume_token, data, current_page, expires_at")
    .eq("slug", normalized)
    .eq("resume_token", trimmedToken)
    .maybeSingle();

  if (error) {
    logger.error("loadFormPartial query failed", {
      slug: normalized,
      error: error.message,
    });
    return null;
  }
  if (!data) return null;

  const expiresAt = new Date(data.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) {
    return null;
  }

  const rowData =
    data.data && typeof data.data === "object" && !Array.isArray(data.data)
      ? (data.data as Record<string, unknown>)
      : {};

  return {
    id: data.id,
    form_id: data.form_id,
    slug: data.slug,
    resume_token: data.resume_token,
    data: rowData,
    current_page: data.current_page,
    expires_at: data.expires_at,
  };
}

/** Best-effort delete after successful final submit. */
export async function deleteFormPartialByToken(
  token: string | undefined | null,
): Promise<void> {
  const trimmed = token?.trim();
  if (!trimmed) return;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("form_partials")
      .delete()
      .eq("resume_token", trimmed);
    if (error) {
      logger.warn("deleteFormPartialByToken failed", {
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn("deleteFormPartialByToken threw", {
      error: String(err),
    });
  }
}

/** First visible email-type field value in partial data (for optional link email). */
export function findSubmitterEmail(
  definition: FormDefinition,
  data: Record<string, unknown>,
): string | null {
  const visibleIds = resolveVisibleFieldIds(definition.field_schema, data);
  for (const f of definition.field_schema) {
    if (f.type !== "email") continue;
    if (!visibleIds.has(f.id)) continue;
    const v = data[f.id];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    const parsed = z.string().email().safeParse(trimmed);
    if (parsed.success) return trimmed;
  }
  return null;
}