"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";

interface SubmissionRow {
  id: string;
  form_slug: string;
  form_definition_id: string | null;
  data: Record<string, unknown>;
  status: "new" | "in_review" | "completed" | "spam" | "archived";
  workflow_state: {
    status?: "pending" | "in_progress" | "completed" | "rejected" | "expired";
    current_step_id?: string | null;
  } | null;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const STATUS_PILL: Record<string, string> = {
  new: "bg-primary-light text-primary",
  in_review: "bg-yellow-100 text-yellow-800",
  completed: "bg-brand-green-light text-brand-green-dark",
  spam: "bg-error-light text-error",
  archived: "bg-gray-100 text-gray-500",
};

const WORKFLOW_PILL: Record<string, string> = {
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-brand-green-light text-brand-green-dark",
  rejected: "bg-error-light text-error",
  expired: "bg-gray-100 text-gray-500",
  pending: "bg-primary-light text-primary",
};

function getPassword(): string {
  return typeof document !== "undefined"
    ? document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? ""
    : "";
}

function AdminLogin({ onLogin }: { onLogin: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <FormLayout title="Admin Login" subtitle="Enter the admin password to view submissions.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onLogin(pw);
        }}
        className="space-y-4 max-w-sm mx-auto"
      >
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full rounded-[8px] border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
          autoFocus
        />
        <Button type="submit" variant="primary" className="w-full">
          Login
        </Button>
      </form>
    </FormLayout>
  );
}

// One-line preview of a submission's data for the table row.
// Picks the first 2-3 string-ish values so common fields like name/email
// surface without us hard-coding form-specific knowledge.
function previewLine(data: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [, v] of Object.entries(data)) {
    if (parts.length >= 3) break;
    if (typeof v === "string" && v.trim()) parts.push(v.trim().slice(0, 60));
    else if (typeof v === "number") parts.push(String(v));
    else if (
      v &&
      typeof v === "object" &&
      "first" in (v as Record<string, unknown>) &&
      "last" in (v as Record<string, unknown>)
    ) {
      const n = v as { first?: string; last?: string };
      parts.push(`${n.first ?? ""} ${n.last ?? ""}`.trim());
    }
  }
  return parts.filter(Boolean).join(" · ") || "(no data)";
}

export default function SubmissionsPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterFormSlug, setFilterFormSlug] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [knownSlugs, setKnownSlugs] = useState<string[]>([]);

  useEffect(() => {
    const stored =
      typeof document !== "undefined"
        ? document.cookie.match(/admin_token=([^;]+)/)?.[1]
        : null;
    if (stored) {
      setPassword(stored);
      setAuthenticated(true);
    }
  }, []);

  const load = useCallback(
    async (pw: string, signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (filterFormSlug) params.set("form_slug", filterFormSlug);
        if (filterStatus) params.set("status", filterStatus);
        if (search.trim()) params.set("search", search.trim());
        params.set("page", String(page));
        params.set("limit", "50");

        const res = await fetch(`${API_BASE}/api/admin/submissions?${params}`, {
          headers: { "x-admin-password": pw },
          signal,
        });
        if (res.status === 401) {
          setError("Invalid password");
          setAuthenticated(false);
          return;
        }
        if (!res.ok) {
          setError(`Failed to load (${res.status})`);
          return;
        }
        const body = (await res.json()) as { submissions: SubmissionRow[]; total: number };
        setSubmissions(body.submissions);
        setTotal(body.total);
        // Maintain a known-slug set so the form-slug dropdown self-populates
        // from data the admin has actually seen, not a hard-coded list.
        setKnownSlugs((prev) => {
          const next = new Set(prev);
          for (const s of body.submissions) next.add(s.form_slug);
          return Array.from(next).sort();
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoading(false);
      }
    },
    [filterFormSlug, filterStatus, search, page],
  );

  useEffect(() => {
    if (!authenticated || !password) return;
    const ac = new AbortController();
    void load(password, ac.signal);
    return () => ac.abort();
  }, [authenticated, password, load]);

  function handleLogin(pw: string) {
    document.cookie = `admin_token=${pw}; path=/; SameSite=Strict; Secure`;
    setPassword(pw);
    setAuthenticated(true);
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (filterFormSlug) params.set("form_slug", filterFormSlug);
    if (filterStatus) params.set("status", filterStatus);
    params.set("format", "csv");
    // CSV download must include the password — using a hidden form so the
    // browser handles file save naturally without exposing the header in
    // a URL.
    const f = document.createElement("form");
    f.method = "GET";
    f.action = `${API_BASE}/api/admin/submissions?${params}`;
    f.target = "_blank";
    document.body.appendChild(f);
    f.submit();
    document.body.removeChild(f);
  }

  if (!authenticated) return <AdminLogin onLogin={handleLogin} />;

  const totalPages = Math.max(1, Math.ceil(total / 50));

  return (
    <FormLayout title="Submissions" subtitle={`${total} total — newest first`}>
      <div className="flex flex-wrap gap-2 items-end mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Form</label>
          <select
            value={filterFormSlug}
            onChange={(e) => {
              setPage(1);
              setFilterFormSlug(e.target.value);
            }}
            className="rounded-[8px] border border-border px-3 py-1.5 text-sm bg-white"
          >
            <option value="">All forms</option>
            {knownSlugs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => {
              setPage(1);
              setFilterStatus(e.target.value);
            }}
            className="rounded-[8px] border border-border px-3 py-1.5 text-sm bg-white"
          >
            <option value="">Any</option>
            <option value="new">New</option>
            <option value="in_review">In review</option>
            <option value="completed">Completed</option>
            <option value="spam">Spam</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
          <label className="text-xs font-medium text-muted">Search</label>
          <input
            type="search"
            placeholder="Form slug or notes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setPage(1);
            }}
            className="rounded-[8px] border border-border px-3 py-1.5 text-sm bg-white"
          />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          Export CSV
        </Button>
        <Link
          href="/admin/forms"
          className="text-xs text-muted hover:text-primary self-center ml-auto"
        >
          Manage forms →
        </Link>
      </div>

      {error && (
        <div className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error mb-4" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-muted">No submissions match these filters.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted border-b border-border">
                <tr>
                  <th className="text-left py-2 px-2 font-medium">When</th>
                  <th className="text-left py-2 px-2 font-medium">Form</th>
                  <th className="text-left py-2 px-2 font-medium">Status</th>
                  <th className="text-left py-2 px-2 font-medium">Workflow</th>
                  <th className="text-left py-2 px-2 font-medium">Preview</th>
                  <th className="text-right py-2 px-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id} className="border-b border-border/50 hover:bg-gray-50">
                    <td className="py-2 px-2 text-xs text-muted whitespace-nowrap">
                      {new Date(s.created_at).toLocaleString()}
                    </td>
                    <td className="py-2 px-2">
                      <code className="text-xs">{s.form_slug}</code>
                    </td>
                    <td className="py-2 px-2">
                      <span
                        className={`inline-block text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${STATUS_PILL[s.status] ?? ""}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      {s.workflow_state?.status ? (
                        <span
                          title={
                            s.workflow_state.current_step_id
                              ? `step: ${s.workflow_state.current_step_id}`
                              : undefined
                          }
                          className={`inline-block text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${WORKFLOW_PILL[s.workflow_state.status] ?? ""}`}
                        >
                          {s.workflow_state.status.replace("_", " ")}
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-xs text-muted truncate max-w-[300px]">
                      {previewLine(s.data ?? {})}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <Link
                        href={`/admin/submissions/${s.id}`}
                        className="text-primary text-xs font-medium hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4 text-xs text-muted">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </FormLayout>
  );
}
