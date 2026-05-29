/**
 * POST /api/surveys/[id]/answer — public answer submission.
 * Honeypot + open-state gate (in recordAnswer). One-per-device via the
 * client-minted participant_token (UPSERT = change-vote).
 * Body: { question_id, answer, participant_token?, hp? }
 */
import { z } from "zod";
import { recordAnswer } from "@/lib/survey-store";
import { logger } from "@/lib/logger";

const bodySchema = z.object({
  question_id: z.string().uuid(),
  answer: z.record(z.string(), z.unknown()),
  participant_token: z.string().min(8).max(128).optional(),
  hp: z.string().optional(), // honeypot
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  // Honeypot — quiet generic rejection so scrapers don't learn the field name.
  if (parsed.data.hp && parsed.data.hp.trim() !== "") {
    logger.warn("survey answer honeypot triggered", { surveyId: id });
    return Response.json({ error: "Submission rejected." }, { status: 400 });
  }

  // X-Forwarded-For is a comma-separated chain (client, proxy1, …); take the
  // first hop only — the full string is not a valid INET and would 500 the write.
  const xff = request.headers.get("x-forwarded-for");
  const ip =
    (xff ? xff.split(",")[0]?.trim() : null) ||
    request.headers.get("cf-connecting-ip") ||
    null;
  const userAgent = request.headers.get("user-agent") ?? null;

  try {
    const result = await recordAnswer({
      surveyId: id,
      questionId: parsed.data.question_id,
      rawAnswer: parsed.data.answer,
      participantToken: parsed.data.participant_token ?? null,
      ip,
      userAgent,
    });
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    logger.error("answer route failed", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "Failed to record answer" }, { status: 500 });
  }
}
