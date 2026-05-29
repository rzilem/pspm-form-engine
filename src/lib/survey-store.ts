/**
 * Server-side survey data operations. All use the service-role client; the
 * survey tables have no anon access (see the migration). Routes stay thin and
 * call into here — same split as workflow.ts.
 *
 * Concurrency: every presenter action is an optimistic CAS on surveys.state_epoch.
 * Only one concurrent action with a given expected_epoch wins the bump; the loser
 * gets a conflict and re-syncs. Question-state mutations happen only AFTER the CAS
 * is won, so two presenters can never both transition the same survey. The
 * uniq_sq_one_open partial index is the DB-level backstop.
 */
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import {
  buildAnswerSchema,
  generateRoomCode,
  hashSurveyToken,
  newSurveyToken,
  normalizeSlug,
  questionConfigSchema,
  resolveOptions,
  type ResultsVisibility,
  type SurveyQuestionType,
} from "@/lib/surveys";
import type { Survey, SurveyQuestion } from "@/lib/database.types";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
  "https://pspm-form-engine-138752496729.us-central1.run.app";

// Where participants join. Defaults to the app's /s short-link path; set to
// https://survey.psprop.net once the subdomain is wired (then a /<code> rewrite
// forwards to /s/<code>).
const JOIN_BASE =
  process.env.NEXT_PUBLIC_SURVEY_JOIN_BASE?.replace(/\/+$/, "") || `${APP_URL}/s`;

const PRESENTER_TOKEN_TTL_HOURS = Number(process.env.SURVEY_TOKEN_TTL_HOURS || 24);

export interface SurveyUrls {
  joinUrl: string;
  presenterUrl: string;
  resultsUrl: string;
  qrImageUrl: string;
}

export function buildSurveyUrls(survey: { id: string; room_code: string | null }, presenterToken?: string): SurveyUrls {
  const code = survey.room_code ?? "";
  return {
    joinUrl: `${JOIN_BASE}/${code}`,
    presenterUrl: presenterToken
      ? `${APP_URL}/surveys/${survey.id}/present?token=${presenterToken}`
      : `${APP_URL}/surveys/${survey.id}/present`,
    resultsUrl: `${APP_URL}/api/surveys/${survey.id}/results`,
    qrImageUrl: `${APP_URL}/api/surveys/${survey.id}/qr`,
  };
}

// ── Create ───────────────────────────────────────────────────────────────────
export interface CreateQuestionInput {
  type: SurveyQuestionType;
  prompt: string;
  config?: unknown;
  results_visibility?: ResultsVisibility;
}

export interface CreateSurveyInput {
  title: string;
  description?: string;
  community?: string;
  slug?: string;
  visibility?: ResultsVisibility;
  meeting_label?: string;
  questions: CreateQuestionInput[];
  created_by?: string;
}

export interface CreateSurveyResult {
  survey: Survey;
  questions: SurveyQuestion[];
  presenterToken: string;
  joinToken: string;
}

/**
 * Normalize a raw question payload from the API into a stored
 * (type, prompt, config) triple. Builds choice option ids from labels when the
 * caller passed plain strings (the common Claude-session shape).
 */
function normalizeQuestionConfig(q: CreateQuestionInput): { config: Record<string, unknown>; error?: string } {
  // Allow callers to pass `options: ["Yes","No"]` (strings) — convert to {id,label}.
  const rawConfig: Record<string, unknown> = { ...(typeof q.config === "object" && q.config ? (q.config as Record<string, unknown>) : {}) };
  rawConfig.type = q.type;

  if ((q.type === "single_choice" || q.type === "multi_choice" || q.type === "yes_no") && Array.isArray(rawConfig.options)) {
    const seen = new Set<string>();
    rawConfig.options = (rawConfig.options as unknown[]).map((opt, i) => {
      let id: string;
      let label: string;
      if (typeof opt === "string") {
        id = slugifyOption(opt, i);
        label = opt.slice(0, 200);
      } else if (opt && typeof opt === "object") {
        const o = opt as Record<string, unknown>;
        label = (typeof o.label === "string" ? o.label : String(o.value ?? "")).slice(0, 200);
        id = (typeof o.id === "string" && o.id ? o.id : slugifyOption(label, i)).slice(0, 64);
      } else {
        id = `opt_${i}`;
        label = `Option ${i + 1}`;
      }
      // Distinct labels can slugify to the same id ("Yes!" / "Yes") — make ids
      // unique so the UI keys + answer buckets stay distinct. Trim the BASE (not
      // the whole candidate) before appending the suffix, so a 64-char id can't
      // truncate back to itself and spin forever.
      if (seen.has(id)) {
        let suffix = 2;
        const candidateFor = (n: number) => {
          const tag = `_${n}`;
          return `${id.slice(0, 64 - tag.length)}${tag}`;
        };
        let candidate = candidateFor(suffix);
        while (seen.has(candidate)) {
          suffix += 1;
          candidate = candidateFor(suffix);
        }
        id = candidate;
      }
      seen.add(id);
      return { id, label };
    });
  }

  const parsed = questionConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    return { config: {}, error: parsed.error.issues.map((iss) => `${iss.path.join(".")}: ${iss.message}`).join("; ") };
  }
  // Inverted numeric ranges parse fine individually but produce an unusable
  // question (empty UI range, min(hi).max(lo) validator that rejects everything).
  if (parsed.data.type === "rating_scale" && parsed.data.min > parsed.data.max) {
    return { config: {}, error: "min must be less than or equal to max" };
  }
  return { config: parsed.data as unknown as Record<string, unknown> };
}

