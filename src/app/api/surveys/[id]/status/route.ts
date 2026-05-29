/**
 * POST /api/surveys/[id]/status — open (live) / close / archive the whole survey.
 * Body: { status: "live"|"closed"|"archived"|"draft" }
 *
 * Auth:
 *   - draft/live/closed transitions on a non-archived survey: presenter token OR management.
 *   - archiving, or ANY change to an already-archived survey (unarchive): management only.
 *     A presenter link must not be able to revive an archived (cleaned-up/private)
 *     poll and re-expose its aggregates.
 */
import { z } from "zod";
import { canPresentSurvey, canManageSurveys, surveyUnauthorized } from "@/lib/survey-auth";
import { getSurveyById, setSurveyStatus } from "@/lib/survey-store";
import { logger } from "@/lib/logger";

const bodySchema = z.object({ status: z.enum(["draft", "live", "closed", "archived"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const presenterToken = request.headers.get("x-survey-presenter-token") ?? url.searchParams.get("token");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const survey = await getSurveyById(id);
  if (!survey) return Response.json({ error: "Survey not found" }, { status: 404 });

  // Archive/unarchive is a privileged, management-only transition.
  const touchesArchive = parsed.data.status === "archived" || survey.status === "archived";
  const authed = touchesArchive
    ? canManageSurveys(request)
    : await canPresentSurvey(request, id, presenterToken);
  if (!authed) return surveyUnauthorized();

  const updated = await setSurveyStatus(id, parsed.data.status);
  if (!updated) {
    logger.error("status route: update failed", { surveyId: id });
    return Response.json({ error: "Update failed" }, { status: 500 });
  }
  return Response.json({ ok: true, status: updated.status, state_epoch: updated.state_epoch });
}
