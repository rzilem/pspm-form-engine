"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UploadedFile } from "@/lib/form-definitions";

interface FormFieldError {
  message?: string;
}

interface DynamicFileUploadProps {
  name: string;
  label: string;
  formSlug: string;
  required?: boolean;
  multiple?: boolean;
  helpText?: string;
  error?: FormFieldError;
  value?: UploadedFile[];
  onChange?: (files: UploadedFile[]) => void;
}

interface PendingFile {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  uploaded?: UploadedFile;
  error?: string;
}

const MAX_BYTES = 26214400; // 25 MB

/**
 * Drop-target wrapper that streams files to /api/upload as soon as they're
 * picked, then surfaces the resulting paths via onChange so react-hook-form
 * keeps an up-to-date array of UploadedFile descriptors.
 *
 * Why upload on select rather than submit:
 *  - The submission jsonb only stores the path (not the bytes), so the
 *    upload has to land somewhere ahead of submit anyway.
 *  - Lets us show progress and reject too-large/wrong-type files before
 *    the user fills out the rest of the form.
 *
 * Session id: a per-tab UUID held in sessionStorage. All files from one
 * sitting share the same upload-sessions/<sessionId>/ prefix so admins
 * can clean up abandoned sessions in bulk.
 */
export function DynamicFileUpload({
  name,
  label,
  formSlug,
  required,
  multiple = true,
  helpText,
  error,
  value,
  onChange,
}: DynamicFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const sessionId = useMemo(() => getOrCreateSessionId(), []);

  // Hydrate from external value (e.g., react-hook-form defaultValues).
  // Only runs when value is non-empty and pending is empty so we don't
  // clobber an in-progress upload state.
  useEffect(() => {
    if (value && value.length > 0 && pending.length === 0) {
      setPending(
        value.map((u) => ({
          id: u.path,
          file: new File([], u.filename, { type: u.mimeType }),
          status: "done",
          uploaded: u,
        })),
      );
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emitChange = useCallback(
    (next: PendingFile[]) => {
      const done = next
        .filter((p): p is PendingFile & { uploaded: UploadedFile } =>
          p.status === "done" && Boolean(p.uploaded),
        )
        .map((p) => p.uploaded);
      onChange?.(done);
    },
    [onChange],
  );

  const uploadOne = useCallback(
    async (entry: PendingFile) => {
      const fd = new FormData();
      fd.append("form_slug", formSlug);
      fd.append("session_id", sessionId);
      fd.append("file", entry.file);

      try {
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Upload failed (${res.status})`);
        }
        const uploaded = (await res.json()) as UploadedFile;
        setPending((curr) => {
          const next = curr.map((p) =>
            p.id === entry.id ? { ...p, status: "done" as const, uploaded } : p,
          );
          emitChange(next);
          return next;
        });
      } catch (err) {
        setPending((curr) =>
          curr.map((p) =>
            p.id === entry.id
              ? {
                  ...p,
                  status: "error" as const,
                  error: err instanceof Error ? err.message : "Upload failed",
                }
              : p,
          ),
        );
      }
    },
    [emitChange, formSlug, sessionId],
  );

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const accepted: PendingFile[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.size > MAX_BYTES) continue;
        accepted.push({
          id: `${Date.now()}-${i}-${f.name}`,
          file: f,
          status: "uploading",
        });
      }
      if (accepted.length === 0) return;

      setPending((curr) => {
        const next = multiple ? [...curr, ...accepted] : accepted.slice(0, 1);
        return next;
      });

      for (const entry of accepted) {
        void uploadOne(entry);
      }
    },
    [multiple, uploadOne],
  );

  const removeFile = useCallback(
    (id: string) => {
      setPending((curr) => {
        const next = curr.filter((p) => p.id !== id);
        emitChange(next);
        return next;
      });
    },
    [emitChange],
  );

  const inputId = `dyn-upload-${name}`;
  const errorId = `${inputId}-error`;
  const isUploading = pending.some((p) => p.status === "uploading");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-error ml-0.5" aria-hidden="true">*</span>}
      </label>

      <div
        role="button"
        tabIndex={0}
        aria-label={`Upload files for ${label}. Drag and drop or click to select.`}
        aria-describedby={error ? errorId : undefined}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          addFiles(e.dataTransfer.files);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed
          px-6 py-8 cursor-pointer transition-colors text-center
          ${dragActive
            ? "border-primary bg-primary/5"
            : error
              ? "border-error bg-error-light"
              : "border-border hover:border-primary/50 hover:bg-primary/[0.02]"
          }`}
      >
        <p className="text-sm text-muted">
          <span className="font-medium text-primary">Click to upload</span> or drag and drop
        </p>
        <p className="text-xs text-muted mt-1">
          Max 25MB per file · PDF, images, Office docs
        </p>
        {helpText && <p className="text-xs text-muted mt-1">{helpText}</p>}
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple={multiple}
        onChange={(e) => addFiles(e.target.files)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {pending.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Uploaded files">
          {pending.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-[8px] border border-border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate">
                  {p.uploaded?.filename ?? p.file.name}
                </span>
                {p.status === "uploading" && (
                  <span className="text-xs text-muted shrink-0">Uploading…</span>
                )}
                {p.status === "error" && (
                  <span className="text-xs text-error shrink-0">{p.error}</span>
                )}
                {p.status === "done" && (
                  <span className="text-xs text-brand-green shrink-0">Ready</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeFile(p.id)}
                className="text-muted hover:text-error transition-colors ml-2 shrink-0"
                aria-label={`Remove ${p.file.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {isUploading && (
        <p className="text-xs text-muted" aria-live="polite">
          Uploading… please wait before submitting.
        </p>
      )}

      {error && (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr-placeholder";
  const KEY = "pspm-form-upload-session";
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing && /^[A-Za-z0-9-]{8,64}$/.test(existing)) return existing;
    const fresh = crypto.randomUUID();
    window.sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private mode / disabled storage: fall back to in-memory.
    return crypto.randomUUID();
  }
}
