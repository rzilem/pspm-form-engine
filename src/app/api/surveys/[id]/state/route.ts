/**
 * GET /api/surveys/[id]/state — participant + presenter poll endpoint (public).
 * Returns the sync token (state_epoch), the active question in public-safe shape,
 * whether voting is open, and the visibility-gated aggregate (the RPC returns
 * {hidden:true} when results must stay private).
 */
import { getSurveyById, getQuestions, toPublicQuestion, getQuestionAggregate } from "@/lib/survey-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const survey = await getSurveyById(id);
  if (!survey || survey.status === "archived") {
    return Response.json({ error: "Survey not found" }, { status: 404 });
  }

  const questions = await getQuestions(id);
  const active = questions.find((q) => q.id === survey.active_question_id) ?? null;

  let results: unknown = null;
  if (active) {
    results = await getQuestionAggregate(active.id);
  }

  return Response.json(
    {
      survey_id: survey.id,
      title: survey.title,
      status: survey.status, // draft | live | closed | archived
      state_epoch: survey.state_epoch,
      results_visibility: survey.results_visibility,
      question_count: questions.length,
      active_question: active
        ? {
            ...toPublicQuestion(active),
            voting_open: active.state === "open" && survey.status === "live",
          }
        : null,
      results,
    },
    {
      headers: {
        // Phones poll every ~2s; let intermediaries cache for 1s max but always
        // revalidate so a presenter advance is picked up promptly.
        "Cache-Control": "no-cache, max-age=1",
      },
    },
  );
}
