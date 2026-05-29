/**
 * Survey auth — three tiers:
 *   1. SURVEY_API_KEY bearer (machine: Claude session / skill) — create/manage any survey.
 *   2. presenter token (per-survey, hashed in survey_tokens) — advance/open/close/reveal one survey.
 *   3. public join code/token (short, in-URL) — submit answers; read results iff visible.
 *
 * Management routes accept SURVEY_API_KEY OR the existing admin password, so a
 * human admin can drive everything too. Mirrors admin-auth.ts (constant-time
 * compare, no length leak).
 */
import { timingSafeEqual } from "node:crypto";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase";
import { hashSurveyToken } from "@/lib/surveys";
import { logger } from "@/lib/logger";

const SURVEY_API_KEY = process.env.SURVEY_API_KEY ?? "";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA); // burn constant time regardless of length
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** True for a valid SURVEY_API_KEY bearer. */
export function isSurveyApiAuthenticated(request: Request): boolean {
  if (!SURVEY_API_KEY) return false;
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const [scheme, value] = authHeader.split(" ");
    if (scheme === "Bearer" && safeCompare(value ?? "", SURVEY_API_KEY)) return true;
  }
  const keyHeader = request.headers.get("x-survey-api-key");
  if (keyHeader !== null && safeCompare(keyHeader, SURVEY_API_KEY)) return true;
  return false;
}

/** Management gate: machine key OR human admin password. */
export function canManageSurveys(request: Request): boolean {
  return isSurveyApiAuthenticated(request) || isAdminAuthenticated(request);
}

export function surveyUnauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Verify a presenter token against survey_tokens (hash lookup, not revoked, not
 * expired) and confirm it belongs to `surveyId`. Returns true when the bearer
 * may drive the presenter controls for this specific survey, OR when the caller
 * already holds a management credential.
 */
export async function canPresentSurvey(
  request: Request,
  surveyId: string,
  presenterToken: string | null | undefined,
): Promise<boolean> {
  if (canManageSurveys(request)) return true;
  if (!presenterToken) return false;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_tokens")
    .select("id, survey_id, kind, expires_at, revoked_at")
    .eq("token_hash", hashSurveyToken(presenterToken))
    .eq("kind", "presenter")
    .maybeSingle();

  if (error) {
    logger.error("canPresentSurvey lookup failed", { error: error.message });
    return false;
  }
  if (!data) return false;
  if (data.survey_id !== surveyId) return false;
  if (data.revoked_at) return false;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return false;
  return true;
}
