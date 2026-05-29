/**
 * GET /api/surveys/[id]/results — public, visibility-gated aggregate for every
 * question (the RPC returns {hidden:true} per-question when results must stay
 * private). Safe to expose: never returns row ids, tokens, IPs, or raw text.
 */
import { getSurveyById, getQuestions, getQuestionAggregate, toPublicQuestion } from "@/lib/survey-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const survey = await getSurveyById(id);
  if (!survey || survey.status === "archived") {
    return Response.json({ error: "Survey not found" }, { status: 404 });
  }

  const questions = await getQuestions(id);
  const results = await Promise.all(
    questions.map(async (q) => ({
      question: toPublicQuestion(q),
      results: await getQuestionAggregate(q.id),
    })),
  );

  return Response.json({
    survey_id: survey.id,
    title: survey.title,
    status: survey.status,
    results_visibility: survey.results_visibility,
    questions: results,
  });
}
