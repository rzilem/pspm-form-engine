"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParticipantToken } from "./useParticipantToken";
import { SurveyQuestionCard } from "./SurveyQuestionCard";
import { LiveResults } from "./LiveResults";
import type { SurveyStateResponse } from "./types";

const POLL_OPEN_MS = 2000;
const POLL_IDLE_MS = 4000;

export function SurveyParticipant({ surveyId }: { surveyId: string }) {
  const participantToken = useParticipantToken();
  const [state, setState] = useState<SurveyStateResponse | null>(null);
  const [connError, setConnError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [answeredQuestions, setAnsweredQuestions] = useState<Set<string>>(new Set());
  // Honeypot: real users never see/fill this; bots auto-complete every input.
  const [hp, setHp] = useState("");

  const stateRef = useRef<SurveyStateResponse | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  // One-shot fetch (no scheduling). Returns whether the survey still exists.
  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`/api/surveys/${surveyId}/state`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as SurveyStateResponse;
        stateRef.current = data;
        setState(data);
        setConnError(false);
        return true;
      }
      if (res.status === 404) {
        stateRef.current = null;
        setState(null);
        setConnError(false);
        return false;
      }
      setConnError(true);
      return true;
    } catch {
      setConnError(true);
      return true;
    }
  }, [surveyId]);

  // Self-scheduling poll loop. Cadence reads the latest state from the ref, so
  // it speeds up the moment a question opens (no stale closure).
  const schedule = useCallback(() => {
    if (stopped.current) return;
    if (timer.current) clearTimeout(timer.current);
    const open = stateRef.current?.active_question?.voting_open;
    timer.current = setTimeout(async () => {
      const alive = await refresh();
      if (alive) schedule();
    }, open ? POLL_OPEN_MS : POLL_IDLE_MS);
  }, [refresh]);

  useEffect(() => {
    stopped.current = false;
    refresh().then((alive) => {
      if (alive) schedule();
    });
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh, schedule]);

  const submit = useCallback(
    async (answer: Record<string, unknown>) => {
      const active = stateRef.current?.active_question;
      if (!active) return;
      if (!participantToken) {
        // Token is minted on mount (~0ms); guard the rare pre-mint tap so a
        // one_per_device survey doesn't 400.
        setSubmitError("Just a moment — finishing setup. Tap submit again.");
        return;
      }
      setSubmitting(true);
      setSubmitError(null);
      const questionId = active.id;
      try {
        const res = await fetch(`/api/surveys/${surveyId}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question_id: questionId, answer, participant_token: participantToken, hp }),
        });
        if (res.ok) {
          setAnsweredQuestions((prev) => new Set(prev).add(questionId));
          await refresh(); // immediate re-sync; the loop keeps its own cadence
        } else {
          const body = await res.json().catch(() => ({}));
          setSubmitError(typeof body.error === "string" ? body.error : "Couldn't send — try again.");
        }
      } catch {
        setSubmitError("Couldn't send — try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [surveyId, participantToken, hp, refresh],
  );

  const active = state?.active_question ?? null;
  const answered = active ? answeredQuestions.has(active.id) : false;
  // Anonymous polls record independent responses, so there's no "update" — once
  // this device has answered, lock the question to avoid inflating counts.
  const lockedAfterAnswer = answered && state?.response_mode === "anonymous";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-navy px-4 py-3 text-center text-white">
        <p className="truncate text-sm font-semibold">{state?.title ?? "Live poll"}</p>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-6">
        {/* Honeypot — hidden from real users, auto-filled by bots. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={hp}
          onChange={(e) => setHp(e.target.value)}
          className="absolute h-0 w-0 overflow-hidden border-0 p-0 opacity-0"
          style={{ position: "absolute", left: "-9999px" }}
        />
        {connError && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-800">Reconnecting…</p>
        )}

        {state === null && !connError && <Centered title="Poll closed" subtitle="This poll isn't available." />}

        {state && state.status === "closed" && (
          <Centered title="That's a wrap" subtitle="Voting has ended. Thanks for participating!" />
        )}

        {state && state.status !== "closed" && !active && (
          <Centered title="You're in!" subtitle="Waiting for the host to start the first question…" pulse />
        )}

        {state && state.status !== "closed" && active && (
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            {active.voting_open && lockedAfterAnswer ? (
              <>
                <h2 className="mb-3 text-xl font-bold text-navy">{active.prompt}</h2>
                <p className="mb-4 text-center text-sm text-muted">Thanks — your response is in.</p>
                {state.results && !state.results.hidden && (
                  <LiveResults question={active} aggregate={state.results} />
                )}
              </>
            ) : active.voting_open ? (
              <>
                <SurveyQuestionCard key={active.id} question={active} onSubmit={submit} submitting={submitting} alreadyAnswered={answered} />
                {submitError && <p className="mt-3 text-center text-sm text-error">{submitError}</p>}
                {answered && state.results && !state.results.hidden && (
                  <div className="mt-6 border-t border-border pt-5">
                    <p className="mb-3 text-center text-sm font-medium text-muted">Live results</p>
                    <LiveResults question={active} aggregate={state.results} />
                  </div>
                )}
              </>
            ) : (
              <>
                <h2 className="mb-4 text-xl font-bold text-navy">{active.prompt}</h2>
                <p className="mb-4 text-center text-sm text-muted">Voting is closed for this question.</p>
                {state.results && !state.results.hidden ? (
                  <LiveResults question={active} aggregate={state.results} />
                ) : (
                  <p className="text-center text-sm text-muted">Results are hidden.</p>
                )}
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Centered({ title, subtitle, pulse }: { title: string; subtitle: string; pulse?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
      <div className={`mb-2 h-3 w-3 rounded-full bg-primary ${pulse ? "animate-pulse" : ""}`} />
      <h1 className="text-2xl font-bold text-navy">{title}</h1>
      <p className="text-muted">{subtitle}</p>
    </div>
  );
}
