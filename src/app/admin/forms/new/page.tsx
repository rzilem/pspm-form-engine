"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import type { FieldDefinition } from "@/lib/form-definitions";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export default function NewFormPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  function getPassword(): string {
    return typeof document !== "undefined"
      ? document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? ""
      : "";
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/forms/generate`, {
          headers: { "x-admin-password": getPassword() },
        });
        if (cancelled) return;
        if (res.status === 401) {
          setAiAvailable(false);
          return;
        }
        if (res.status === 503 || !res.ok) {
          setAiAvailable(false);
          return;
        }
        const body = (await res.json()) as { available?: boolean };
        setAiAvailable(Boolean(body.available));
      } catch {
        if (!cancelled) setAiAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  async function handleAiGenerate() {
    const prompt = aiPrompt.trim();
    if (!prompt) {
      setAiError("Describe the form you want to create.");
      return;
    }
    setAiError(null);
    setAiGenerating(true);
    try {
      const genRes = await fetch(`${API_BASE}/api/admin/forms/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify({ prompt }),
      });

      if (genRes.status === 503) {
        setAiAvailable(false);
        setAiError("AI generation is not configured on this server.");
        return;
      }

      const genBody = (await genRes.json().catch(() => ({}))) as {
        title?: string;
        description?: string;
        fields?: FieldDefinition[];
        error?: string;
      };

      if (!genRes.ok) {
        setAiError(genBody.error ?? `Generation failed (${genRes.status})`);
        return;
      }

      if (!genBody.title || !Array.isArray(genBody.fields)) {
        setAiError("Unexpected response from the generator.");
        return;
      }

      const draftSlug = slugify(genBody.title) || "ai-draft";
      const createRes = await fetch(`${API_BASE}/api/admin/forms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify({
          slug: draftSlug,
          title: genBody.title,
          description: genBody.description?.trim() || undefined,
        }),
      });

      if (!createRes.ok) {
        const body = (await createRes.json().catch(() => ({}))) as { error?: string };
        setAiError(body.error ?? `Could not create draft (${createRes.status})`);
        return;
      }

      const created = (await createRes.json()) as { id: string };
      const patchRes = await fetch(`${API_BASE}/api/admin/forms/${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify({
          field_schema: genBody.fields,
          description: genBody.description?.trim() || null,
          status: "draft",
        }),
      });

      if (!patchRes.ok) {
        const body = (await patchRes.json().catch(() => ({}))) as { error?: string };
        setAiError(
          body.error ??
            "Draft was created but fields could not be saved. Open the form in the editor to add fields manually.",
        );
        router.push(`/admin/forms/${created.id}/edit`);
        return;
      }

      router.push(`/admin/forms/${created.id}/edit`);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Network error");
    } finally {
      setAiGenerating(false);
    }
  }

  return (
    <FormLayout title="New form" subtitle="Pick a slug + title, or generate a draft with AI to review.">
      {aiAvailable && (
        <section
          className="mb-8 max-w-xl rounded-[8px] border border-pspmBlue/30 bg-pspmBlue/5 px-4 py-4"
          aria-labelledby="ai-generate-heading"
        >
          <h2 id="ai-generate-heading" className="text-base font-semibold text-foreground">
            ✨ Generate with AI
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe the form in plain English. You&apos;ll get a <strong>draft</strong> to review in the
            builder — nothing is published automatically.
          </p>
          <div className="mt-3 space-y-3">
            <TextArea
              label="What should this form collect?"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={4}
              placeholder="e.g. A pool reservation request with name, unit number, date, number of guests, and an agreement checkbox"
              disabled={aiGenerating}
            />
            {aiError && (
              <div
                className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
                role="alert"
              >
                {aiError}
              </div>
            )}
            <Button type="button" loading={aiGenerating} onClick={handleAiGenerate}>
              Generate draft
            </Button>
          </div>
        </section>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <p className="text-sm font-medium text-foreground">Or create manually</p>
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