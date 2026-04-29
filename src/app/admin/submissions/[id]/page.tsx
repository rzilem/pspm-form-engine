"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface WorkflowHistoryRow {
  step_id: string;
  action: "approve" | "reject" | "comment" | "kickoff";
  actor_email: string;
  actor_label?: string;
  comments?: string;
  decided_at: string;
}

interface SubmissionDetail {
  id: string;
  form_slug: string;
  form_definition_id: string | null;
  form_title: string | null;
  data: Record<string, unknown>;
  status: "new" | "in_review" | "completed" | "spam" | "archived";
  workflow_state: {
    status?: "pending" | "in_progress" | "completed" | "rejected" | "expired";
    current_step_id?: string | null;
    history?: WorkflowHistoryRow[];
    started_at?: string;
    completed_at?: string;
  } | null;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

function getPassword(): string {
  return typeof document !== "undefined"
    ? document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? ""
    : "";
}

// Render nested data shapes (name {first,last}, address, arrays) so the
// detail view doesn't show raw JSON for composite fields.
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (typeof v === "object") {
    return Object.values(v as Record<string, unknown>)
      .filter((x) => x !== null && x !== undefined && String(x).trim() !== "")
      .map((x) => String(x))
      .join(" ");
  }
  return String(v);
}

interface UploadedFileRow {
  path: string;
  filename: string;
  size: number;
  mimeType: string;
}

function isUploadedFileArray(v: unknown): v is UploadedFileRow[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (x) =>
        x &&
        typeof x === "object" &&
        typeof (x as { path?: unknown }).path === "string" &&
        typeof (x as { filename?: unknown }).filename === "string",
    )
  );
}

