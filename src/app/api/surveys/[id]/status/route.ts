/**
 * POST /api/surveys/[id]/status — open (live) / close / archive the whole survey.
 * Auth: presenter token OR management. Body: { status: "live"|"closed"|"archived"|"draft" }
 */
import { z } from "zod";
import { canPresentSurvey, surveyUnauthorized } from "@/lib/survey-auth";
import { setSurveyStatus } from "@/lib/survey-store";
import { logger } from "@/lib/logger";

const bodySchema = z.object({ status: z.enum(["draft", "live", "closed", "archived"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const presenterToken = request.headers.get("x-survey-presenter-token") ?? url.searchParams.get("token");

  if (!(await canPresentSurvey(request, id, presenterToken))) return surveyUnauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid payload" }, { status: 400 });

  const survey = await setSurveyStatus(id, parsed.data.status);
  if (!survey) {
    logger.error("status route: update failed", { surveyId: id });
    return Response.json({ error: "Update failed" }, { status: 500 });
  }
  return Response.json({ ok: true, status: survey.status, state_epoch: survey.state_epoch });
}
