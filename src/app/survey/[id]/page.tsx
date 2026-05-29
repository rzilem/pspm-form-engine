import { SurveyParticipant } from "@/components/surveys/SurveyParticipant";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Live Poll | PS Property Management",
  robots: { index: false, follow: false },
};

export default async function SurveyParticipantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SurveyParticipant surveyId={id} />;
}
