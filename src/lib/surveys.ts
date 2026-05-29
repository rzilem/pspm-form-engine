/**
 * Survey / live-polling runtime: question types, per-type answer validators,
 * token minting, and room-code generation.
 *
 * Informal in-meeting polling only — NOT the formal elections/ballot system.
 *
 * Question config is a JSONB blob per type (validated by a discriminated union,
 * mirroring the form-builder's fieldDefinitionSchema). An answer is a small
 * JSONB object whose shape depends on the question type; buildAnswerSchema()
 * derives the Zod validator the /answer route runs server-side.
 */
import crypto from "node:crypto";
import { z } from "zod";

// ── Question types ─────────────────────────────────────────────────────────
// 3 aggregation families: choice-tally (single/multi/yes_no),
// numeric-distribution (rating/star/nps), text-frequency (open_text/word_cloud).
export const SURVEY_QUESTION_TYPES = [
  "single_choice",
  "multi_choice",
  "yes_no",
  "rating_scale",
  "star",
  "open_text",
  "word_cloud",
  "nps",
] as const;
export type SurveyQuestionType = (typeof SURVEY_QUESTION_TYPES)[number];

export const RESULTS_VISIBILITY = ["live_public", "private", "after_close"] as const;
export type ResultsVisibility = (typeof RESULTS_VISIBILITY)[number];

export const QUESTION_STATES = ["pending", "open", "closed", "revealed"] as const;
export type QuestionState = (typeof QUESTION_STATES)[number];

export const SURVEY_STATUSES = ["draft", "live", "closed", "archived"] as const;
export type SurveyStatus = (typeof SURVEY_STATUSES)[number];

// ── Per-type config (what the presenter authored) ──────────────────────────
const choiceOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(200),
});
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

export const questionConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("single_choice"),
    options: z.array(choiceOptionSchema).min(2).max(20),
  }),
  z.object({
    type: z.literal("multi_choice"),
    options: z.array(choiceOptionSchema).min(2).max(20),
    max_selections: z.number().int().positive().max(20).optional(),
  }),
  z.object({
    type: z.literal("yes_no"),
    options: z.array(choiceOptionSchema).min(2).max(3).optional(),
  }),
  z.object({
    type: z.literal("rating_scale"),
    min: z.number().int().min(0).max(10).default(1),
    max: z.number().int().min(1).max(10).default(5),
    min_label: z.string().max(60).optional(),
    max_label: z.string().max(60).optional(),
  }),
  z.object({
    type: z.literal("star"),
    min: z.literal(1).default(1),
    max: z.number().int().min(3).max(10).default(5),
  }),
  z.object({
    type: z.literal("nps"),
    min: z.literal(0).default(0),
    max: z.literal(10).default(10),
  }),
  z.object({
    type: z.literal("open_text"),
    max_length: z.number().int().positive().max(2000).default(280),
    moderation: z.enum(["live", "pre_approve"]).default("pre_approve"),
  }),
  z.object({
    type: z.literal("word_cloud"),
    max_words: z.number().int().positive().max(5).default(1),
    max_word_length: z.number().int().positive().max(60).default(30),
    moderation: z.enum(["live", "pre_approve"]).default("pre_approve"),
  }),
]);
export type QuestionConfig = z.infer<typeof questionConfigSchema>;

// Default yes/no options when the author doesn't supply custom ones.
export const DEFAULT_YES_NO_OPTIONS: ChoiceOption[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
];

/** Resolve the effective option list for a choice-family question. */
export function resolveOptions(type: SurveyQuestionType, config: unknown): ChoiceOption[] {
  const parsed = questionConfigSchema.safeParse(config);
  if (!parsed.success) return type === "yes_no" ? DEFAULT_YES_NO_OPTIONS : [];
  const c = parsed.data;
  if (c.type === "single_choice" || c.type === "multi_choice") return c.options;
  if (c.type === "yes_no") return c.options ?? DEFAULT_YES_NO_OPTIONS;
  return [];
}

