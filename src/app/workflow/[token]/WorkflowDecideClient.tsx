"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import type {
  FieldDefinition,
  WorkflowHistoryEntry,
} from "@/lib/form-definitions";

interface ClientProps {
  token: string;
  formTitle: string;
  formDescription?: string;
  stepLabel: string;
  actions: ("approve" | "reject" | "comment")[];
  assigneeEmail: string;
  submissionId: string;
  submissionData: Record<string, unknown>;
  fieldSchema: FieldDefinition[];
  history: WorkflowHistoryEntry[];
}

type Action = "approve" | "reject" | "comment";

const ACTION_LABEL: Record<Action, string> = {
  approve: "Approve",
  reject: "Reject",
  comment: "Send back with comment",
};

const ACTION_VARIANT: Record<Action, "primary" | "secondary" | "outline"> = {
  approve: "primary",
  reject: "outline",
  comment: "secondary",
};

export function WorkflowDecideClient({
  token,
  formTitle,
  formDescription,
  stepLabel,
  actions,
  assigneeEmail,
  submissionId,
  submissionData,
  fieldSchema,
  history,
}: ClientProps) {
  const [comments, setComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  async function decide(action: Action) {
    if (action !== "approve" && comments.trim().length === 0) {
      setResult({ ok: false, message: "A comment is required for this action." });
      return;
    }
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/workflow/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, comments: comments.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        outcome?: string;
      };
      if (!res.ok) {
        setResult({
          ok: false,
          message: body.error ?? `Decision failed (${res.status})`,
        });
        return;
      }
      setResult({
        ok: true,
        message:
          action === "approve"
            ? body.outcome === "completed"
              ? "Approved. The workflow is now complete — thank you."
              : "Approved. The next step has been notified."
            : action === "reject"
              ? "Rejected. The submitter has been notified."
              : "Sent back with your comment.",
      });
    } catch (err) {
      setResult({
        ok: false,
        message: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (result?.ok) {
    return (
      <div className="space-y-4">
        <div className="rounded-[8px] border border-brand-green bg-brand-green-light px-4 py-3 text-sm text-brand-green">
          {result.message}
        </div>
        <p className="text-xs text-muted">
          You can close this window.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted">
        Reviewing as <strong className="text-foreground">{assigneeEmail}</strong>{" "}
        · Step <strong className="text-foreground">{stepLabel}</strong>
      </div>

      {formDescription && (
        <p className="text-sm text-foreground">{formDescription}</p>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Submission detail
        </h2>
        <table className="w-full text-sm">
          <tbody>
            {fieldSchema
              .filter((f) => f.type !== "section_break")
              .map((f) => {
                const display = formatFieldDisplay(f, submissionData[f.id]);
                if (!display) return null;
                return (
                  <tr key={f.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium text-foreground align-top w-1/3">
                      {f.label}
                    </td>
                    <td className="py-2 text-foreground align-top whitespace-pre-wrap break-words">
                      {display}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        <p className="text-xs text-muted">
          Reference: {submissionId.slice(0, 8)}
        </p>
      </section>

      {history.length > 1 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            History
          </h2>
          <ul className="space-y-1 text-xs text-muted">
            {history.map((h, i) => (
              <li key={i}>
                <strong className="text-foreground">{h.actor_email}</strong>{" "}
                {h.action} on {new Date(h.decided_at).toLocaleString()}
                {h.comments ? (
                  <>
                    {" "}— <em>{h.comments}</em>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Comment
        </h2>
        <TextArea
          label="Comments (required for reject / send-back)"
          rows={4}
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          helperText={`These are stored on the audit trail for ${formTitle}.`}
        />
      </section>

      {result && !result.ok && (
        <div
          role="alert"
          className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
        >
          {result.message}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        {actions.map((a) => (
          <Button
            key={a}
            variant={ACTION_VARIANT[a]}
            loading={submitting}
            onClick={() => decide(a)}
          >
            {ACTION_LABEL[a]}
          </Button>
        ))}
      </div>
    </div>
  );
}

function formatFieldDisplay(field: FieldDefinition, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (field.type === "signature") {
    return typeof value === "string" && value.startsWith("data:image/")
      ? "(Signature on file — see attached PDF)"
      : null;
  }
  if (field.type === "file_upload") {
    if (!Array.isArray(value) || value.length === 0) return null;
    return value
      .map((u) => {
        const f = u as { filename?: string; size?: number };
        return f.filename ?? "(file)";
      })
      .join(", ");
  }
  if (typeof value === "string") return value || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((v) => String(v)).filter(Boolean).join(", ");
    return text || null;
  }
  if (typeof value === "object") {
    const text = Object.values(value as Record<string, unknown>)
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
      .map((x) => String(x))
      .join(" ");
    return text || null;
  }
  return null;
}
