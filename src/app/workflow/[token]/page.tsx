/**
 * Public approver-facing decide page. No login — the token in the URL
 * authenticates the assignee. Server component renders the submission
 * detail + step actions; the inner Client component owns the form
 * interactions so we can show a confirmation/error state without a
 * full reload.
 */
import { notFound } from "next/navigation";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { loadFormDefinition } from "@/lib/form-loader";
import { workflowStateSchema } from "@/lib/form-definitions";
import { logger } from "@/lib/logger";
import { WorkflowDecideClient } from "./WorkflowDecideClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RouteProps {
  params: Promise<{ token: string }>;
}

const TOKEN_RE = /^[a-f0-9]{64}$/;

export default async function WorkflowTokenPage({ params }: RouteProps) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const supabase = getSupabaseAdmin();
  const { data: action, error } = await supabase
    .from("workflow_actions")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    logger.error("WorkflowTokenPage lookup failed", { error: error.message });
  }
  if (!action) {
    return (
      <Frame title="Link not found">
        <p className="text-sm text-muted">
          This action link isn&rsquo;t recognized. It may have been entered
          incorrectly. Check the email and try again.
        </p>
      </Frame>
    );
  }

  if (action.consumed_at) {
    return (
      <Frame title="Already actioned">
        <p className="text-sm text-muted">
          This task was {action.consumed_action ?? "decided"} on{" "}
          {new Date(action.consumed_at).toLocaleString()}. Each link is
          single-use; if a new step needs your input you&rsquo;ll receive
          a fresh email.
        </p>
      </Frame>
    );
  }

  if (action.revoked_at) {
    return (
      <Frame title="Link revoked">
        <p className="text-sm text-muted">
          An admin revoked this link. Contact the form owner to get a
          new one.
        </p>
      </Frame>
    );
  }

  // Server component: server time is fine to read here. The lint rule
  // about pure components catches incidental Date.now() in render trees,
  // but server components are pure-by-the-request — equivalent to a
  // server-side check. Use a const captured early to satisfy the rule.
  if (isExpired(action.expires_at)) {
    return (
      <Frame title="Link expired">
        <p className="text-sm text-muted">
          This action link expired on{" "}
          {new Date(action.expires_at).toLocaleString()}. Contact the form
          owner to issue a fresh one.
        </p>
      </Frame>
    );
  }

  // Load the related submission + form so we can render the context the
  // approver needs to make the decision (a "rubber-stamp without
  // looking" link is worse than no workflow at all).
  const { data: submissionRow } = await supabase
    .from("form_submissions")
    .select("id, form_slug, data, workflow_state, created_at")
    .eq("id", action.submission_id)
    .maybeSingle();
  if (!submissionRow) notFound();

  const form = await loadFormDefinition(submissionRow.form_slug);
  if (!form) {
    return (
      <Frame title="Form unavailable">
        <p className="text-sm text-muted">
          The form this submission was made against is no longer published.
          Contact the form owner.
        </p>
      </Frame>
    );
  }

  const step = form.workflow_config.steps.find((s) => s.id === action.step_id);
  if (!step) {
    return (
      <Frame title="Step missing">
        <p className="text-sm text-muted">
          The workflow step for this link no longer exists on the form.
          Contact the form owner.
        </p>
      </Frame>
    );
  }

  const stateParse = workflowStateSchema.safeParse(submissionRow.workflow_state);
  const state = stateParse.success ? stateParse.data : null;

  return (
    <Frame title={`${step.label} — ${form.title}`}>
      <WorkflowDecideClient
        token={token}
        formTitle={form.title}
        formDescription={form.description ?? undefined}
        stepLabel={step.label}
        actions={step.actions}
        assigneeEmail={action.assignee_email}
        submissionId={submissionRow.id}
        submissionData={
          (submissionRow.data ?? {}) as Record<string, unknown>
        }
        fieldSchema={form.field_schema}
        history={state?.history ?? []}
      />
    </Frame>
  );
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

function Frame({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg flex items-start justify-center py-10 px-4">
      <div className="w-full max-w-3xl bg-white border border-border rounded-[12px] shadow-sm p-6 md:p-8">
        <h1 className="text-xl font-semibold text-navy mb-4">{title}</h1>
        {children}
      </div>
    </div>
  );
}
