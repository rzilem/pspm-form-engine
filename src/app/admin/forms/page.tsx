"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";

interface FormRow {
  id: string;
  slug: string;
  title: string;
  status: "draft" | "published" | "archived";
  updated_at: string;
  published_at: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

const STATUS_PILL: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-800",
  published: "bg-brand-green-light text-brand-green-dark",
  archived: "bg-gray-100 text-gray-500",
};

function AdminLogin({ onLogin }: { onLogin: (password: string) => void }) {
  const [password, setPassword] = useState("");
  return (
    <FormLayout title="Admin Login" subtitle="Enter the admin password to manage forms.">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onLogin(password);
        }}
        className="space-y-4 max-w-sm mx-auto"
      >
        <div>
          <label htmlFor="admin-password" className="text-sm font-medium text-foreground block mb-1">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-[8px] border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary"
            autoFocus
          />
        </div>
        <Button type="submit" variant="primary" className="w-full">
          Login
        </Button>
      </form>
    </FormLayout>
  );
}

export default function FormsAdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Restore session from cookie
  useEffect(() => {
    const stored = typeof document !== "undefined"
      ? document.cookie.match(/admin_token=([^;]+)/)?.[1]
      : null;
    if (stored) {
      setPassword(stored);
      setAuthenticated(true);
    }
  }, []);

  const loadForms = useCallback(
    async (pw: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/admin/forms`, {
          headers: { "x-admin-password": pw },
        });
        if (res.status === 401) {
          setError("Invalid password");
          setAuthenticated(false);
          return;
        }
        if (!res.ok) {
          setError(`Failed to load forms (${res.status})`);
          return;
        }
        const body = (await res.json()) as { forms: FormRow[] };
        setForms(body.forms);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Network error");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (authenticated && password) loadForms(password);
  }, [authenticated, password, loadForms]);

  function handleLogin(pw: string) {
    document.cookie = `admin_token=${pw}; path=/; SameSite=Strict; Secure`;
    setPassword(pw);
    setAuthenticated(true);
  }

  if (!authenticated) return <AdminLogin onLogin={handleLogin} />;

  return (
    <FormLayout
      title="Forms"
      subtitle="Manage published forms, edit field schema, and route submissions."
    >
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">
          {forms.length} form{forms.length === 1 ? "" : "s"} total
        </p>
        <Link
          href="/admin/forms/new"
          className="inline-flex items-center gap-2 rounded-[8px] bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover no-underline"
        >
          + New form
        </Link>
      </div>

      {error && (
        <div
          className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error mb-4"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : forms.length === 0 ? (
        <p className="text-sm text-muted">
          No forms yet. <Link href="/admin/forms/new" className="text-primary">Create one</Link>.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted border-b border-border">
              <tr>
                <th className="text-left py-2 px-2 font-medium">Title</th>
                <th className="text-left py-2 px-2 font-medium">Slug</th>
                <th className="text-left py-2 px-2 font-medium">Status</th>
                <th className="text-left py-2 px-2 font-medium">Updated</th>
                <th className="text-right py-2 px-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id} className="border-b border-border/50 hover:bg-gray-50">
                  <td className="py-2 px-2 font-medium text-navy">{f.title}</td>
                  <td className="py-2 px-2">
                    <code className="text-xs text-muted">/forms/{f.slug}</code>
                  </td>
                  <td className="py-2 px-2">
                    <span className={`inline-block text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 ${STATUS_PILL[f.status] ?? STATUS_PILL.draft}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-muted text-xs">
                    {new Date(f.updated_at).toLocaleDateString()}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <Link
                      href={`/admin/forms/${f.id}/edit`}
                      className="text-primary text-xs font-medium hover:underline mr-3"
                    >
                      Edit
                    </Link>
                    {f.status === "published" && (
                      <Link
                        href={`/forms/${f.slug}`}
                        target="_blank"
                        className="text-xs text-muted hover:text-primary"
                      >
                        View ↗
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </FormLayout>
  );
}
