"use client";

/**
 * Two-step Gravity Forms import UI:
 *   1. Paste/upload export JSON, hit Preview.
 *   2. Server returns parsed forms + warnings; admin reviews + edits
 *      slugs, deselects forms they don't want, hits Create. Server
 *      writes the chosen forms as drafts.
 *
 * Stays on form_definitions in `draft` state — admin still has to
 * publish from the per-form edit screen, so a bad import can't
 * accidentally take traffic.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";
import { TextArea } from "@/components/ui/TextArea";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface PreviewForm {
  title: string;
  suggestedSlug: string;
  description: string | null;
  field_schema: unknown[];
  notification_config: { rules: { recipients: string[]; subject: string }[] };
  confirmation_message: string;
  warnings: { fieldLabel: string; fieldType: string; reason: string }[];
  slugReserved: boolean;
}

interface PendingForm extends PreviewForm {
  selected: boolean;
  slug: string; // admin-editable
}

function getPassword(): string {
  return typeof document !== "undefined"
    ? document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? ""
    : "";
}

export default function ImportGfPage() {
  const router = useRouter();
  const [pasted, setPasted] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PendingForm[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{
    created: { id: string; slug: string }[];
    errors: { slug: string; error: string }[];
  } | null>(null);

  async function handlePreview() {
    setError(null);
    setPreview(null);
    setCreated(null);
    let payload: unknown;
    try {
      payload = JSON.parse(pasted);
    } catch {
      setError("That's not valid JSON. Paste the file contents from Forms → Import/Export.");
      return;
    }
    setPreviewing(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms/import-gf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify({ mode: "preview", payload }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        forms?: PreviewForm[];
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `Preview failed (${res.status})`);
        return;
      }
      setPreview(
        (body.forms ?? []).map((f) => ({
          ...f,
          selected: !f.slugReserved,
          slug: f.slugReserved ? `${f.suggestedSlug}-imported` : f.suggestedSlug,
        })),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setPreviewing(false);
    }
  }

  function updateForm(idx: number, patch: Partial<PendingForm>) {
    setPreview((curr) =>
      curr ? curr.map((f, i) => (i === idx ? { ...f, ...patch } : f)) : curr,
    );
  }

  async function handleCreate() {
    if (!preview) return;
    const chosen = preview.filter((f) => f.selected);
    if (chosen.length === 0) {
      setError("Select at least one form to import.");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms/import-gf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify({
          mode: "create",
          forms: chosen.map((f) => ({
            slug: f.slug,
            title: f.title,
            description: f.description,
            field_schema: f.field_schema,
            notification_config: f.notification_config,
            confirmation_message: f.confirmation_message,
            recaptcha_required: true,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        created?: { id: string; slug: string }[];
        errors?: { slug: string; error: string }[];
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `Create failed (${res.status})`);
        return;
      }
      setCreated({
        created: body.created ?? [],
        errors: body.errors ?? [],
      });
      // If everything succeeded, bounce back to the forms list.
      if ((body.errors?.length ?? 0) === 0) {
        setTimeout(() => router.push("/admin/forms"), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <FormLayout
      title="Import from Gravity Forms"
      subtitle="Paste a Gravity Forms export to bulk-create draft forms here."
    >
      <Link href="/admin/forms" className="text-primary text-sm">
        ← Back to forms
      </Link>

      <div className="mt-4 space-y-6">
        {!preview && (
          <section className="space-y-3">
            <p className="text-sm text-muted">
              In WordPress: <strong>Forms → Import/Export → Export Forms</strong>.
              Choose the forms you want, click Download, then open the JSON
              file and paste its contents below. Or paste the response of{" "}
              <code>GET /wp-json/gf/v2/forms</code>.
            </p>
            <TextArea
              label="Gravity Forms export JSON"
              rows={14}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder='{"0": {"id":"3","title":"Contact",...}, "version":"2.7"}'
            />
            <Button onClick={handlePreview} loading={previewing} disabled={!pasted.trim()}>
              Preview import
            </Button>
          </section>
        )}

        {error && (
          <div
            className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {preview && !created && (
          <section className="space-y-4">
            <p className="text-sm text-muted">
              {preview.length} form{preview.length === 1 ? "" : "s"} found. Review,
              edit slugs as needed, then click Create.
            </p>
            <ul className="space-y-3">
              {preview.map((f, idx) => (
                <li
                  key={idx}
                  className="rounded-[8px] border border-border px-4 py-3 space-y-2"
                >
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={f.selected}
                      onChange={(e) => updateForm(idx, { selected: e.target.checked })}
                      className="mt-1 w-4 h-4 rounded text-primary accent-primary shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-navy">{f.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted whitespace-nowrap">/forms/</span>
                        <input
                          type="text"
                          value={f.slug}
                          onChange={(e) => updateForm(idx, { slug: e.target.value })}
                          className="flex-1 rounded-[6px] border border-border px-2 py-1 text-xs font-mono"
                        />
                      </div>
                      <p className="text-xs text-muted mt-2">
                        {f.field_schema.length} field
                        {f.field_schema.length === 1 ? "" : "s"} ·{" "}
                        {f.notification_config.rules.length} notification rule
                        {f.notification_config.rules.length === 1 ? "" : "s"}
                      </p>
                      {f.warnings.length > 0 && (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-yellow-700">
                            {f.warnings.length} field
                            {f.warnings.length === 1 ? "" : "s"} skipped
                          </summary>
                          <ul className="mt-1 pl-4 list-disc text-muted">
                            {f.warnings.map((w, i) => (
                              <li key={i}>
                                <strong>{w.fieldLabel}</strong> ({w.fieldType}):{" "}
                                {w.reason}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <Button onClick={handleCreate} loading={creating}>
                Create {preview.filter((f) => f.selected).length} draft
                {preview.filter((f) => f.selected).length === 1 ? "" : "s"}
              </Button>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Start over
              </Button>
            </div>
          </section>
        )}

        {created && (
          <section className="space-y-3">
            {created.created.length > 0 && (
              <div className="rounded-[8px] border border-brand-green bg-brand-green-light px-4 py-3 text-sm text-brand-green">
                Created {created.created.length} draft form
                {created.created.length === 1 ? "" : "s"}. Returning to the
                forms list…
              </div>
            )}
            {created.errors.length > 0 && (
              <div className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error">
                <p className="font-medium mb-1">
                  {created.errors.length} form
                  {created.errors.length === 1 ? "" : "s"} could not be
                  imported:
                </p>
                <ul className="list-disc pl-5">
                  {created.errors.map((e, i) => (
                    <li key={i}>
                      <code>{e.slug}</code>: {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </FormLayout>
  );
}