function slugifyOption(label: string, index: number): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  return base ? `opt_${base}` : `opt_${index}`;
}

/** Generate a room code unique among non-archived surveys (retry on collision). */
async function reserveRoomCode(): Promise<string> {
  const supabase = getSupabaseAdmin();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateRoomCode();
    const { data, error } = await supabase
      .from("surveys")
      .select("id")
      .eq("room_code", code)
      .neq("status", "archived")
      .maybeSingle();
    if (error) {
      logger.error("reserveRoomCode lookup failed", { error: error.message });
      throw new Error("Failed to reserve room code");
    }
    if (!data) return code;
  }
  throw new Error("Could not allocate a unique room code");
}

export async function createSurvey(input: CreateSurveyInput): Promise<CreateSurveyResult> {
  const supabase = getSupabaseAdmin();

  if (!input.questions || input.questions.length === 0) {
    throw new Error("A survey needs at least one question");
  }
  if (input.questions.length > 50) {
    throw new Error("Too many questions (max 50)");
  }

  // Validate every question config up front so we don't create a half-survey.
  const normalized = input.questions.map((q) => {
    const { config, error } = normalizeQuestionConfig(q);
    if (error) throw new Error(`Question "${q.prompt.slice(0, 40)}": ${error}`);
    return { ...q, normalizedConfig: config };
  });

  const slug = input.slug ? normalizeSlug(input.slug) : null;
  const roomCode = await reserveRoomCode();

  let meetingId: string | null = null;
  if (input.meeting_label) {
    const { data: meeting, error: meetingErr } = await supabase
      .from("survey_meetings")
      .insert({ title: input.meeting_label.slice(0, 200), community: input.community ?? null, created_by: input.created_by ?? null })
      .select("id")
      .single();
    if (meetingErr) {
      logger.error("createSurvey: meeting insert failed", { error: meetingErr.message });
    } else {
      meetingId = meeting.id;
    }
  }

  const { data: survey, error: surveyErr } = await supabase
    .from("surveys")
    .insert({
      slug,
      title: input.title.slice(0, 200),
      description: input.description ?? null,
      community: input.community ?? null,
      meeting_id: meetingId,
      status: "draft",
      results_visibility: input.visibility ?? "live_public",
      room_code: roomCode,
      created_by: input.created_by ?? null,
    })
    .select("*")
    .single();

  if (surveyErr || !survey) {
    logger.error("createSurvey: survey insert failed", { error: surveyErr?.message });
    throw new Error("Failed to create survey");
  }

  const questionRows = normalized.map((q, i) => ({
    survey_id: survey.id,
    position: i,
    type: q.type,
    prompt: q.prompt.slice(0, 2000),
    config: q.normalizedConfig,
    results_visibility: q.results_visibility ?? null,
    state: "pending" as const,
  }));

  const { data: questions, error: qErr } = await supabase
    .from("survey_questions")
    .insert(questionRows)
    .select("*");

  if (qErr || !questions) {
    logger.error("createSurvey: question insert failed", { error: qErr?.message, surveyId: survey.id });
    // Best-effort cleanup so we don't leave an empty survey.
    await supabase.from("surveys").delete().eq("id", survey.id);
    throw new Error("Failed to create survey questions");
  }

  // Issue presenter + join tokens (plaintext returned once).
  const presenter = newSurveyToken();
  const join = newSurveyToken();
  const expiresAt = new Date(Date.now() + PRESENTER_TOKEN_TTL_HOURS * 3600 * 1000).toISOString();
  const { error: tokErr } = await supabase.from("survey_tokens").insert([
    { survey_id: survey.id, kind: "presenter", token_hash: presenter.hash, expires_at: expiresAt },
    { survey_id: survey.id, kind: "join", token_hash: join.hash, expires_at: expiresAt },
  ]);
  if (tokErr) {
    logger.error("createSurvey: token insert failed", { error: tokErr.message, surveyId: survey.id });
    throw new Error("Failed to issue survey tokens");
  }

  return {
    survey,
    questions: questions.sort((a, b) => a.position - b.position),
    presenterToken: presenter.token,
    joinToken: join.token,
  };
}

