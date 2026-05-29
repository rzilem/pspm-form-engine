-- Survey / live-polling mode (Slido/Mentimeter-style) for HOA annual meetings.
-- Informal polling ONLY — not the formal elections/quorum/ballot system.
--
-- Security model (differs from form_submissions on purpose):
--   * All five tables: RLS on, service_role-only. No anon row access of any kind.
--   * Participant phones + presenter screens read/write exclusively through
--     Next.js API routes, which use the service-role client AFTER validating
--     question state. The anon key can never read individual responses.
--   * The ONE public surface is survey_question_aggregate() — a SECURITY DEFINER
--     function that returns counts/means/word-frequencies, gated by the survey's
--     results_visibility. It can never return a row id, participant_token, raw
--     IP, or unmoderated free text.

-- ── survey_meetings (optional grouping; thin in v1) ────────────────────────
CREATE TABLE IF NOT EXISTS survey_meetings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community    TEXT,
  title        TEXT NOT NULL,
  meeting_date DATE,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── surveys (the presenter-driven container) ───────────────────────────────
CREATE TABLE IF NOT EXISTS surveys (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT UNIQUE,
  title               TEXT NOT NULL,
  description         TEXT,
  community           TEXT,
  meeting_id          UUID REFERENCES survey_meetings(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','live','closed','archived')),
  results_visibility  TEXT NOT NULL DEFAULT 'private'
                        CHECK (results_visibility IN ('live_public','private','after_close')),
  -- Pointer to the currently-displayed question. Plain UUID (no FK) to avoid a
  -- circular surveys<->survey_questions dependency and cascade ordering pain;
  -- the app maintains integrity.
  active_question_id  UUID,
  -- Monotonic sync token. Bumped on EVERY presenter action so phones detect a
  -- change (new slide / closed / revealed / reset) within one poll interval.
  state_epoch         BIGINT NOT NULL DEFAULT 0,
  response_mode       TEXT NOT NULL DEFAULT 'one_per_device'
                        CHECK (response_mode IN ('anonymous','one_per_device')),
  recaptcha_required  BOOLEAN NOT NULL DEFAULT false,
  room_code           TEXT UNIQUE,
  created_by          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_surveys_slug      ON surveys(slug)      WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_room_code ON surveys(room_code) WHERE room_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_surveys_status    ON surveys(status);
CREATE INDEX IF NOT EXISTS idx_surveys_community ON surveys(community, created_at DESC);

-- ── survey_questions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS survey_questions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id           UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  type                TEXT NOT NULL
                        CHECK (type IN ('single_choice','multi_choice','yes_no',
                                        'rating_scale','star','open_text','word_cloud','nps')),
  prompt              TEXT NOT NULL,
  config              JSONB NOT NULL DEFAULT '{}'::jsonb,
  state               TEXT NOT NULL DEFAULT 'pending'
                        CHECK (state IN ('pending','open','closed','revealed')),
  results_visibility  TEXT
                        CHECK (results_visibility IN ('live_public','private','after_close')),
  opened_at           TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sq_position ON survey_questions(survey_id, position);
CREATE INDEX        IF NOT EXISTS idx_sq_survey    ON survey_questions(survey_id, position);
-- At most one OPEN question per survey — the race backstop behind the
-- optimistic-epoch CAS in the present route.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sq_one_open ON survey_questions(survey_id) WHERE state = 'open';

-- ── survey_responses (the hot table) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS survey_responses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id             UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  question_id           UUID NOT NULL REFERENCES survey_questions(id) ON DELETE CASCADE,
  answer                JSONB NOT NULL,
  participant_token     TEXT,
  state_epoch_at_answer BIGINT,
  ip_address            INET,
  user_agent            TEXT,
  suspect               BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sr_question ON survey_responses(question_id);
CREATE INDEX IF NOT EXISTS idx_sr_survey   ON survey_responses(survey_id, created_at DESC);
-- One answer per device per question (UPSERT target = change-vote); only
-- enforced when a participant token is present.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sr_device_question
  ON survey_responses(question_id, participant_token)
  WHERE participant_token IS NOT NULL;

-- ── survey_tokens (join + presenter links; hashed) ─────────────────────────
CREATE TABLE IF NOT EXISTS survey_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id   UUID NOT NULL REFERENCES surveys(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('join','presenter')),
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_st_survey ON survey_tokens(survey_id, kind);
CREATE INDEX IF NOT EXISTS idx_st_hash   ON survey_tokens(token_hash);

-- ── RLS: every table service_role-only (no anon access) ────────────────────
ALTER TABLE survey_meetings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE surveys          ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_tokens    ENABLE ROW LEVEL SECURITY;

-- Scope policies explicitly TO service_role so they never apply to anon/authenticated
-- (the RLS-USING(true)-exposes-anon lesson). The anon key gets NOTHING here.
CREATE POLICY survey_meetings_service  ON survey_meetings  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY surveys_service          ON surveys          FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY survey_questions_service ON survey_questions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY survey_responses_service ON survey_responses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY survey_tokens_service    ON survey_tokens    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── The single public aggregate surface ────────────────────────────────────
-- Returns only counts/means/frequencies, gated by visibility. Never returns a
-- row id, participant_token, raw IP, or unmoderated free text.
CREATE OR REPLACE FUNCTION public.survey_question_aggregate(p_question_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q          survey_questions%ROWTYPE;
  s          surveys%ROWTYPE;
  visibility TEXT;
  result     JSONB;
BEGIN
  SELECT * INTO q FROM survey_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT * INTO s FROM surveys WHERE id = q.survey_id;
  visibility := COALESCE(q.results_visibility, s.results_visibility);

  IF visibility = 'private' THEN
    RETURN jsonb_build_object('hidden', true);
  ELSIF visibility = 'after_close' AND q.state NOT IN ('closed','revealed') THEN
    RETURN jsonb_build_object('hidden', true, 'reason', 'opens_after_close');
  END IF;

  IF q.type IN ('single_choice','yes_no') THEN
    SELECT jsonb_build_object(
      'type', q.type,
      'total', COALESCE(sum(cnt), 0),
      'buckets', COALESCE(jsonb_object_agg(choice, cnt) FILTER (WHERE choice IS NOT NULL), '{}'::jsonb)
    ) INTO result
    FROM (
      SELECT answer->>'choice' AS choice, count(*) AS cnt
      FROM survey_responses
      WHERE question_id = p_question_id
      GROUP BY answer->>'choice'
    ) t;

  ELSIF q.type = 'multi_choice' THEN
    SELECT jsonb_build_object(
      'type', 'multi_choice',
      'respondents', (SELECT count(*) FROM survey_responses WHERE question_id = p_question_id),
      'buckets', COALESCE(jsonb_object_agg(choice, cnt) FILTER (WHERE choice IS NOT NULL), '{}'::jsonb)
    ) INTO result
    FROM (
      SELECT c AS choice, count(*) AS cnt
      FROM survey_responses sr,
           LATERAL jsonb_array_elements_text(sr.answer->'choices') AS c
      WHERE sr.question_id = p_question_id
      GROUP BY c
    ) t;

  ELSIF q.type IN ('rating_scale','star','nps') THEN
    SELECT jsonb_build_object(
      'type', q.type,
      'total', COALESCE(sum(cnt), 0),
      'mean', round(
        CASE WHEN sum(cnt) > 0
             THEN sum((val)::numeric * cnt) / sum(cnt)
             ELSE 0 END, 2),
      'distribution', COALESCE(jsonb_object_agg(val, cnt) FILTER (WHERE val IS NOT NULL), '{}'::jsonb)
    ) INTO result
    FROM (
      SELECT answer->>'value' AS val, count(*) AS cnt
      FROM survey_responses
      WHERE question_id = p_question_id
        AND (answer->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$'
      GROUP BY answer->>'value'
    ) t;

  ELSIF q.type = 'word_cloud' THEN
    SELECT jsonb_build_object(
      'type', 'word_cloud',
      'terms', COALESCE(jsonb_object_agg(word, cnt) FILTER (WHERE word IS NOT NULL), '{}'::jsonb)
    ) INTO result
    FROM (
      SELECT lower(trim(w)) AS word, count(*) AS cnt
      FROM survey_responses sr,
           LATERAL jsonb_array_elements_text(sr.answer->'words') AS w
      WHERE sr.question_id = p_question_id AND trim(w) <> ''
      GROUP BY lower(trim(w))
      ORDER BY count(*) DESC
      LIMIT 100
    ) t;

  ELSE
    -- open_text: count only. Moderated text is served by a separate
    -- service-role endpoint, never bulk-public.
    SELECT jsonb_build_object('type', 'open_text', 'total', count(*)) INTO result
    FROM survey_responses
    WHERE question_id = p_question_id;
  END IF;

  RETURN COALESCE(result, jsonb_build_object('total', 0));
END;
$$;

REVOKE ALL ON FUNCTION public.survey_question_aggregate(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.survey_question_aggregate(UUID) TO anon, service_role;
