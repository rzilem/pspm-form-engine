import { notFound } from "next/navigation";
import { SurveyPresenter } from "@/components/surveys/SurveyPresenter";
import { getSurveyById, buildSurveyUrls, verifyPresenterToken } from "@/lib/survey-store";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Presenter | PS Property Management",
  robots: { index: false, follow: false },
};

export default async function PresenterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { id } = await params;
  const { token } = await searchParams;

  const survey = await getSurveyById(id);
  if (!survey || survey.status === "archived") notFound();

  const canControl = await verifyPresenterToken(id, token ?? null);
  const urls = buildSurveyUrls(survey);

  return (
    <SurveyPresenter
      surveyId={survey.id}
      presenterToken={token ?? null}
      roomCode={survey.room_code ?? ""}
      joinUrl={urls.joinUrl}
      qrUrl={urls.qrImageUrl}
      canControl={canControl}
    />
  );
}
