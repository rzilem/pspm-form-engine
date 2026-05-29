import type { SurveyQuestionType } from "@/lib/surveys";

export interface PublicQuestionView {
  id: string;
  position: number;
  type: SurveyQuestionType;
  prompt: string;
  state: string;
  options: { id: string; label: string }[];
  config: Record<string, unknown>;
  voting_open?: boolean;
}

/** Shape returned by survey_question_aggregate (visibility-gated). */
export interface Aggregate {
  hidden?: boolean;
  reason?: string;
  type?: SurveyQuestionType;
  total?: number;
  respondents?: number;
  mean?: number;
  buckets?: Record<string, number>;
  distribution?: Record<string, number>;
  terms?: Record<string, number>;
  error?: string;
}

export interface SurveyStateResponse {
  survey_id: string;
  title: string;
  status: "draft" | "live" | "closed" | "archived";
  state_epoch: number;
  results_visibility: "live_public" | "private" | "after_close";
  response_mode: "anonymous" | "one_per_device";
  question_count: number;
  active_question: PublicQuestionView | null;
  results: Aggregate | null;
}