// ── Answer validation ───────────────────────────────────────────────────────
// Derive a Zod validator for ONE question's answer payload from its type +
// config. Coercion mirrors buildSubmissionSchema: ""/null is treated as absent.
export function buildAnswerSchema(
  type: SurveyQuestionType,
  config: unknown,
): z.ZodType<Record<string, unknown>> {
  const cfg = questionConfigSchema.safeParse(config);

  switch (type) {
    case "single_choice":
    case "yes_no": {
      const options = resolveOptions(type, config);
      const ids = options.map((o) => o.id);
      const choice =
        ids.length > 0
          ? z.enum(ids as [string, ...string[]])
          : z.string().min(1).max(64);
      return z.object({ choice }) as z.ZodType<Record<string, unknown>>;
    }
    case "multi_choice": {
      const options = resolveOptions(type, config);
      const ids = options.map((o) => o.id);
      const member =
        ids.length > 0
          ? z.enum(ids as [string, ...string[]])
          : z.string().min(1).max(64);
      let arr = z.array(member).min(1, "Pick at least one option");
      if (cfg.success && cfg.data.type === "multi_choice" && cfg.data.max_selections) {
        arr = arr.max(cfg.data.max_selections, `Pick at most ${cfg.data.max_selections}`);
      }
      // De-dupe so a client can't inflate a bucket by repeating a choice.
      return z
        .object({ choices: arr })
        .transform((v) => ({ choices: Array.from(new Set(v.choices as string[])) })) as z.ZodType<
        Record<string, unknown>
      >;
    }
    case "rating_scale":
    case "star":
    case "nps": {
      let min = type === "nps" ? 0 : 1;
      let max = type === "nps" ? 10 : 5;
      if (cfg.success && (cfg.data.type === type)) {
        if ("min" in cfg.data && typeof cfg.data.min === "number") min = cfg.data.min;
        if ("max" in cfg.data && typeof cfg.data.max === "number") max = cfg.data.max;
      }
      const value = z.preprocess(
        (v) => (v === "" || v === null ? undefined : v),
        z.coerce.number().int().min(min).max(max),
      );
      return z.object({ value }) as z.ZodType<Record<string, unknown>>;
    }
    case "open_text": {
      const maxLen =
        cfg.success && cfg.data.type === "open_text" ? cfg.data.max_length : 280;
      return z.object({
        text: z.string().trim().min(1, "Answer can't be empty").max(maxLen),
      }) as z.ZodType<Record<string, unknown>>;
    }
    case "word_cloud": {
      const maxWords =
        cfg.success && cfg.data.type === "word_cloud" ? cfg.data.max_words : 1;
      const maxWordLen =
        cfg.success && cfg.data.type === "word_cloud" ? cfg.data.max_word_length : 30;
      return z
        .object({
          words: z
            .array(z.string().trim().min(1).max(maxWordLen))
            .min(1, "Enter at least one word")
            .max(maxWords, `At most ${maxWords} word(s)`),
        })
        .transform((v) => ({
          words: (v.words as string[]).map((w) => w.toLowerCase()),
        })) as z.ZodType<Record<string, unknown>>;
    }
    default:
      return z.object({}) as z.ZodType<Record<string, unknown>>;
  }
}

// ── Tokens (modeled on workflow.ts: store sha256 hash, show plaintext once) ──
export function newSurveyToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

export function hashSurveyToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Room codes ───────────────────────────────────────────────────────────────
// Unambiguous alphabet: no 0/O/1/I/L. 5 chars → ~28M combos; uniqueness is
// enforced by a generate-retry loop in the create route (not just the index).
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

export function generateRoomCode(length: number = ROOM_CODE_LENGTH): string {
  const bytes = crypto.randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

/** True if `code` only uses the room-code alphabet (case-insensitive input ok). */
export function isValidRoomCode(code: string): boolean {
  const upper = code.toUpperCase();
  return (
    upper.length >= 4 &&
    upper.length <= 8 &&
    [...upper].every((ch) => ROOM_CODE_ALPHABET.includes(ch))
  );
}

// ── Slug helper (matches form-loader normalization) ──────────────────────────
export function normalizeSlug(input: string): string | null {
  const normalized = input.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}
