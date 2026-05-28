"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FormLayout } from "@/components/forms/FormLayout";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";
import { FieldBuilder } from "@/components/admin/FieldBuilder";
import {
  fieldDefinitionSchema,
  type FieldDefinition,
} from "@/lib/form-definitions";
import { z } from "zod";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// Tolerant guard for the JSONB field_schema coming back from the API as
// `unknown`. Drops anything that isn't a valid FieldDefinition rather than
// throwing, so a partially-malformed row still loads into the builder.
const fieldArraySchema = z.array(fieldDefinitionSchema);

function parseFieldSchema(raw: unknown): { fields: FieldDefinition[]; dropped: number } {
  // null/undefined is a legitimately empty form (no fields yet).
  if (raw === null || raw === undefined) return { fields: [], dropped: 0 };
  // A non-array field_schema is corrupted. Flag it as unparseable so the editor
  // blocks saving (which would overwrite it with []) until the admin repairs it.
  if (!Array.isArray(raw)) return { fields: [], dropped: 1 };
  const result = fieldArraySchema.safeParse(raw);
  if (result.success) return { fields: result.data, dropped: 0 };
  // Fall back to per-item parsing so one bad field doesn't blank the form.
  // Count the entries we couldn't parse so the editor can block saving (which
  // would otherwise permanently drop them) until they're repaired.
  const out: FieldDefinition[] = [];
  let dropped = 0;
  for (const item of raw) {
    const parsed = fieldDefinitionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else dropped++;
  }
  return { fields: out, dropped };
}

interface FormDefinitionRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  field_schema: unknown;
  notification_config: unknown;
  pdf_config: { enabled?: boolean; template?: string; filenamePrefix?: string } | null;
  workflow_config: unknown;
  confirmation_message: string;
  recaptcha_required: boolean;
  published_at: string | null;
}

function getPassword(): string {
  return typeof document !== "undefined"
    ? document.cookie.match(/admin_token=([^;]+)/)?.[1] ?? ""
    : "";
}

