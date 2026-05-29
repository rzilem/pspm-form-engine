/**
 * GET /api/surveys/[id]/qr — server-rendered QR PNG of the join URL.
 * Rendered locally (qrcode lib) so the room URL is never sent to a third party.
 */
import QRCode from "qrcode";
import { getSurveyById, buildSurveyUrls } from "@/lib/survey-store";
import { logger } from "@/lib/logger";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const survey = await getSurveyById(id);
  if (!survey || !survey.room_code || survey.status === "archived") {
    return Response.json({ error: "Survey not found" }, { status: 404 });
  }

  const { joinUrl } = buildSurveyUrls(survey);

  try {
    const png = await QRCode.toBuffer(joinUrl, {
      type: "png",
      width: 600,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#1b2a4e", light: "#ffffff" },
    });
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    logger.error("qr generation failed", { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "QR generation failed" }, { status: 500 });
  }
}
