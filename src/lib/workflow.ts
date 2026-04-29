/**
 * Form workflow engine — sequential multi-step approvals.
 *
 * Replaces Gravity Flow's "Form → Approver → Counter-approver → Done"
 * pipelines for forms managed via form_definitions.
 *
 * Lifecycle:
 *   1. /api/submit calls `kickoffWorkflow(submission, form)` after the
 *      submission row lands. If the form has `workflow_config.enabled`
 *      and at least one step, this seeds workflow_state, issues a
 *      magic-link token for step 0, and emails the assignee.
 *   2. Assignee clicks the link → /workflow/<token> renders an
 *      approve/reject page using the same loader.
 *   3. POST /api/workflow/decide validates the token, calls
 *      `applyDecision(...)`, which either advances to the next step
 *      (issue new token + email) or completes the workflow.
 *
 * Tokens are stored hashed (sha256) so a leaked workflow_actions row
 * doesn't grant resign-the-link power. The token is shown once, in the
 * email URL.
 */
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import {
  workflowStateSchema,
  type FormDefinition,
  type WorkflowState,
  type WorkflowStep,
} from "@/lib/form-definitions";

const TOKEN_TTL_DAYS = 30;
const ADMIN_FALLBACK_EMAIL =
  process.env.ADMIN_NOTIFY_EMAIL?.trim() || "rickyz@psprop.net";

// Public-facing base URL for workflow links. Falls back to the form-engine
// URL if NEXT_PUBLIC_APP_URL isn't set; in production both should resolve
// to the same origin.
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ||
  "https://pspm-form-engine-138752496729.us-central1.run.app";

export interface KickoffResult {
  state: WorkflowState;
  firstToken?: { token: string; assigneeEmail: string; step: WorkflowStep };
}

/**
 * Resolve a step's assignee email from the submission data + env.
 * Returns null when:
 *  - assignee.type === "field_email" and the field is missing/invalid
 *    (caller should treat as a config error)
 *  - assignee.type === "literal" and the email failed the schema (won't
 *    happen if the form was saved through PATCH which validates)
 */
export function resolveStepAssignee(
  step: WorkflowStep,
  data: Record<string, unknown>,
): string | null {
  const a = step.assignee;
  if (a.type === "literal") return a.email.toLowerCase();
  if (a.type === "admin_fallback") return ADMIN_FALLBACK_EMAIL.toLowerCase();
  if (a.type === "field_email") {
    const v = data[a.fieldId];
    if (typeof v === "string" && v.includes("@")) {
      return v.trim().toLowerCase();
    }
    return null;
  }
  return null;
}

function newToken(): { token: string; hash: string } {
  // 32 random bytes → 64 hex chars. URL-safe by definition.
  const token = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Issue a magic-link token for a step. Idempotent at the action level —
 * if there's already an unconsumed/unrevoked token for (submission, step)
 * the caller can decide to revoke + reissue (e.g. on resend). v1 always
 * issues a fresh token because email deliverability is the main reason
 * to need a new link, and old links auto-expire in 30 days.
 */
export async function issueWorkflowToken(
  submissionId: string,
  step: WorkflowStep,
  assigneeEmail: string,
): Promise<{ token: string; expiresAt: Date }> {
  const supabase = getSupabaseAdmin();
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 3600 * 1000);

  const { error } = await supabase.from("workflow_actions").insert({
    submission_id: submissionId,
    step_id: step.id,
    assignee_email: assigneeEmail,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  });
  if (error) {
    logger.error("issueWorkflowToken insert failed", {
      submissionId,
      stepId: step.id,
      error: error.message,
    });
    throw new Error("Failed to issue workflow token");
  }

  return { token, expiresAt };
}

/** Build the approver-facing URL for a token. */
export function workflowActionUrl(token: string): string {
  return `${APP_URL}/workflow/${token}`;
}

/**
 * Kick off a workflow on submit. If the form has no workflow or it's
 * disabled, returns a synthetic state with status "completed" so the
 * caller can still write workflow_state for consistency with workflowed
 * forms (one place to look on the admin viewer).
 */