export default function EditFormPage({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 16 unwraps async params at the client boundary via React.use().
  const { id } = use(params);
  const router = useRouter();

  const [definition, setDefinition] = useState<FormDefinitionRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Editable form state — mirrors definition until save
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"draft" | "published" | "archived">("draft");
  const [confirmationMessage, setConfirmationMessage] = useState("");
  const [recaptchaRequired, setRecaptchaRequired] = useState(true);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [fieldJsonDraft, setFieldJsonDraft] = useState("[]");
  const [fieldJsonError, setFieldJsonError] = useState<string | null>(null);
  // Count of field_schema entries that failed to parse on load. They are hidden
  // from the visual builder, so saving would silently delete them — this sticky
  // signal blocks the save until a fully-valid Advanced JSON edit clears it.
  // (Unlike fieldJsonError, the visual builder never resets this.)
  const [unparseableCount, setUnparseableCount] = useState(0);
  const [notificationConfigJson, setNotificationConfigJson] = useState('{"rules":[]}');
  const [pdfEnabled, setPdfEnabled] = useState(false);
  const [pdfFilenamePrefix, setPdfFilenamePrefix] = useState("");
  const [workflowEnabled, setWorkflowEnabled] = useState(false);
  const [workflowStepsJson, setWorkflowStepsJson] = useState("[]");

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/api/admin/forms/${id}`, {
        headers: { "x-admin-password": getPassword() },
      });
      if (res.status === 401) {
        router.push("/admin/forms");
        return;
      }
      if (!res.ok) {
        setLoadError(`Failed to load form (${res.status})`);
        return;
      }
      const data = (await res.json()) as FormDefinitionRow;
      setDefinition(data);
      setTitle(data.title);
      setDescription(data.description ?? "");
      setStatus(data.status);
      setConfirmationMessage(data.confirmation_message);
      setRecaptchaRequired(data.recaptcha_required);
      const { fields: loadedFields, dropped } = parseFieldSchema(data.field_schema);
      setFields(loadedFields);
      setUnparseableCount(dropped);
      if (dropped > 0) {
        // Surface the RAW schema (malformed entries included) in Advanced JSON
        // so the admin can repair them; the save is blocked until they do.
        setFieldJsonDraft(JSON.stringify(data.field_schema, null, 2));
        setFieldJsonError(
          `${dropped} field${dropped === 1 ? "" : "s"} could not be parsed and ${dropped === 1 ? "is" : "are"} hidden from the visual builder. Fix ${dropped === 1 ? "it" : "them"} in the Advanced JSON below before saving — saving now would delete ${dropped === 1 ? "it" : "them"}.`,
        );
      } else {
        setFieldJsonDraft(JSON.stringify(loadedFields, null, 2));
        setFieldJsonError(null);
      }
      setNotificationConfigJson(
        JSON.stringify(data.notification_config ?? { rules: [] }, null, 2),
      );
      setPdfEnabled(Boolean(data.pdf_config?.enabled));
      setPdfFilenamePrefix(data.pdf_config?.filenamePrefix ?? "");
      const wf = (data.workflow_config ?? {}) as {
        enabled?: boolean;
        steps?: unknown;
      };
      setWorkflowEnabled(Boolean(wf.enabled));
      setWorkflowStepsJson(JSON.stringify(wf.steps ?? [], null, 2));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Network error");
    }
  }, [id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Visual builder is the source of truth. Mirror every change into the
  // Advanced JSON view and clear any stale parse error.
  const handleFieldsChange = useCallback(
    (next: FieldDefinition[]) => {
      // While unparseable fields remain, the visual builder is locked — applying
      // its edits here would overwrite the raw JSON draft and strand the
      // malformed entries the admin still needs to repair.
      if (unparseableCount > 0) return;
      setFields(next);
      setFieldJsonDraft(JSON.stringify(next, null, 2));
      setFieldJsonError(null);
    },
    [unparseableCount],
  );

  // Advanced JSON edits flow back into the builder when they parse against the
  // FieldDefinition contract; otherwise we surface the error and leave the
  // builder untouched.
  const handleFieldJsonChange = useCallback((text: string) => {
    setFieldJsonDraft(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setFieldJsonError("Invalid JSON.");
      return;
    }
    const result = fieldArraySchema.safeParse(parsed);
    if (!result.success) {
      setFieldJsonError(
        "JSON parsed but does not match the field schema (each field needs id, label, and a valid type).",
      );
      return;
    }
    setFieldJsonError(null);
    setFields(result.data);
    // A fully-valid array means every field now conforms — the previously
    // unparseable entries (if any) have been repaired, so clear the block.
    setUnparseableCount(0);
  }, []);

  // Collapsing the Advanced JSON section discards an invalid draft and reverts
  // to the visual builder's fields, so a bad JSON edit can't permanently block
  // saves. Skipped in repair mode (unparseableCount > 0), where the raw schema
  // must persist until the admin fixes it.
  const handleAdvancedToggle = useCallback(
    (e: React.SyntheticEvent<HTMLDetailsElement>) => {
      if (e.currentTarget.open) return;
      if (unparseableCount > 0) return;
      if (fieldJsonError) {
        setFieldJsonDraft(JSON.stringify(fields, null, 2));
        setFieldJsonError(null);
      }
    },
    [fields, fieldJsonError, unparseableCount],
  );

  async function handleSave(targetStatus?: "draft" | "published" | "archived") {
    setSaving(true);
    setSaveStatus(null);
    setValidationError(null);
    try {
      // The visual FieldBuilder is the source of truth for fields. If the
      // Advanced JSON view has an unresolved parse error, block the save so
      // we don't silently persist stale field state.
      if (unparseableCount > 0) {
        setValidationError(
          `${unparseableCount} field${unparseableCount === 1 ? "" : "s"} could not be parsed and ${unparseableCount === 1 ? "is" : "are"} hidden from the visual builder. Open the Advanced JSON section below and fix ${unparseableCount === 1 ? "it" : "them"} before saving — saving now would permanently delete ${unparseableCount === 1 ? "it" : "them"}.`,
        );
        return;
      }
      if (fieldJsonError) {
        setValidationError(
          "Field schema (Advanced JSON) is not valid JSON. Fix it or collapse the Advanced section to use the visual builder.",
        );
        return;
      }
      // Parse the remaining JSON textareas locally first so we can show a
      // clean error before round-tripping to the server.
      let notificationConfig: unknown;
      try {
        notificationConfig = JSON.parse(notificationConfigJson);
      } catch {
        setValidationError("Notification config is not valid JSON.");
        return;
      }
      let workflowSteps: unknown;
      try {
        workflowSteps = JSON.parse(workflowStepsJson);
      } catch {
        setValidationError("Workflow steps are not valid JSON.");
        return;
      }

      const res = await fetch(`${API_BASE}/api/admin/forms/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": getPassword(),
        },
        body: JSON.stringify({
          title,
          description: description.trim() || null,
          status: targetStatus ?? status,
          confirmation_message: confirmationMessage,
          recaptcha_required: recaptchaRequired,
          field_schema: fields,
          notification_config: notificationConfig,
          pdf_config: {
            enabled: pdfEnabled,
            template: "default",
            ...(pdfFilenamePrefix.trim()
              ? { filenamePrefix: pdfFilenamePrefix.trim() }
              : {}),
          },
          workflow_config: {
            enabled: workflowEnabled,
            steps: workflowSteps,
          },
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          issues?: Array<{ path: string; message: string }>;
        };
        if (body.issues && body.issues.length > 0) {
          setValidationError(
            body.issues.map((i) => `${i.path || "(root)"}: ${i.message}`).join("\n"),
          );
        } else {
          setValidationError(body.error ?? `Save failed (${res.status})`);
        }
        return;
      }

      const result = (await res.json()) as { status: string; published_at: string | null };
      if (targetStatus) setStatus(targetStatus);
      setSaveStatus(`Saved (${result.status})`);
      // Re-load to get any server-applied fields like published_at
      await load();
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <FormLayout title="Edit form" subtitle={loadError}>
        <Link href="/admin/forms" className="text-primary text-sm">
          ← Back to forms
        </Link>
      </FormLayout>
    );
  }

  if (!definition) {
    return <FormLayout title="Edit form"><p className="text-sm text-muted">Loading…</p></FormLayout>;
  }

  return (
    <FormLayout title={`Edit: ${title || definition.slug}`} subtitle={`/forms/${definition.slug}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <Link href="/admin/forms" className="text-primary text-sm">
          ← Back to forms
        </Link>
        <div className="flex items-center gap-2">
          {definition.status === "published" && (
            <Link
              href={`/forms/${definition.slug}`}
              target="_blank"
              className="text-sm text-muted hover:text-primary no-underline"
            >
              Preview ↗
            </Link>
          )}
          {saveStatus && <span className="text-xs text-brand-green">{saveStatus}</span>}
        </div>
      </div>

      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Metadata</h2>
          <TextInput label="Title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <TextArea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
          <TextArea
            label="Confirmation message"
            value={confirmationMessage}
            onChange={(e) => setConfirmationMessage(e.target.value)}
            rows={2}
            helperText="Shown after a successful submission."
          />
          <SelectField
            label="reCAPTCHA"
            value={recaptchaRequired ? "yes" : "no"}
            onChange={(e) => setRecaptchaRequired(e.target.value === "yes")}
            options={[
              { label: "Required (recommended)", value: "yes" },
              { label: "Disabled (authenticated portals only)", value: "no" },
            ]}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            PDF generation
          </h2>
          <label className="flex items-start gap-3 rounded-[8px] border border-border px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={pdfEnabled}
              onChange={(e) => setPdfEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-foreground">
                Generate a branded PDF for each submission
              </p>
              <p className="text-xs text-muted mt-1">
                Attached to the admin notification email. Useful for letter
                templates, payment plan requests, and anything you&rsquo;d previously
                send to Gravity PDF.
              </p>
            </div>
          </label>
          {pdfEnabled && (
            <TextInput
              label="Filename prefix (optional)"
              value={pdfFilenamePrefix}
              onChange={(e) => setPdfFilenamePrefix(e.target.value)}
              placeholder={`${definition.slug}`}
              helperText="Submission id is appended automatically. Defaults to the form slug."
            />
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Form fields
          </h2>
          {unparseableCount > 0 ? (
            <div
              className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-sm text-error"
              role="alert"
            >
              {unparseableCount} field{unparseableCount === 1 ? "" : "s"} in this
              form couldn&rsquo;t be parsed and {unparseableCount === 1 ? "is" : "are"}{" "}
              hidden from the visual builder. The builder is locked until you
              repair the raw definition in <strong>Advanced: edit as JSON</strong>{" "}
              below — saving now would permanently delete{" "}
              {unparseableCount === 1 ? "it" : "them"}.
            </div>
          ) : (
            <FieldBuilder value={fields} onChange={handleFieldsChange} />
          )}

          <details
            open={unparseableCount > 0}
            onToggle={handleAdvancedToggle}
            className="rounded-[8px] border border-border px-3 py-2"
          >
            <summary className="cursor-pointer text-sm font-medium text-foreground">
              Advanced: edit as JSON
            </summary>
            <div className="mt-3 space-y-2">
              <p className="text-xs text-muted">
                The visual builder above is the source of truth. Paste or edit
                JSON here to bulk-replace the fields — valid changes sync back
                into the builder.
              </p>
              <textarea
                className="w-full font-mono text-xs rounded-[8px] border border-border bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                rows={16}
                value={fieldJsonDraft}
                onChange={(e) => handleFieldJsonChange(e.target.value)}
                spellCheck={false}
              />
              {fieldJsonError && (
                <p className="text-xs text-error" role="alert">
                  {fieldJsonError}
                </p>
              )}
            </div>
          </details>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Notification rules (JSON)
          </h2>
          <textarea
            className="w-full font-mono text-xs rounded-[8px] border border-border bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
            rows={10}
            value={notificationConfigJson}
            onChange={(e) => setNotificationConfigJson(e.target.value)}
            spellCheck={false}
          />
          <p className="text-xs text-muted">
            Each rule needs <code>recipients</code> (emails or <code>{`{{field.<id>}}`}</code> tokens) and
            a <code>subject</code>. Optional <code>conditional</code> gates the rule on a field value.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Workflow (Gravity Flow replacement)
          </h2>
          <label className="flex items-start gap-3 rounded-[8px] border border-border px-4 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={workflowEnabled}
              onChange={(e) => setWorkflowEnabled(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-foreground">
                Route every submission through approval steps
              </p>
              <p className="text-xs text-muted mt-1">
                Each submission emits a magic-link email at each step. The
                approver clicks <strong>Approve</strong>/<strong>Reject</strong>/<strong>Send back</strong>{" "}
                &mdash; no login. Tokens expire in 30 days.
              </p>
            </div>
          </label>
          {workflowEnabled && (
            <>
              <textarea
                className="w-full font-mono text-xs rounded-[8px] border border-border bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                rows={12}
                value={workflowStepsJson}
                onChange={(e) => setWorkflowStepsJson(e.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-muted">
                Array of steps. Each step needs <code>id</code>,{" "}
                <code>label</code>, and an <code>assignee</code> object:{" "}
                <code>{`{type:"literal",email:"..."}`}</code>,{" "}
                <code>{`{type:"field_email",fieldId:"..."}`}</code>, or{" "}
                <code>{`{type:"admin_fallback"}`}</code>. Optional:{" "}
                <code>actions</code>, <code>due_in_days</code>,{" "}
                <code>email_subject</code>, <code>comment_loop_back</code>.
              </p>
            </>
          )}
        </section>

        {validationError && (
          <pre
            className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-xs text-error whitespace-pre-wrap"
            role="alert"
          >
            {validationError}
          </pre>
        )}

        <div className="flex flex-wrap gap-2 sticky bottom-0 bg-white py-3 border-t border-border">
          <Button onClick={() => handleSave()} loading={saving}>
            Save
          </Button>
          {definition.status !== "published" && (
            <Button variant="secondary" onClick={() => handleSave("published")} loading={saving}>
              Save & publish
            </Button>
          )}
          {definition.status === "published" && (
            <Button variant="secondary" onClick={() => handleSave("draft")} loading={saving}>
              Unpublish
            </Button>
          )}
          {definition.status !== "archived" && (
            <Button
              variant="secondary"
              onClick={() => {
                if (confirm("Archive this form? It will stop accepting submissions.")) {
                  void handleSave("archived");
                }
              }}
              loading={saving}
            >
              Archive
            </Button>
          )}
        </div>
      </div>
    </FormLayout>
  );
}
