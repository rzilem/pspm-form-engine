"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { FormDefinition } from "@/lib/form-definitions";

const SAVE_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api/save-progress`
  : "/api/save-progress";

interface SaveAndContinueButtonProps {
  definition: FormDefinition;
  formSlug: string;
  getValues: () => Record<string, unknown>;
  currentPage?: number;
  resumeToken: string | undefined;
  onToken: (token: string) => void;
  getHoneypotValue: () => string;
  preview?: boolean;
  className?: string;
}

export function SaveAndContinueButton({
  definition,
  formSlug,
  getValues,
  currentPage,
  resumeToken,
  onToken,
  getHoneypotValue,
  preview = false,
  className = "",
}: SaveAndContinueButtonProps) {
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<{
    resumeUrl: string;
    token: string;
    emailed: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSave = useCallback(async () => {
    if (preview || !definition.save_resume_enabled) return;
    setSaving(true);
    setError(null);
    try {
      const data = getValues();
      const emailField = definition.field_schema.find((f) => f.type === "email");
      const emailRaw = emailField ? data[emailField.id] : undefined;
      const emailTo =
        typeof emailRaw === "string" && emailRaw.includes("@")
          ? emailRaw.trim()
          : undefined;

      const response = await fetch(SAVE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: formSlug,
          data,
          currentPage,
          token: resumeToken,
          hp: getHoneypotValue(),
          ...(emailTo ? { emailTo } : {}),
        }),
      });

      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        token?: string;
        resumeUrl?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? `Save failed (${response.status})`);
      }

      if (!body.token || !body.resumeUrl) {
        throw new Error("Save succeeded but no resume link was returned");
      }

      onToken(body.token);
      setPanel({
        resumeUrl: body.resumeUrl,
        token: body.token,
        emailed: Boolean(emailTo),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save progress");
    } finally {
      setSaving(false);
    }
  }, [
    preview,
    definition.save_resume_enabled,
    definition.field_schema,
    getValues,
    formSlug,
    currentPage,
    resumeToken,
    getHoneypotValue,
    onToken,
  ]);

  const handleCopy = useCallback(async () => {
    if (!panel?.resumeUrl) return;
    try {
      await navigator.clipboard.writeText(panel.resumeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [panel?.resumeUrl]);

  if (!definition.save_resume_enabled || preview) return null;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="md"
        loading={saving}
        onClick={() => void handleSave()}
      >
        Save and continue later
      </Button>

      {error && (
        <p className="mt-2 text-sm text-error" role="alert">
          {error}
        </p>
      )}

      {panel && (
        <div
          className="mt-4 rounded-[8px] border border-border bg-gray-50 px-4 py-3 space-y-3"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-medium text-navy">Your progress is saved</p>
          <p className="text-sm text-muted">
            Bookmark this link or copy it to finish later. It expires in 30 days.
            {panel.emailed && " We also emailed the link to you."}
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={panel.resumeUrl}
              className="flex-1 text-xs font-mono rounded-[8px] border border-border bg-white px-3 py-2 text-foreground"
              aria-label="Resume link"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              {copied ? "Copied!" : "Copy link"}
            </Button>
          </div>
          <button
            type="button"
            className="text-xs text-muted hover:text-foreground underline"
            onClick={() => setPanel(null)}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}