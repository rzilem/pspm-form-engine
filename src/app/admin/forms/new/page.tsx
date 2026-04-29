"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function NewFormPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get admin password from cookie
  function getPassword(): string {
    return typeof document !== "undefined"
      ? document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? ""
      : "";
  }

  // Auto-derive slug from title only on first edit so admins can customize
  function handleTitleChange(value: string) {
    setTitle(value);
    if (slug === "" || slug === slugify(title)) {
      setSlug(slugify(value));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify({
          slug,
          title,
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      const body = (await res.json()) as { id: string };
      router.push(`/admin/forms/${body.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormLayout title="New form" subtitle="Pick a slug + title. You'll add fields on the next screen.">
      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <TextInput
          label="Title"
          required
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="e.g. Maintenance Request"
        />
        <TextInput
          label="Slug"
          required
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          helperText="Lowercase letters, numbers, hyphens. The form will live at /forms/<slug>."
          placeholder="maintenance-request"
        />
        <TextArea
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          helperText="Shown above the form on the public page."
        />
        {error && (
          <div className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error" role="alert">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={submitting}>
            Create form
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/admin/forms")}>
            Cancel
          </Button>
        </div>
      </form>
    </FormLayout>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
