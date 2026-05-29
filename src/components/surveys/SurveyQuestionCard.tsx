"use client";

import { useMemo, useState } from "react";
import type { PublicQuestionView } from "./types";

/**
 * One question's input UI, mobile-first with big tap targets. Returns the
 * answer payload shape the server expects for the question type. The parent
 * remounts this with key={question.id}, so local input state resets cleanly
 * whenever the presenter advances — no reset effect needed.
 */
export function SurveyQuestionCard({
  question,
  onSubmit,
  submitting,
  alreadyAnswered,
}: {
  question: PublicQuestionView;
  onSubmit: (answer: Record<string, unknown>) => void;
  submitting: boolean;
  alreadyAnswered: boolean;
}) {
  const [choice, setChoice] = useState<string | null>(null);
  const [choices, setChoices] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [value, setValue] = useState<number | null>(null);
  const [words, setWords] = useState<string[]>([""]);

  const cfg = question.config;
  const numericRange = useMemo(() => {
    const min = typeof cfg.min === "number" ? cfg.min : question.type === "nps" ? 0 : 1;
    const max = typeof cfg.max === "number" ? cfg.max : question.type === "nps" ? 10 : 5;
    const out: number[] = [];
    for (let i = min; i <= max; i++) out.push(i);
    return out;
  }, [cfg.min, cfg.max, question.type]);
  const maxWords = typeof cfg.max_words === "number" ? cfg.max_words : 1;
  const maxLength = typeof cfg.max_length === "number" ? cfg.max_length : 280;

  const canSubmit = (() => {
    switch (question.type) {
      case "single_choice":
      case "yes_no":
        return choice !== null;
      case "multi_choice":
        return choices.length > 0;
      case "open_text":
        return text.trim().length > 0;
      case "rating_scale":
      case "star":
      case "nps":
        return value !== null;
      case "word_cloud":
        return words.some((w) => w.trim().length > 0);
      default:
        return false;
    }
  })();

  function build(): Record<string, unknown> | null {
    switch (question.type) {
      case "single_choice":
      case "yes_no":
        return choice ? { choice } : null;
      case "multi_choice":
        return choices.length ? { choices } : null;
      case "open_text":
        return text.trim() ? { text: text.trim() } : null;
      case "rating_scale":
      case "star":
      case "nps":
        return value !== null ? { value } : null;
      case "word_cloud": {
        const cleaned = words.map((w) => w.trim()).filter(Boolean).slice(0, maxWords);
        return cleaned.length ? { words: cleaned } : null;
      }
      default:
        return null;
    }
  }

  function handleSubmit() {
    const a = build();
    if (a) onSubmit(a);
  }

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-navy">{question.prompt}</h2>

      {(question.type === "single_choice" || question.type === "yes_no") && (
        <div className="flex flex-col gap-3">
          {question.options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setChoice(o.id)}
              aria-pressed={choice === o.id}
              className={`w-full rounded-xl border-2 px-5 py-4 text-left text-lg transition-colors ${
                choice === o.id
                  ? "border-primary bg-primary-light font-semibold text-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      {question.type === "multi_choice" && (
        <div className="flex flex-col gap-3">
          {question.options.map((o) => {
            const on = choices.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                onClick={() => setChoices((prev) => (on ? prev.filter((c) => c !== o.id) : [...prev, o.id]))}
                className={`flex w-full items-center gap-3 rounded-xl border-2 px-5 py-4 text-left text-lg transition-colors ${
                  on ? "border-primary bg-primary-light font-semibold text-primary" : "border-border hover:border-primary/50"
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border-2 ${on ? "border-primary bg-primary text-white" : "border-border"}`}>
                  {on ? "✓" : ""}
                </span>
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      {(question.type === "rating_scale" || question.type === "nps") && (
        <div className="flex flex-wrap justify-center gap-2">
          {numericRange.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setValue(n)}
              aria-pressed={value === n}
              className={`h-14 w-14 rounded-xl border-2 text-xl font-semibold transition-colors ${
                value === n ? "border-primary bg-primary text-white" : "border-border hover:border-primary/50"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {question.type === "star" && (
        <div className="flex justify-center gap-2">
          {numericRange.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setValue(n)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              aria-pressed={value === n}
              className={`text-4xl transition-transform ${value !== null && n <= value ? "text-amber-400" : "text-gray-300"}`}
            >
              ★
            </button>
          ))}
        </div>
      )}

      {question.type === "open_text" && (
        <div className="flex flex-col gap-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, maxLength))}
            rows={3}
            maxLength={maxLength}
            placeholder="Type your answer…"
            className="w-full rounded-xl border-2 border-border px-4 py-3 text-lg focus:border-primary focus:outline-none"
          />
          <span className="self-end text-xs text-muted">{text.length}/{maxLength}</span>
        </div>
      )}

      {question.type === "word_cloud" && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: maxWords }).map((_, i) => (
            <input
              key={i}
              value={words[i] ?? ""}
              onChange={(e) => {
                const next = [...words];
                next[i] = e.target.value.replace(/\s+/g, " ").trimStart();
                setWords(next);
              }}
              placeholder={maxWords > 1 ? `Word ${i + 1}` : "One word…"}
              className="w-full rounded-xl border-2 border-border px-4 py-3 text-lg focus:border-primary focus:outline-none"
            />
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit || submitting}
        className="w-full rounded-xl bg-primary px-5 py-4 text-lg font-semibold text-white transition-opacity disabled:opacity-40"
      >
        {submitting ? "Sending…" : alreadyAnswered ? "Update my answer" : "Submit"}
      </button>
      {alreadyAnswered && (
        <p className="text-center text-sm text-muted">You&apos;ve answered — you can change it while voting is open.</p>
      )}
    </div>
  );
}