// ── Resolve by room code ──────────────────────────────────────────────────────
export async function getSurveyByCode(code: string): Promise<Survey | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("surveys")
    .select("*")
    .eq("room_code", code.toUpperCase())
    .neq("status", "archived")
    .maybeSingle();
  if (error) {
    logger.error("getSurveyByCode failed", { error: error.message });
    return null;
  }
  return data;
}

export async function getSurveyById(id: string): Promise<Survey | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("surveys").select("*").eq("id", id).maybeSingle();
  if (error) {
    logger.error("getSurveyById failed", { error: error.message });
    return null;
  }
  return data;
}

export async function getQuestions(surveyId: string): Promise<SurveyQuestion[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_questions")
    .select("*")
    .eq("survey_id", surveyId)
    .order("position", { ascending: true });
  if (error) {
    logger.error("getQuestions failed", { error: error.message });
    return [];
  }
  return data ?? [];
}

// ── Public-safe question shape (no internal columns) ──────────────────────────
export interface PublicQuestion {
  id: string;
  position: number;
  type: SurveyQuestionType;
  prompt: string;
  state: string;
  options: { id: string; label: string }[];
  config: Record<string, unknown>;
}

export function toPublicQuestion(q: SurveyQuestion): PublicQuestion {
  // Strip moderation/internal hints from config but keep render-relevant fields.
  const cfg = (q.config ?? {}) as Record<string, unknown>;
  const renderConfig: Record<string, unknown> = {};
  for (const k of ["min", "max", "min_label", "max_label", "max_words", "max_word_length", "max_selections", "max_length"]) {
    if (cfg[k] !== undefined) renderConfig[k] = cfg[k];
  }
  return {
    id: q.id,
    position: q.position,
    type: q.type as SurveyQuestionType,
    prompt: q.prompt,
    state: q.state,
    options: resolveOptions(q.type as SurveyQuestionType, q.config),
    config: renderConfig,
  };
}

// ── Aggregate (visibility-gated RPC) ──────────────────────────────────────────
export async function getQuestionAggregate(questionId: string): Promise<unknown> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("survey_question_aggregate", { p_question_id: questionId });
  if (error) {
    logger.error("survey_question_aggregate rpc failed", { error: error.message, questionId });
    return { error: "aggregate_failed" };
  }
  return data;
}

