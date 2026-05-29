/**
 * POST /api/surveys — create a survey on the fly (Claude session / skill / admin).
 * Auth: SURVEY_API_KEY bearer OR admin password.
 *
 * GET /api/surveys — list surveys (management only).
 */
import { z } from "zod";
import { canManageSurveys, surveyUnauthorized } from "@/lib/survey-auth";
import { createSurvey, buildSurveyUrls } from "@/lib/survey-store";
import { SURVEY_QUESTION_TYPES, RESULTS_VISIBILITY } from "@/lib/surveys";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const createQuestionSchema = z.object({
  type: z.enum(SURVEY_QUESTION_TYPES),
  prompt: z.string().min(1).max(2000),
  // Choice options may be plain strings or {id,label}; merged into config below.
  options: z.array(z.union([z.string(), z.object({ id: z.string().optional(), value: z.string().optional(), label: z.string() })])).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  results_visibility: z.enum(RESULTS_VISIBILITY).optional(),
});

const createSurveySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  community: z.string().max(200).optional(),
  slug: z.string().max(80).optional(),
  visibility: z.enum(RESULTS_VISIBILITY).optional(),
  meeting_label: z.string().max(200).optional(),
  created_by: z.string().max(200).optional(),
  questions: z.array(createQuestionSchema).min(1).max(50),
});

export async function POST(request: Request) {
  if (!canManageSurveys(request)) return surveyUnauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSurveySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid survey payload", details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  const input = parsed.data;
  try {
    const result = await createSurvey({
      title: input.title,
      description: input.description,
      community: input.community,
      slug: input.slug,
      visibility: input.visibility,
      meeting_label: input.meeting_label,
      created_by: input.created_by,
      questions: input.questions.map((q) => ({
        type: q.type,
        prompt: q.prompt,
        results_visibility: q.results_visibility,
        config: { ...(q.config ?? {}), ...(q.options ? { options: q.options } : {}) },
      })),
    });

    const urls = buildSurveyUrls(result.survey, result.presenterToken);

    return Response.json(
      {
        survey_id: result.survey.id,
        slug: result.survey.slug,
        room_code: result.survey.room_code,
        status: result.survey.status,
        results_visibility: result.survey.results_visibility,
        join_url: urls.joinUrl,
        qr_image_url: urls.qrImageUrl,
        presenter_url: urls.presenterUrl,
        results_url: urls.resultsUrl,
        presenter_token: result.presenterToken,
        questions: result.questions.map((q) => ({
          id: q.id,
          position: q.position,
          type: q.type,
          prompt: q.prompt,
          state: q.state,
        })),
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error("createSurvey route failed", { error: message });
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function GET(request: Request) {
  if (!canManageSurveys(request)) return surveyUnauthorized();

  const url = new URL(request.url);
  const community = url.searchParams.get("community");
  const meetingId = url.searchParams.get("meeting_id");
  const includeArchived = url.searchParams.get("archived") === "1";

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("surveys")
    .select("id, slug, title, community, status, results_visibility, room_code, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (community) query = query.eq("community", community);
  if (meetingId) query = query.eq("meeting_id", meetingId);
  if (!includeArchived) query = query.neq("status", "archived");

  const { data, error } = await query;
  if (error) {
    logger.error("list surveys failed", { error: error.message });
    return Response.json({ error: "Failed to list surveys" }, { status: 500 });
  }
  return Response.json({ surveys: data ?? [] });
}
