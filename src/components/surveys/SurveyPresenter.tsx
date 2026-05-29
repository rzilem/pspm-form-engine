"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LiveResults } from "./LiveResults";
import type { SurveyStateResponse } from "./types";

const POLL_MS = 2000;

export function SurveyPresenter({
  surveyId,
  presenterToken,
  roomCode,
  joinUrl,
  qrUrl,
  canControl,
}: {
  surveyId: string;
  presenterToken: string | null;
  roomCode: string;
  joinUrl: string;
  qrUrl: string;
  canControl: boolean;
}) {
  const [state, setState] = useState<SurveyStateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const stateRef = useRef<SurveyStateResponse | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/surveys/${surveyId}/state`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as SurveyStateResponse;
        stateRef.current = data;
        setState(data);
      }
    } catch {
      /* keep last-good on screen */
    }
  }, [surveyId]);

  useEffect(() => {
    stopped.current = false;
    const loop = async () => {
      await refresh();
      if (!stopped.current) timer.current = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      stopped.current = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [refresh]);

  const control = useCallback(
    async (action: string) => {
      if (!canControl) return;
      setBusy(true);
      setNotice(null);
      const epoch = stateRef.current?.state_epoch ?? 0;
      try {
        const res = await fetch(`/api/surveys/${surveyId}/present`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(presenterToken ? { "x-survey-presenter-token": presenterToken } : {}),
          },
          body: JSON.stringify({ action, expected_epoch: epoch }),
        });
        if (res.status === 409) setNotice("Re-synced — try again.");
        else if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          setNotice(typeof b.error === "string" ? b.error : "Action failed.");
        }
      } catch {
        setNotice("Action failed — check connection.");
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [surveyId, presenterToken, canControl, refresh],
  );

  const setStatus = useCallback(
    async (status: string) => {
      if (!canControl) return;
      setBusy(true);
      try {
        await fetch(`/api/surveys/${surveyId}/status`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(presenterToken ? { "x-survey-presenter-token": presenterToken } : {}),
          },
          body: JSON.stringify({ status }),
        });
      } finally {
        await refresh();
        setBusy(false);
      }
    },
    [surveyId, presenterToken, canControl, refresh],
  );

  const active = state?.active_question ?? null;
  const ended = state?.status === "closed";

  return (
    <div className="flex min-h-screen flex-col bg-navy text-white">
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-8">
        {ended ? (
          <div className="text-center">
            <h1 className="text-4xl font-bold">Poll ended</h1>
            <p className="mt-2 text-white/70">Thanks for participating.</p>
          </div>
        ) : !active ? (
          <Lobby roomCode={roomCode} joinUrl={joinUrl} qrUrl={qrUrl} />
        ) : (
          <div className="w-full max-w-4xl">
            <p className="mb-2 text-center text-sm uppercase tracking-wide text-white/50">
              Question {active.position + 1} of {state?.question_count ?? 1}
              {active.voting_open ? " · voting open" : " · voting closed"}
            </p>
            <h1 className="mb-8 text-center text-4xl font-bold leading-tight">{active.prompt}</h1>
            <div className="rounded-3xl bg-white p-8 text-foreground">
              {state?.results && !state.results.hidden ? (
                <LiveResults question={active} aggregate={state.results} large />
              ) : (
                <p className="text-center text-lg text-muted">Results hidden — answers are being collected.</p>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Persistent join strip */}
      {!ended && active && (
        <div className="flex items-center justify-center gap-4 bg-black/20 px-6 py-3 text-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrUrl} alt="Join QR code" className="h-16 w-16 rounded bg-white p-1" />
          <div>
            <p className="text-white/60">Join at</p>
            <p className="font-semibold">{joinUrl.replace(/^https?:\/\//, "")}</p>
            <p className="text-white/60">Code <span className="font-bold tracking-widest text-white">{roomCode}</span></p>
          </div>
        </div>
      )}

      {/* Controls — hidden once the poll has ended (closed is terminal). */}
      {canControl && !ended && (
        <div className="border-t border-white/10 bg-black/30 px-4 py-3">
          {notice && <p className="mb-2 text-center text-xs text-amber-300">{notice}</p>}
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
            {!active || state?.status === "draft" ? (
              <Ctrl onClick={() => control("open")} busy={busy} primary>Start poll</Ctrl>
            ) : (
              <>
                <Ctrl onClick={() => control("prev")} busy={busy}>← Prev</Ctrl>
                {active.voting_open ? (
                  <Ctrl onClick={() => control("close")} busy={busy}>Close voting</Ctrl>
                ) : (
                  <Ctrl onClick={() => control("reopen")} busy={busy}>Reopen</Ctrl>
                )}
                <Ctrl onClick={() => control("next")} busy={busy} primary>Next →</Ctrl>
                <Ctrl onClick={() => setStatus("closed")} busy={busy} danger>End poll</Ctrl>
              </>
            )}
          </div>
        </div>
      )}
      {!canControl && (
        <div className="bg-black/30 px-4 py-2 text-center text-xs text-white/50">
          View-only — presenter controls need a valid presenter link.
        </div>
      )}
    </div>
  );
}

function Lobby({ roomCode, joinUrl, qrUrl }: { roomCode: string; joinUrl: string; qrUrl: string }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <h1 className="text-3xl font-bold">Join the poll</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrUrl} alt="Scan to join" className="h-64 w-64 rounded-2xl bg-white p-3" />
      <div>
        <p className="text-white/60">Go to</p>
        <p className="text-2xl font-semibold">{joinUrl.replace(/^https?:\/\//, "")}</p>
        <p className="mt-2 text-white/60">or enter code</p>
        <p className="text-5xl font-bold tracking-[0.3em]">{roomCode}</p>
      </div>
    </div>
  );
}

function Ctrl({
  onClick,
  busy,
  children,
  primary,
  danger,
}: {
  onClick: () => void;
  busy: boolean;
  children: React.ReactNode;
  primary?: boolean;
  danger?: boolean;
}) {
  const tone = danger
    ? "bg-red-500/90 hover:bg-red-500"
    : primary
      ? "bg-white text-navy hover:bg-white/90"
      : "bg-white/15 hover:bg-white/25";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`rounded-xl px-5 py-3 text-base font-semibold transition-colors disabled:opacity-50 ${tone}`}
    >
      {children}
    </button>
  );
}