export async function kickoffWorkflow(
  submissionId: string,
  form: FormDefinition,
  data: Record<string, unknown>,
): Promise<KickoffResult> {
  const wf = form.workflow_config;
  const startedAt = new Date().toISOString();

  // No workflow configured — record an immediately-complete state so
  // the admin UI can render a consistent "Done" pill rather than a
  // missing-state question mark.
  if (!wf?.enabled || !wf.steps || wf.steps.length === 0) {
    const state: WorkflowState = {
      status: "completed",
      current_step_id: null,
      history: [
        {
          step_id: "submit",
          action: "kickoff",
          actor_email: "system",
          decided_at: startedAt,
        },
      ],
      started_at: startedAt,
      completed_at: startedAt,
    };
    await persistWorkflowState(submissionId, state);
    return { state };
  }

  const firstStep = wf.steps[0];
  const assignee = resolveStepAssignee(firstStep, data);
  if (!assignee) {
    logger.warn("Workflow first step has no assignee — falling back to admin", {
      submissionId,
      stepId: firstStep.id,
    });
  }
  const effectiveAssignee = assignee ?? ADMIN_FALLBACK_EMAIL.toLowerCase();

  const { token } = await issueWorkflowToken(submissionId, firstStep, effectiveAssignee);

  const state: WorkflowState = {
    status: "in_progress",
    current_step_id: firstStep.id,
    history: [
      {
        step_id: firstStep.id,
        action: "kickoff",
        actor_email: "system",
        decided_at: startedAt,
      },
    ],
    started_at: startedAt,
  };
  await persistWorkflowState(submissionId, state);

  return {
    state,
    firstToken: { token, assigneeEmail: effectiveAssignee, step: firstStep },
  };
}

async function persistWorkflowState(
  submissionId: string,
  state: WorkflowState,
): Promise<void> {
  const validated = workflowStateSchema.parse(state);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("form_submissions")
    .update({ workflow_state: validated })
    .eq("id", submissionId);
  if (error) {
    logger.error("Failed to persist workflow_state", {
      submissionId,
      error: error.message,
    });
    throw new Error("Failed to persist workflow state");
  }
}

export interface DecideContext {
  token: string;
  action: "approve" | "reject" | "comment";
  comments?: string;
  actorEmail?: string;
  actorIp?: string;
}

export interface DecideResult {
  ok: true;
  submissionId: string;
  formSlug: string;
  state: WorkflowState;
  nextToken?: { token: string; assigneeEmail: string; step: WorkflowStep };
}

export interface DecideError {
  ok: false;
  reason:
    | "invalid_token"
    | "expired"
    | "consumed"
    | "revoked"
    | "submission_missing"
    | "form_missing"
    | "step_missing"
    | "action_not_allowed"
    | "internal_error";
  message?: string;
}

/**
 * Apply a decision. Centralizes the "validate token → mutate workflow
 * state → maybe advance" sequence so the API route is thin. Returns a
 * tagged-union result to keep error handling explicit.
 */
