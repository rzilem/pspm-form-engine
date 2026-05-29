/**
 * POST /api/surveys/[id]/present — presenter control (optimistic-epoch CAS).
 * Auth: presenter token (header X-Survey-Presenter-Token or ?token=) OR management.
 * Body: { action, question_id?, expected_epoch }
 */
import { z } from "zod";
import { canPresentSurvey, surveyUnauthorized } from "@/lib/survey-auth";
import { presenterAction, type PresenterAction } from "@/lib/survey-store";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  action: z.enum(["open", "close", "reveal", "next", "prev", "reopen", "reset"]),
  question_id: z.string().uuid().optional(),
  expected_epoch: z.number().int().nonnegative(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const presenterToken =
    request.headers.get("x-survey-presenter-token") ?? url.searchParams.get("token");

  if (!(await canPresentSurvey(request, id, presenterToken))) {
    return surveyUnauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  try {
    const result = await presenterAction({
      surveyId: id,
      action: parsed.data.action as PresenterAction,
      questionId: parsed.data.question_id,
      expectedEpoch: parsed.data.expected_epoch,
    });
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    logger.error("present route failed", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Presenter action failed" }, { status: 500 });
  }
}
