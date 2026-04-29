/**
 * Public endpoint for approve/reject/comment decisions on a workflow
 * action token. Auth is implicit in the token itself — anyone holding
 * the link can decide as the assignee. The token is single-use and
 * expires after 30 days.
 *
 * Notification side effects:
 *  - Approve → if there's a next step, email the next assignee.
 *  - Approve on last step → notify a designated submitter email if the
 *    form has a "submitter_email_field" notification rule (Phase 4.1
 *    refinement; v1 just persists state).
 *  - Reject → email the original submitter when we can resolve their
 *    address from the data via the same `{{field.<id>}}` mustache logic
 *    as notification_config.
 */
import { logger } from "@/lib/logger";
import { loadFormDefinition } from "@/lib/form-loader";
import { applyDecision, workflowActionUrl } from "@/lib/workflow";
import {
  sendWorkflowAssignmentEmail,
  sendWorkflowOutcomeEmail,
} from "@/lib/email";
import { resolveRecipients } from "@/lib/form-definitions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { z } from "zod";

const decideBodySchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["approve", "reject", "comment"]),
  comments: z.string().max(4000).optional(),
});

const REASON_TO_HTTP: Record<string, number> = {
  invalid_token: 400,
  expired: 410,
  consumed: 409,
  revoked: 410,
  submission_missing: 404,
  form_missing: 404,
  step_missing: 410,
  action_not_allowed: 400,
  internal_error: 500,
};

const REASON_MSG: Record<string, string> = {
  invalid_token: "This link wasn't recognized.",
  expired: "This link has expired.",
  consumed: "This link has already been used.",
  revoked: "This link was revoked.",
  submission_missing: "The submission this link points to no longer exists.",
  form_missing: "The form is no longer published.",
  step_missing: "The workflow step on this link no longer exists.",
  action_not_allowed: "That action isn't allowed for this step.",
  internal_error: "Something went wrong. Please try again shortly.",
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = decideBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("cf-connecting-ip") ??
    null;

  const result = await applyDecision(
    {
      token: parsed.data.token,
      action: parsed.data.action,
      comments: parsed.data.comments,
      actorIp: ip ?? undefined,
    },
    loadFormDefinition,
  );

  if (!result.ok) {
    return Response.json(
      { error: REASON_MSG[result.reason] ?? result.reason },
      { status: REASON_TO_HTTP[result.reason] ?? 400 },
    );
  }

  // Re-fetch form + submission once for downstream emails. applyDecision
  // already pinned the submissionId/formSlug so no race here.
  const form = await loadFormDefinition(result.formSlug);
  const supabase = getSupabaseAdmin();
  const { data: subRow } = await supabase
    .from("form_submissions")
    .select("data")
    .eq("id", result.submissionId)
    .maybeSingle();
  const subData = (subRow?.data ?? {}) as Record<string, unknown>;

  // Best-effort downstream emails. The decision is already persisted so
  // a notification failure shouldn't undo it; we just log.
  if (result.nextToken && form) {
    try {
      await sendWorkflowAssignmentEmail({
        to: result.nextToken.assigneeEmail,
        formTitle: form.title,
        stepLabel: result.nextToken.step.label,
        customSubject: result.nextToken.step.email_subject,
        actionUrl: workflowActionUrl(result.nextToken.token),
        submissionRef: result.submissionId,
        description: form.description ?? undefined,
        comments: parsed.data.comments,
      });
    } catch (err) {
      logger.error("Next-step email failed (workflow already advanced)", {
        error: String(err),
        submissionId: result.submissionId,
      });
    }
  }

  // Notify submitter on terminal outcomes. Piggybacks on notification_config
  // — the first {{field.<id>}} recipient is treated as the submitter.
  if (
    form &&
    (result.state.status === "completed" || result.state.status === "rejected")
  ) {
    try {
      const submitterEmail = guessSubmitterEmail(
        form.notification_config.rules,
        subData,
      );
      if (submitterEmail) {
        await sendWorkflowOutcomeEmail({
          to: submitterEmail,
          formTitle: form.title,
          outcome:
            result.state.status === "completed" ? "approved" : "rejected",
          comments: parsed.data.comments,
          submissionRef: result.submissionId,
        });
      }
    } catch (err) {
      logger.error("Submitter outcome email failed", {
        error: String(err),
        submissionId: result.submissionId,
      });
    }
  }

  return Response.json({
    ok: true,
    outcome: result.state.status,
    currentStepId: result.state.current_step_id,
  });
}

// Find a submitter email by scanning notification rules: the first rule
// whose recipient list contains a `{{field.<id>}}` token resolved to an
// email-shaped string is treated as the submitter. Best-effort.
function guessSubmitterEmail(
  rules: Array<{ recipients: string[] }>,
  data: Record<string, unknown>,
): string | null {
  for (const r of rules) {
    const resolved = resolveRecipients(
      r.recipients.filter((x) => x.includes("{{")),
      data,
    );
    if (resolved.length > 0) return resolved[0];
  }
  return null;
}