function isSignatureDataUrl(v: unknown): v is string {
  return typeof v === "string" && v.startsWith("data:image/");
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FileLinks({
  files,
  password,
  apiBase,
}: {
  files: UploadedFileRow[];
  password: string;
  apiBase: string;
}) {
  async function open(path: string) {
    const res = await fetch(
      `${apiBase}/api/admin/uploads/sign?path=${encodeURIComponent(path)}`,
      { headers: { "x-admin-password": password } },
    );
    if (!res.ok) {
      alert("Could not generate download link");
      return;
    }
    const body = (await res.json()) as { url?: string };
    if (body.url) window.open(body.url, "_blank", "noopener,noreferrer");
  }

  return (
    <ul className="space-y-1">
      {files.map((f) => (
        <li key={f.path} className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => open(f.path)}
            className="text-primary underline-offset-2 hover:underline"
          >
            {f.filename}
          </button>
          <span className="text-xs text-muted">
            ({formatBytes(f.size)} · {f.mimeType})
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [submission, setSubmission] = useState<SubmissionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [reviewedBy, setReviewedBy] = useState("");
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/submissions/${id}`, {
        headers: { "x-admin-password": getPassword() },
      });
      if (res.status === 401) {
        router.push("/admin/submissions");
        return;
      }
      if (res.status === 404) {
        setLoadError("Submission not found.");
        return;
      }
      if (!res.ok) {
        setLoadError(`Failed to load (${res.status})`);
        return;
      }
      const data = (await res.json()) as SubmissionDetail;
      setSubmission(data);
      setNotes(data.reviewer_notes ?? "");
      setReviewedBy(data.reviewed_by ?? "");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(payload: Record<string, unknown>, kind: "status" | "notes") {
    if (kind === "status") setSavingStatus(true);
    else setSavingNotes(true);
    setSaveStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSaveStatus(`Failed: ${body.error ?? res.status}`);
        return;
      }
      setSaveStatus("Saved");
      await load();
    } finally {
      if (kind === "status") setSavingStatus(false);
      else setSavingNotes(false);
    }
  }

  if (loadError) {
    return (
      <FormLayout title="Submission" subtitle={loadError}>
        <Link href="/admin/submissions" className="text-primary text-sm">
          ← Back to submissions
        </Link>
      </FormLayout>
    );
  }
  if (!submission) {
    return (
      <FormLayout title="Submission">
        <p className="text-sm text-muted">Loading…</p>
      </FormLayout>
    );
  }

  const dataEntries = Object.entries(submission.data ?? {});

  return (
    <FormLayout
      title={submission.form_title ?? submission.form_slug}
      subtitle={`Submitted ${new Date(submission.created_at).toLocaleString()}`}
    >
      <div className="flex items-center justify-between mb-4">
        <Link href="/admin/submissions" className="text-primary text-sm">
          ← Back to submissions
        </Link>
        <div className="flex items-center gap-3 text-xs text-muted">
          <code>{submission.form_slug}</code>
          {saveStatus && <span className="text-brand-green">{saveStatus}</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section className="md:col-span-2 space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Submission data
          </h2>
          {dataEntries.length === 0 ? (
            <p className="text-sm text-muted">No data captured.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {dataEntries.map(([k, v]) => (
                  <tr key={k} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium text-foreground align-top w-1/3">
                      {k}
                    </td>
                    <td className="py-2 text-foreground align-top whitespace-pre-wrap break-words">
                      {isUploadedFileArray(v) ? (
                        <FileLinks
                          files={v}
                          password={getPassword()}
                          apiBase={API_BASE}
                        />
                      ) : isSignatureDataUrl(v) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v}
                          alt="Signature"
                          className="max-h-24 border border-border rounded bg-white"
                        />
                      ) : (
                        formatValue(v)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {(submission.ip_address || submission.user_agent) && (
            <details className="text-xs text-muted mt-4">
              <summary className="cursor-pointer">Request metadata</summary>
              <div className="mt-2 space-y-1 pl-3">
                {submission.ip_address && <div>IP: {submission.ip_address}</div>}
                {submission.user_agent && (
                  <div className="break-all">UA: {submission.user_agent}</div>
                )}
              </div>
            </details>
          )}
        </section>

        <aside className="space-y-4">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Status
            </h2>
            <SelectField
              label=""
              value={submission.status}
              onChange={(e) => patch({ status: e.target.value }, "status")}
              disabled={savingStatus}
              options={[
                { label: "New", value: "new" },
                { label: "In review", value: "in_review" },
                { label: "Completed", value: "completed" },
                { label: "Spam", value: "spam" },
                { label: "Archived", value: "archived" },
              ]}
            />
            {submission.reviewed_at && (
              <p className="text-xs text-muted">
                Last reviewed {new Date(submission.reviewed_at).toLocaleString()}
                {submission.reviewed_by ? ` by ${submission.reviewed_by}` : ""}
              </p>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Reviewer
            </h2>
            <input
              type="text"
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
              placeholder="Your initials or email"
              className="w-full rounded-[8px] border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Notes
            </h2>
            <TextArea
              label=""
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes — not visible to the submitter."
            />
            <Button
              size="sm"
              loading={savingNotes}
              onClick={() => patch({ reviewer_notes: notes, reviewed_by: reviewedBy }, "notes")}
            >
              Save notes
            </Button>
          </section>

          {submission.workflow_state && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
                Workflow
              </h2>
              <p className="text-xs">
                Status:{" "}
                <strong className="text-foreground">
                  {submission.workflow_state.status?.replace("_", " ") ?? "—"}
                </strong>
                {submission.workflow_state.current_step_id ? (
                  <>
                    {" · current step: "}
                    <code>{submission.workflow_state.current_step_id}</code>
                  </>
                ) : null}
              </p>
              <ol className="border-l-2 border-border pl-3 space-y-2 text-xs">
                {(submission.workflow_state.history ?? []).map((h, i) => (
                  <li key={i}>
                    <div className="text-foreground">
                      <strong>{h.actor_email}</strong>{" "}
                      <span className="text-muted">{h.action}</span>{" "}
                      <code className="text-muted">{h.step_id}</code>
                    </div>
                    <div className="text-muted">
                      {new Date(h.decided_at).toLocaleString()}
                    </div>
                    {h.comments && (
                      <div className="text-foreground italic mt-0.5">
                        “{h.comments}”
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </FormLayout>
  );
}
