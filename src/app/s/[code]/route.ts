/**
 * GET /s/[code] — short room-code resolver. Scanned from the QR or typed in.
 * Redirects to the participant view. When survey.psprop.net is wired, a
 * /<code> -> /s/<code> rewrite forwards here.
 */
import { getSurveyByCode } from "@/lib/survey-store";
import { isValidRoomCode } from "@/lib/surveys";

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  if (!isValidRoomCode(code)) {
    return Response.redirect(new URL(`/join?error=invalid`, request.url), 307);
  }
  const survey = await getSurveyByCode(code);
  if (!survey) {
    return Response.redirect(new URL(`/join?error=notfound&code=${encodeURIComponent(code.toUpperCase())}`, request.url), 307);
  }
  return Response.redirect(new URL(`/survey/${survey.id}`, request.url), 307);
}