// ── Record an answer ──────────────────────────────────────────────────────────
export interface RecordAnswerResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export async function recordAnswer(opts: {
  surveyId: string;
  questionId: string;
  rawAnswer: unknown;
  participantToken: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<RecordAnswerResult> {
  const supabase = getSupabaseAdmin();

  // Friendly fast-path checks. The AUTHORITATIVE gate is in the RPC (survey-row
  // atomic flags); these just return nicer errors without a write attempt.
  const survey = await getSurveyById(opts.surveyId);
  if (!survey) return { ok: false, status: 404, body: { error: "Survey not found" } };
  if (survey.status !== "live" || !survey.active_question_open || survey.active_question_id !== opts.questionId) {
    return { ok: false, status: 409, body: { error: "Voting isn't open for this question", state_epoch: survey.state_epoch } };
  }
  // one_per_device dedup only works with a token (the partial unique index keys
  // on it). Without one, every POST would insert a fresh row — so require it
  // unless the survey is explicitly anonymous.
  if (survey.response_mode === "one_per_device" && !opts.participantToken) {
    return { ok: false, status: 400, body: { error: "Missing participant token" } };
  }

  // Load the question only for its config (to build the answer validator).
  const { data: question, error: qErr } = await supabase
    .from("survey_questions")
    .select("*")
    .eq("id", opts.questionId)
    .eq("survey_id", opts.surveyId)
    .maybeSingle();
  if (qErr) {
    logger.error("recordAnswer: question lookup failed", { error: qErr.message });
    return { ok: false, status: 500, body: { error: "Lookup failed" } };
  }
  if (!question) return { ok: false, status: 404, body: { error: "Question not found" } };

  // Validate the answer against the question's derived schema.
  const schema = buildAnswerSchema(question.type as SurveyQuestionType, question.config);
  const parsed = schema.safeParse(opts.rawAnswer);
  if (!parsed.success) {
    return {
      ok: false,
      status: 422,
      body: { error: "Invalid answer", details: parsed.error.issues.map((iss) => iss.message) },
    };
  }

  // Atomic gated write: the RPC re-checks open+live in the SAME statement as the
  // insert (so a presenter closing mid-flight can't accept a late vote) and is
  // the only place ON CONFLICT can name the partial-index predicate for the
  // one-per-device change-vote upsert. Returns 'closed' when the guard fails.
  const { data: rpcResult, error: rpcErr } = await supabase.rpc("submit_survey_response", {
    p_survey_id: opts.surveyId,
    p_question_id: opts.questionId,
    p_answer: parsed.data as Record<string, unknown>,
    p_participant_token: opts.participantToken,
    p_epoch: survey.state_epoch,
    p_ip: opts.ip,
    p_user_agent: opts.userAgent,
  });

  if (rpcErr) {
    logger.error("submit_survey_response rpc failed", { error: rpcErr.message });
    return { ok: false, status: 500, body: { error: "Failed to record answer" } };
  }
  if (rpcResult === "closed") {
    return { ok: false, status: 409, body: { error: "Voting just closed for this question", state_epoch: survey.state_epoch } };
  }

  return { ok: true, status: 200, body: { ok: true, state_epoch: survey.state_epoch, status: survey.status } };
}

// ── Presenter control (optimistic-epoch CAS) ──────────────────────────────────
export type PresenterAction = "open" | "close" | "reveal" | "next" | "prev" | "reopen" | "reset";

export interface PresenterResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

export async function presenterAction(opts: {
  surveyId: string;
  action: PresenterAction;
  questionId?: string;
  expectedEpoch: number;
}): Promise<PresenterResult> {
  const supabase = getSupabaseAdmin();
  const survey = await getSurveyById(opts.surveyId);
  if (!survey) return { ok: false, status: 404, body: { error: "Survey not found" } };
  // Terminal states: a closed/archived poll must be explicitly re-opened via the
  // status endpoint before questions can be mutated again — otherwise Reopen/Next
  // would set a question open while surveys.status stays closed (inconsistent).
  if (survey.status === "closed" || survey.status === "archived") {
    return { ok: false, status: 409, body: { error: `Survey is ${survey.status}`, status: survey.status } };
  }

  const questions = await getQuestions(opts.surveyId);
  if (questions.length === 0) return { ok: false, status: 409, body: { error: "Survey has no questions" } };

  // Resolve the target question for the action.
  const activeIndex = questions.findIndex((q) => q.id === survey.active_question_id);
  let targetId: string | null = null;
  let newState: string | null = null; // state to set on the target question
  let closeOthers = false;

  switch (opts.action) {
    case "open":
      targetId = opts.questionId ?? questions[0].id;
      newState = "open";
      closeOthers = true;
      break;
    case "reopen":
      targetId = opts.questionId ?? survey.active_question_id;
      newState = "open";
      closeOthers = true;
      break;
    case "next": {
      const ni = activeIndex < 0 ? 0 : Math.min(activeIndex + 1, questions.length - 1);
      targetId = questions[ni].id;
      newState = "open";
      closeOthers = true;
      break;
    }
    case "prev": {
      const pi = activeIndex < 0 ? 0 : Math.max(activeIndex - 1, 0);
      targetId = questions[pi].id;
      newState = "open";
      closeOthers = true;
      break;
    }
    case "close":
      targetId = opts.questionId ?? survey.active_question_id;
      newState = "closed";
      break;
    case "reveal":
      targetId = opts.questionId ?? survey.active_question_id;
      newState = "revealed";
      break;
    case "reset":
      targetId = opts.questionId ?? survey.active_question_id;
      newState = "pending";
      break;
  }

  if (!targetId && opts.action !== "reset") {
    return { ok: false, status: 400, body: { error: "No active question for this action" } };
  }
  const target = questions.find((q) => q.id === targetId);
  if (targetId && !target) {
    return { ok: false, status: 404, body: { error: "Target question not found" } };
  }

  // Decide the survey's next active_question_id + status. Only an open ('open'
  // newState) moves the live pointer; close/reveal/reset keep the current slide
  // (reset's newState is 'pending', so it must be listed explicitly here).
  const nextActiveId =
    newState === "open" ? targetId : survey.active_question_id;
  const nextStatus = newState === "open" && survey.status === "draft" ? "live" : survey.status;
  // The authoritative vote gate for the ACTIVE question. Opening turns it on;
  // closing/revealing/resetting the ACTIVE question turns it off; acting on a
  // DIFFERENT (non-active) question (e.g. resetting a past slide) must leave the
  // currently-open question's gate untouched. Set atomically in the CAS.
  const actingOnActive = targetId !== null && targetId === survey.active_question_id;
  const nextActiveOpen =
    newState === "open" ? true : actingOnActive ? false : survey.active_question_open;

  // Apply the survey CAS AND the question-state writes in ONE transaction (RPC),
  // so a concurrent status change (End poll) can't interleave between the CAS and
  // the question write and leave the survey closed with a question still open.
  const { data: rpcRaw, error: rpcErr } = await supabase.rpc("survey_apply_transition", {
    p_survey_id: opts.surveyId,
    p_expected_epoch: opts.expectedEpoch,
    p_next_active_id: nextActiveId,
    p_active_open: nextActiveOpen,
    p_next_status: nextStatus,
    p_target_id: targetId,
    p_target_state: newState,
    p_close_others: closeOthers,
  });

  if (rpcErr) {
    logger.error("survey_apply_transition rpc failed", { error: rpcErr.message });
    return { ok: false, status: 500, body: { error: "Presenter update failed" } };
  }

  const result = (rpcRaw ?? {}) as {
    ok?: boolean;
    conflict?: boolean;
    state_epoch?: number;
    status?: string;
    active_question_id?: string | null;
  };

  if (!result.ok) {
    // Lost the race (or stale epoch). Return the authoritative current state.
    const fresh = await getSurveyById(opts.surveyId);
    return {
      ok: false,
      status: 409,
      body: {
        error: "State changed — re-sync",
        state_epoch: fresh?.state_epoch ?? survey.state_epoch,
        status: fresh?.status,
        active_question_id: fresh?.active_question_id,
      },
    };
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      state_epoch: result.state_epoch,
      status: result.status,
      active_question_id: result.active_question_id ?? null,
    },
  };
}

// ── Presenter-token verification (for the presenter page, server component) ──
export async function verifyPresenterToken(surveyId: string, token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("survey_tokens")
    .select("survey_id, kind, expires_at, revoked_at")
    .eq("token_hash", hashSurveyToken(token))
    .eq("kind", "presenter")
    .maybeSingle();
  if (error || !data) return false;
  if (data.survey_id !== surveyId) return false;
  if (data.revoked_at) return false;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return false;
  return true;
}

// ── Survey status (open/close the whole thing) ───────────────────────────────
// guardNotArchived: when true (non-management/presenter-token callers), the
// UPDATE only applies if the row is still not archived — closes the TOCTOU where
// a presenter-token transition could land after a manager archives and revive it.
export async function setSurveyStatus(
  surveyId: string,
  status: "draft" | "live" | "closed" | "archived",
  opts: { guardNotArchived?: boolean } = {},
): Promise<Survey | null> {
  const supabase = getSupabaseAdmin();
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  const ending = status === "closed" || status === "archived";
  if (status === "closed") patch.closed_at = new Date().toISOString();
  if (ending) {
    // Stop accepting votes immediately and bump the epoch so phones re-sync to
    // the ended screen on their next poll.
    patch.active_question_open = false;
    patch.state_epoch = await nextEpoch(surveyId);
  }

  let query = supabase.from("surveys").update(patch).eq("id", surveyId);
  if (opts.guardNotArchived) query = query.neq("status", "archived");

  const { data, error } = await query.select("*").maybeSingle();
  if (error) {
    logger.error("setSurveyStatus failed", { error: error.message });
    return null;
  }

  // Close any still-open question so per-question state is consistent with the
  // ended poll (otherwise after_close aggregates keep returning hidden because
  // they check survey_questions.state).
  if (ending) {
    const { error: qErr } = await supabase
      .from("survey_questions")
      .update({ state: "closed", closed_at: new Date().toISOString() })
      .eq("survey_id", surveyId)
      .eq("state", "open");
    if (qErr) logger.error("setSurveyStatus: close-open-question failed", { error: qErr.message });
  }

  return data;
}

/** Read the current epoch and return epoch+1 (best-effort; defaults to 1). */
async function nextEpoch(surveyId: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase.from("surveys").select("state_epoch").eq("id", surveyId).maybeSingle();
  return (data?.state_epoch ?? 0) + 1;
}
