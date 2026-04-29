/**
 * Mint a short-lived signed URL for one object in form-uploads.
 *
 * Admin-only. The bucket is private, so the submission detail page calls
 * this endpoint per-attachment to get a download link. URLs expire after
 * 5 minutes — long enough for the click, short enough that screen-share
 * leaks aren't catastrophic.
 *
 * Path validation mirrors uploadedFileSchema: must start with the
 * upload-sessions/ prefix that /api/upload writes to. Prevents an admin
 * with the link from coercing this endpoint into signing arbitrary keys.
 */
import { isAdminAuthenticated, unauthorizedResponse } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const PATH_RE = /^upload-sessions\/[a-zA-Z0-9-]+\/.+/;
const SIGNED_URL_TTL = 60 * 5; // 5 min

export async function GET(request: Request) {
  if (!isAdminAuthenticated(request)) return unauthorizedResponse();

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path");
  if (!path || !PATH_RE.test(path)) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from("form-uploads")
    .createSignedUrl(path, SIGNED_URL_TTL);

  if (error || !data?.signedUrl) {
    logger.error("Sign URL failed", { path, error: error?.message });
    return Response.json({ error: "Failed to sign URL" }, { status: 500 });
  }

  return Response.json({ url: data.signedUrl, expiresIn: SIGNED_URL_TTL });
}