export async function applyDecision(
  ctx: DecideContext,
  loader: (slug: string) => Promise<FormDefinition | null>,
): Promise<DecideResult | DecideError> {
  const supabase = getSupabaseAdmin();
  const tokenHash = hashToken(ctx.token);

  // 1. Look up the action row by hash.
  const { data: actionRow, error: actionErr } = await supabase
    .from("workflow_actions")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (actionErr) {
    logger.error("workflow decide: action lookup failed", { error: actionErr.message });
    return { ok: false, reason: "internal_error" };
  }
  if (!actionRow) return { ok: false, reason: "invalid_token" };
  if (actionRow.consumed_at) return { ok: false, reason: "consumed" };
  if (actionRow.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(actionRow.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // 2. Load the submission + form.
  const { data: subRow, error: subErr } = await supabase
    .from("form_submissions")
    .select("id, form_slug, data, workflow_state")
    .eq("id", actionRow.submission_id)
    .maybeSingle();
  if (subErr || !subRow) {
    logger.error("workflow decide: submission lookup failed", {
      submissionId: actionRow.submission_id,
      error: subErr?.message,
    });
    return { ok: false, reason: "submission_missing" };
  }
  const form = await loader(subRow.form_slug);
  if (!form) return { ok: false, reason: "form_missing" };

  const wf = form.workflow_config;
  const step = wf.steps.find((s) => s.id === actionRow.step_id);
  if (!step) return { ok: false, reason: "step_missing" };
  if (!step.actions.includes(ctx.action)) {
    return { ok: false, reason: "action_not_allowed" };
  }

  // 3. Build the next state.
  const stateParse = workflowStateSchema.safeParse(subRow.workflow_state);
  const prev: WorkflowState = stateParse.success
    ? stateParse.data
    : {
        status: "in_progress",
        current_step_id: actionRow.step_id,
        history: [],
        started_at: new Date().toISOString(),
      };

  const decidedAt = new Date().toISOString();
  const stepIndex = wf.steps.findIndex((s) => s.id === step.id);

  const nextHistory = [
    ...prev.history,
    {
      step_id: step.id,
      action: ctx.action,
      actor_email: (ctx.actorEmail ?? actionRow.assignee_email).toLowerCase(),
      actor_label: actionRow.assignee_email,
      comments: ctx.comments?.slice(0, 4000),
      decided_at: decidedAt,
    } as const,
  ];

  let next: WorkflowState;
  let nextStep: WorkflowStep | undefined;
  let nextAssignee: string | null = null;

  if (ctx.action === "reject") {
    next = {
      ...prev,
      status: "rejected",
      current_step_id: step.id,
      history: nextHistory,
      completed_at: decidedAt,
    };
  } else if (ctx.action === "comment" && step.comment_loop_back) {
    // Loop back: previous step (or stay if first). Issue a new token to
    // the prior assignee so they can resubmit — mirrors Gravity Flow's
    // "send back to user" workflow step.
    const targetIndex = Math.max(0, stepIndex - 1);
    nextStep = wf.steps[targetIndex];
    nextAssignee = resolveStepAssignee(nextStep, subRow.data ?? {});
    next = {
      ...prev,
      status: "in_progress",
      current_step_id: nextStep.id,
      history: nextHistory,
    };
  } else if (ctx.action === "comment") {
    // Stay on the current step. The token gets consumed regardless so
    // the link can't be reused; the assignee will be re-issued a token
    // explicitly via /api/admin/workflow/resend (admin-side).
    next = {
      ...prev,
      status: "in_progress",
      current_step_id: step.id,
      history: nextHistory,
    };
  } else {
    // approve
    const isLast = stepIndex >= wf.steps.length - 1;
    if (isLast) {
      next = {
        ...prev,
        status: "completed",
        current_step_id: step.id,
        history: nextHistory,
        completed_at: decidedAt,
      };
    } else {
      nextStep = wf.steps[stepIndex + 1];
      nextAssignee = resolveStepAssignee(nextStep, subRow.data ?? {});
      next = {
        ...prev,
        status: "in_progress",
        current_step_id: nextStep.id,
        history: nextHistory,
      };
    }
  }

  // 4. Persist + consume the token in a best-effort sequence. If the
  // state update succeeds but the token consume fails, the worst case
  // is a re-decide attempt against a now-stale step which will
  // action_not_allowed itself out — acceptable.
  await persistWorkflowState(actionRow.submission_id, next);

  const { error: consumeErr } = await supabase
    .from("workflow_actions")
    .update({
      consumed_at: decidedAt,
      consumed_action: ctx.action,
      consumed_by_email: ctx.actorEmail ?? actionRow.assignee_email,
      consumed_by_ip: ctx.actorIp ?? null,
    })
    .eq("id", actionRow.id)
    .is("consumed_at", null);
  if (consumeErr) {
    logger.warn("Token consume failed (state already advanced)", {
      tokenHashPrefix: tokenHash.slice(0, 12),
      error: consumeErr.message,
    });
  }

  // 5. Issue the next token if we advanced (or looped back) to a real step.
  let nextTokenInfo: DecideResult["nextToken"] | undefined;
  if (nextStep && nextAssignee) {
    try {
      const issued = await issueWorkflowToken(
        actionRow.submission_id,
        nextStep,
        nextAssignee,
      );
      nextTokenInfo = {
        token: issued.token,
        assigneeEmail: nextAssignee,
        step: nextStep,
      };
    } catch (err) {
      logger.error("Failed to issue next-step token", {
        submissionId: actionRow.submission_id,
        stepId: nextStep.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't roll back the state — admin can resend manually. Log loud
      // so this surfaces in monitoring.
    }
  }

  return {
    ok: true,
    submissionId: actionRow.submission_id,
    formSlug: subRow.form_slug,
    state: next,
    nextToken: nextTokenInfo,
  };
}
