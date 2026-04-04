"use client";

import { useCallback, useRef, useState } from "react";

interface FormFieldError {
  message?: string;
}

interface UploadedFile {
  file: File;
  id: string;
}

interface FileUploadProps {
  name: string;
  label: string;
  accept?: string;
  multiple?: boolean;
  maxSizeMb?: number;
  error?: FormFieldError;
  required?: boolean;
  onChange?: (files: File[]) => void;
  className?: string;
}

function FileUpload({
  name,
  label,
  accept,
  multiple = true,
  maxSizeMb = 10,
  error,
  required,
  onChange,
  className = "",
}: FileUploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupId = `upload-${name}`;
  const errorId = `${groupId}-error`;

  const addFiles = useCallback(
    (newFiles: FileList | null) => {
      if (!newFiles) return;

      const maxBytes = maxSizeMb * 1024 * 1024;
      const validFiles: UploadedFile[] = [];

      for (let i = 0; i < newFiles.length; i++) {
        const file = newFiles[i];
        if (file.size <= maxBytes) {
          validFiles.push({
            file,
            id: `${Date.now()}-${file.name}`,
          });
        }
      }

      const updated = multiple ? [...files, ...validFiles] : validFiles.slice(0, 1);
      setFiles(updated);
      onChange?.(updated.map((f) => f.file));
    },
    [files, maxSizeMb, multiple, onChange]
  );

  function removeFile(id: string) {
    const updated = files.filter((f) => f.id !== id);
    setFiles(updated);
    onChange?.(updated.map((f) => f.file));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    addFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label className="text-sm font-medium text-foreground">
        {label}
        {required && <span className="text-error ml-0.5" aria-hidden="true">*</span>}
      </label>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Upload files for ${label}. Drag and drop or click to select.`}
        aria-describedby={error ? errorId : undefined}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed
          px-6 py-8 cursor-pointer transition-colors text-center
          ${dragActive
            ? "border-primary bg-primary/5"
            : error
              ? "border-error bg-error-light"
              : "border-border hover:border-primary/50 hover:bg-primary/[0.02]"
          }`}
      >
        <svg
          className="w-8 h-8 text-muted mb-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm text-muted">
          <span className="font-medium text-primary">Click to upload</span> or
          drag and drop
        </p>
        <p className="text-xs text-muted mt-1">
          Max {maxSizeMb}MB per file
          {accept && ` (${accept})`}
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        name={name}
        accept={accept}
        multiple={multiple}
        onChange={(e) => addFiles(e.target.files)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* File list */}
      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Uploaded files">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <svg
                  className="w-4 h-4 text-muted shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                <span className="truncate">{f.file.name}</span>
                <span className="text-xs text-muted shrink-0">
                  ({formatSize(f.file.size)})
                </span>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(f.id);
                }}
                className="text-muted hover:text-error transition-colors ml-2 shrink-0"
                aria-label={`Remove ${f.file.name}`}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

export { FileUpload };
export type { FileUploadProps };
