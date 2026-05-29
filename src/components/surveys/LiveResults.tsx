"use client";

import type { Aggregate, PublicQuestionView } from "./types";

/**
 * Renders a question's aggregate. Pure CSS bars (no chart lib in M1) so the
 * width transition gives the Slido "bars grow" feel. Same component drives the
 * phone and the presenter screen. Never receives raw rows — only counts.
 */
export function LiveResults({
  question,
  aggregate,
  large = false,
}: {
  question: PublicQuestionView;
  aggregate: Aggregate | null;
  large?: boolean;
}) {
  if (!aggregate || aggregate.hidden) {
    return (
      <p className={`text-center text-muted ${large ? "text-lg" : "text-sm"}`}>
        Results are hidden{aggregate?.reason === "opens_after_close" ? " until voting closes" : ""}.
      </p>
    );
  }
  if (aggregate.error) {
    return <p className="text-center text-sm text-muted">Results unavailable.</p>;
  }

  const optionLabel = (id: string) =>
    question.options.find((o) => o.id === id)?.label ?? id;

  // Choice families → labeled bars.
  if (aggregate.buckets && (question.type === "single_choice" || question.type === "multi_choice" || question.type === "yes_no")) {
    const denom =
      question.type === "multi_choice"
        ? Math.max(aggregate.respondents ?? 0, 1)
        : Math.max(aggregate.total ?? 0, 1);
    // Show every defined option (zero-fill), ordered by the question's options.
    const rows = (question.options.length > 0
      ? question.options.map((o) => ({ key: o.id, label: o.label }))
      : Object.keys(aggregate.buckets).map((k) => ({ key: k, label: optionLabel(k) }))
    ).map((r) => ({ ...r, count: aggregate.buckets?.[r.key] ?? 0 }));

    const totalLabel = question.type === "multi_choice" ? aggregate.respondents ?? 0 : aggregate.total ?? 0;
    return (
      <div className="flex flex-col gap-3">
        {rows.map((r) => {
          const pct = Math.round((r.count / denom) * 100);
          return <Bar key={r.key} label={r.label} count={r.count} pct={pct} large={large} />;
        })}
        <p className={`text-center text-muted ${large ? "text-base" : "text-xs"}`}>
          {totalLabel} {totalLabel === 1 ? "response" : "responses"}
        </p>
      </div>
    );
  }

  // Numeric families → distribution bars + mean.
  if (aggregate.distribution && (question.type === "rating_scale" || question.type === "star" || question.type === "nps")) {
    const entries = Object.entries(aggregate.distribution).sort((a, b) => Number(a[0]) - Number(b[0]));
    const max = Math.max(1, ...entries.map(([, c]) => c));
    return (
      <div className="flex flex-col gap-3">
        <p className={`text-center font-bold text-navy ${large ? "text-4xl" : "text-2xl"}`}>
          {aggregate.mean ?? 0}
          <span className={`font-normal text-muted ${large ? "text-lg" : "text-sm"}`}> avg</span>
        </p>
        {entries.map(([value, count]) => (
          <Bar key={value} label={value} count={count} pct={Math.round((count / max) * 100)} large={large} />
        ))}
        <p className={`text-center text-muted ${large ? "text-base" : "text-xs"}`}>
          {aggregate.total ?? 0} {(aggregate.total ?? 0) === 1 ? "response" : "responses"}
        </p>
      </div>
    );
  }

  // Word cloud → simple sized term list (recharts/word-cloud lib lands in M2).
  if (aggregate.terms && question.type === "word_cloud") {
    const entries = Object.entries(aggregate.terms).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, c]) => c));
    if (entries.length === 0) return <p className="text-center text-sm text-muted">No words yet.</p>;
    return (
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 py-2">
        {entries.map(([word, count]) => {
          const scale = 1 + (count / max) * (large ? 2.5 : 1.4);
          return (
            <span key={word} style={{ fontSize: `${scale}rem` }} className="font-semibold text-primary leading-none">
              {word}
              <span className="ml-1 align-top text-[0.6em] text-muted">{count}</span>
            </span>
          );
        })}
      </div>
    );
  }

  // Open text → count only (moderated list shown elsewhere).
  if (question.type === "open_text") {
    return (
      <p className={`text-center text-muted ${large ? "text-lg" : "text-sm"}`}>
        {aggregate.total ?? 0} {(aggregate.total ?? 0) === 1 ? "response" : "responses"} received
      </p>
    );
  }

  return <p className="text-center text-sm text-muted">No results yet.</p>;
}

function Bar({ label, count, pct, large }: { label: string; count: number; pct: number; large: boolean }) {
  return (
    <div>
      <div className={`flex justify-between ${large ? "text-lg" : "text-sm"}`}>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted">{pct}% · {count}</span>
      </div>
      <div className={`mt-1 w-full overflow-hidden rounded-full bg-gray-100 ${large ? "h-6" : "h-3"}`}>
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
          role="meter"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label}: ${pct} percent`}
        />
      </div>
    </div>
  );
}
