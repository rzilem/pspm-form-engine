"use client";

import { useEffect, useState, useCallback, useMemo, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/TextInput";
import { TextArea } from "@/components/ui/TextArea";
import { SelectField } from "@/components/ui/SelectField";
import { FieldBuilder } from "@/components/admin/FieldBuilder";
import { DynamicForm } from "@/app/forms/[slug]/DynamicForm";
import {
  fieldDefinitionSchema,
  type FieldDefinition,
  type FormDefinition,
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
  pdf_config: {
    enabled?: boolean;
    template?: "default" | "invoice" | "letter";
    filenamePrefix?: string;
    mergeUploads?: boolean;
    mergeImages?: boolean;
    letterBodyFieldId?: string;
  } | null;
  workflow_config: unknown;
  confirmation_message: string;
  recaptcha_required: boolean;
  width?: "full" | "boxed" | null;
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
  const [width, setWidth] = useState<"full" | "boxed">("full");
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [fieldJsonDraft, setFieldJsonDraft] = useState("[]");
  const [fieldJsonError, setFieldJsonError] = useState<string | null>(null);
  // Count of field_schema entries that failed to parse on load. They are hidden
  // from the visual builder, so saving would silently delete them — this sticky
  // signal blocks the save until a fully-valid Advanced JSON edit clears it.
  // (Unlike fieldJsonError, the visual builder never resets this.)
  const [unparseableCount, setUnparseableCount] = useState(0);
  // Tracks the Advanced JSON <details> open state. Controlled via state (not
  // bound to a derived value) so a re-render while the admin is typing doesn't
  // snap it shut.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [notificationConfigJson, setNotificationConfigJson] = useState('{"rules":[]}');
  const [pdfEnabled, setPdfEnabled] = useState(false);
  const [pdfTemplate, setPdfTemplate] = useState<"default" | "invoice" | "letter">("default");
  const [pdfFilenamePrefix, setPdfFilenamePrefix] = useState("");
  const [pdfMergeUploads, setPdfMergeUploads] = useState(false);
  const [pdfMergeImages, setPdfMergeImages] = useState(false);
  const [pdfLetterBodyFieldId, setPdfLetterBodyFieldId] = useState("");
  const [workflowEnabled, setWorkflowEnabled] = useState(false);
  const [workflowStepsJson, setWorkflowStepsJson] = useState("[]");
  // Preview-only viewport toggle (does NOT persist — `width` above is the
  // saved setting; this just simulates a phone in the preview pane).
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");

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
      setWidth(data.width === "boxed" ? "boxed" : "full");
      const { fields: loadedFields, dropped } = parseFieldSchema(data.field_schema);
      setFields(loadedFields);
      setUnparseableCount(dropped);
      setAdvancedOpen(dropped > 0);
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
      const tpl = data.pdf_config?.template;
      setPdfTemplate(
        tpl === "invoice" || tpl === "letter" ? tpl : "default",
      );
      setPdfFilenamePrefix(data.pdf_config?.filenamePrefix ?? "");
      setPdfMergeUploads(Boolean(data.pdf_config?.mergeUploads));
      setPdfMergeImages(Boolean(data.pdf_config?.mergeImages));
      setPdfLetterBodyFieldId(data.pdf_config?.letterBodyFieldId ?? "");
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
      const open = e.currentTarget.open;
      setAdvancedOpen(open);
      if (open) return;
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
          width,
          field_schema: fields,
          notification_config: notificationConfig,
          pdf_config: {
            enabled: pdfEnabled,
            template: pdfTemplate,
            mergeUploads: pdfMergeUploads,
            mergeImages: pdfMergeImages,
            ...(pdfFilenamePrefix.trim()
              ? { filenamePrefix: pdfFilenamePrefix.trim() }
              : {}),
            ...(pdfTemplate === "letter" && pdfLetterBodyFieldId.trim()
              ? { letterBodyFieldId: pdfLetterBodyFieldId.trim() }
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

  // Build a FormDefinition-shaped object from the in-progress editor state so
  // the right pane renders the REAL form (DynamicForm) exactly as end users
  // will see it. Re-keyed below so adding/removing/retyping a field remounts
  // the preview form and re-registers react-hook-form fields.
  const previewDefinition = useMemo<FormDefinition>(
    () => ({
      id: definition?.id ?? "preview",
      slug: definition?.slug ?? "preview",
      title,
      description: description.trim() || null,
      status: "published",
      field_schema: fields,
      notification_config: { rules: [] },
      pdf_config: {
        enabled: false,
        template: "default",
        mergeUploads: false,
        mergeImages: false,
      },
      workflow_config: { enabled: false, steps: [] },
      confirmation_message: confirmationMessage || "Submitted.",
      recaptcha_required: false,
      width,
      created_by: null,
      created_at: "",
      updated_at: "",
      published_at: null,
    }),
    [definition?.id, definition?.slug, title, description, fields, confirmationMessage, width],
  );
  // Remount the preview when the field SET changes (ids/types) so RHF picks up
  // new fields; label/help/option edits update live without a remount.
  const previewKey = useMemo(
    () => fields.map((f) => `${f.id}:${f.type}`).join("|"),
    [fields],
  );

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 p-6">
        <div className="text-center">
          <p className="text-sm text-error mb-3">{loadError}</p>
          <Link href="/admin/forms" className="text-primary text-sm">
            ← Back to forms
          </Link>
        </div>
      </div>
    );
  }

  if (!definition) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  const statusPill =
    status === "published"
      ? "bg-brand-green-light text-brand-green-dark"
      : status === "archived"
        ? "bg-gray-100 text-gray-500"
        : "bg-yellow-100 text-yellow-800";

  // Preview container width: a phone frame when "mobile", otherwise it follows
  // the form's saved width setting — exactly how it renders embedded vs boxed.
  const previewFrame =
    previewDevice === "mobile"
      ? "max-w-[390px] mx-auto"
      : width === "boxed"
        ? "max-w-2xl mx-auto"
        : "w-full";

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Sticky toolbar */}
      <header className="sticky top-0 z-30 bg-white border-b border-border">
        <div className="h-1 w-full bg-gradient-to-r from-primary via-navy to-brand-green" />
        <div className="px-4 sm:px-5 h-16 flex items-center gap-3">
          <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-primary to-navy grid place-items-center text-white font-bold text-sm">
            PS
          </div>
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Link href="/admin/forms" className="text-muted hover:text-primary no-underline hidden sm:inline">
              Forms
            </Link>
            <span className="text-border hidden sm:inline">/</span>
            <span className="font-semibold text-foreground truncate">{title || definition.slug}</span>
            <span className={`shrink-0 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${statusPill}`}>
              {status}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {saveStatus && <span className="text-xs text-brand-green hidden sm:inline">{saveStatus}</span>}
            {definition.status === "published" && (
              <Link
                href={`/forms/${definition.slug}`}
                target="_blank"
                className="text-sm text-muted hover:text-primary no-underline hidden md:inline"
              >
                Open ↗
              </Link>
            )}
            <Button size="sm" variant="outline" onClick={() => handleSave()} loading={saving}>
              Save
            </Button>
            {definition.status !== "published" ? (
              <Button size="sm" onClick={() => handleSave("published")} loading={saving}>
                Save &amp; publish
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => handleSave("draft")} loading={saving}>
                Unpublish
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Two-pane body */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 min-h-0">
        {/* LEFT: editor */}
        <section className="overflow-y-auto lg:border-r border-border bg-white">
          <div className="p-5 space-y-6 max-w-2xl">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SelectField
                  label="reCAPTCHA"
                  value={recaptchaRequired ? "yes" : "no"}
                  onChange={(e) => setRecaptchaRequired(e.target.value === "yes")}
                  options={[
                    { label: "Required (recommended)", value: "yes" },
                    { label: "Disabled (authenticated portals only)", value: "no" },
                  ]}
                />
                <SelectField
                  label="Layout width"
                  value={width}
                  onChange={(e) => setWidth(e.target.value === "boxed" ? "boxed" : "full")}
                  options={[
                    { label: "Full width (fills the page when embedded)", value: "full" },
                    { label: "Boxed (centered, readable max-width)", value: "boxed" },
                  ]}
                />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Form fields</h2>
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
                open={advancedOpen}
                onToggle={handleAdvancedToggle}
                className="rounded-[8px] border border-border px-3 py-2"
              >
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Advanced: edit fields as JSON
                </summary>
                <div className="mt-3 space-y-2">
                  <p className="text-xs text-muted">
                    The visual builder above is the source of truth. Paste or edit
                    JSON here to bulk-replace the fields — valid changes sync back
                    into the builder.
                  </p>
                  <textarea
                    className="w-full font-mono text-xs rounded-[8px] border border-border bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    rows={14}
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

            {/* Advanced: PDF / notifications / workflow tucked away */}
            <details className="rounded-[8px] border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wider text-muted">
                Advanced: notifications, PDF &amp; approval workflow
              </summary>
              <div className="mt-4 space-y-6">
                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">PDF generation</h3>
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
                    <div className="space-y-4">
                      <SelectField
                        label="PDF template"
                        value={pdfTemplate}
                        onChange={(e) =>
                          setPdfTemplate(
                            e.target.value as "default" | "invoice" | "letter",
                          )
                        }
                        options={[
                          {
                            value: "default",
                            label: "Default — field/value table by section",
                          },
                          {
                            value: "invoice",
                            label: "Invoice — itemized line items + total",
                          },
                          {
                            value: "letter",
                            label: "Letter — letterhead + body paragraphs",
                          },
                        ]}
                      />
                      {pdfTemplate === "letter" && (
                        <SelectField
                          label="Letter body field (optional)"
                          value={pdfLetterBodyFieldId}
                          onChange={(e) => setPdfLetterBodyFieldId(e.target.value)}
                          options={[
                            {
                              value: "",
                              label: "All fields as paragraphs",
                            },
                            ...fields
                              .filter(
                                (f) =>
                                  f.type === "textarea" || f.type === "text",
                              )
                              .map((f) => ({
                                value: f.id,
                                label: f.label || f.id,
                              })),
                          ]}
                          helperText="Pick one long-text field for the letter body, or leave as all fields."
                        />
                      )}
                      <TextInput
                        label="Filename prefix (optional)"
                        value={pdfFilenamePrefix}
                        onChange={(e) => setPdfFilenamePrefix(e.target.value)}
                        placeholder={`${definition.slug}`}
                        helperText="Submission id is appended automatically. Defaults to the form slug."
                      />
                      <label className="flex items-start gap-3 rounded-[8px] border border-border px-4 py-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pdfMergeUploads}
                          onChange={(e) => setPdfMergeUploads(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40 shrink-0"
                        />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            Merge uploaded PDFs into the attachment
                          </p>
                          <p className="text-xs text-muted mt-1">
                            Appends receipt PDFs after the generated pages so staff
                            receive one combined document (Gravity PDF merge_pdfs).
                          </p>
                        </div>
                      </label>
                      {pdfMergeUploads && (
                        <label className="flex items-start gap-3 rounded-[8px] border border-border px-4 py-3 cursor-pointer ml-6">
                          <input
                            type="checkbox"
                            checked={pdfMergeImages}
                            onChange={(e) => setPdfMergeImages(e.target.checked)}
                            className="mt-0.5 w-4 h-4 rounded text-primary accent-primary focus:ring-2 focus:ring-primary/40 shrink-0"
                          />
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              Also embed uploaded images (PNG/JPEG) as pages
                            </p>
                            <p className="text-xs text-muted mt-1">
                              Word/Excel uploads stay separate; only PDFs and images
                              merge.
                            </p>
                          </div>
                        </label>
                      )}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold text-foreground">Notification rules (JSON)</h3>
                  <textarea
                    className="w-full font-mono text-xs rounded-[8px] border border-border bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    rows={8}
                    value={notificationConfigJson}
                    onChange={(e) => setNotificationConfigJson(e.target.value)}
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted">
                    Each rule needs <code>recipients</code> (emails or <code>{`{{field.<id>}}`}</code> tokens) and
                    a <code>subject</code>. Optional <code>body</code> (merge tags:{" "}
                    <code>{`{{field.<id>}}`}</code>, <code>{`{all_fields}`}</code>) overrides the default
                    table body. Optional <code>conditional</code> gates the rule on a field value.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Workflow (Gravity Flow replacement)</h3>
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
                        rows={10}
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
              </div>
            </details>

            {validationError && (
              <pre
                className="rounded-[8px] border border-error bg-error-light px-4 py-3 text-xs text-error whitespace-pre-wrap"
                role="alert"
              >
                {validationError}
              </pre>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
              <Button onClick={() => handleSave()} loading={saving}>
                Save
              </Button>
              {definition.status !== "published" && (
                <Button variant="secondary" onClick={() => handleSave("published")} loading={saving}>
                  Save &amp; publish
                </Button>
              )}
              {definition.status === "published" && (
                <Button variant="outline" onClick={() => handleSave("draft")} loading={saving}>
                  Unpublish
                </Button>
              )}
              {definition.status !== "archived" && (
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm("Archive this form? It will stop accepting submissions.")) {
                      void handleSave("archived");
                    }
                  }}
                  loading={saving}
                  className="!border-error !text-error hover:!bg-error-light"
                >
                  Archive
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT: live preview */}
        <section className="overflow-y-auto bg-gray-100 hidden lg:block">
          <div className="sticky top-0 z-10 bg-gray-100/90 backdrop-blur px-5 py-3 flex flex-wrap items-center gap-2 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Live preview</span>
            <span className="text-[11px] text-muted">
              {width === "full" ? "as embedded · full width" : "boxed"}
            </span>
            <div className="ml-auto flex items-center gap-1 bg-white rounded-lg p-1 border border-border">
              <button
                type="button"
                onClick={() => setPreviewDevice("desktop")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${previewDevice === "desktop" ? "bg-primary text-white" : "text-muted"}`}
              >
                Desktop
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice("mobile")}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${previewDevice === "mobile" ? "bg-primary text-white" : "text-muted"}`}
              >
                Mobile
              </button>
            </div>
          </div>

          <div className="p-6">
            <div className={previewFrame}>
              <div className="rounded-2xl overflow-hidden shadow-sm border border-border bg-white">
                <div className="bg-primary px-6 py-4 text-white">
                  <p className="text-base font-bold leading-tight">PS Property Management</p>
                  <p className="text-[11px] text-white/70">512-251-6122 | psprop.net</p>
                </div>
                <div className="p-6">
                  <h1 className="text-2xl font-bold text-navy">{title || "Untitled form"}</h1>
                  {description.trim() && (
                    <p className="mt-1 text-sm text-muted">{description}</p>
                  )}
                  <div className="mt-5">
                    {fields.length === 0 ? (
                      <p className="text-sm text-muted">Add a field to see it here.</p>
                    ) : (
                      <DynamicForm key={previewKey} definition={previewDefinition} preview />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
