"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import SignaturePadLib from "signature_pad";
import { Button } from "@/components/ui/Button";

interface FormFieldError {
  message?: string;
}

interface SignaturePadProps {
  label: string;
  required?: boolean;
  error?: FormFieldError;
  onChange?: (dataUrl: string) => void;
  className?: string;
}

function SignaturePad({
  label,
  required,
  error,
  onChange,
  className = "",
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = container.clientWidth;
    const height = 200;

    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
    }

    // Redraw existing data after resize
    if (padRef.current && !padRef.current.isEmpty()) {
      const data = padRef.current.toData();
      padRef.current.clear();
      padRef.current.fromData(data);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pad = new SignaturePadLib(canvas, {
      penColor: "#1a1a2e",
      backgroundColor: "rgba(255, 255, 255, 0)",
    });

    pad.addEventListener("endStroke", () => {
      setIsEmpty(pad.isEmpty());
      if (onChange) {
        onChange(pad.toDataURL("image/png"));
      }
    });

    padRef.current = pad;
    resizeCanvas();

    const observer = new ResizeObserver(() => {
      resizeCanvas();
    });
    const container = containerRef.current;
    if (container) {
      observer.observe(container);
    }

    return () => {
      pad.off();
      observer.disconnect();
    };
  }, [onChange, resizeCanvas]);

  function handleClear() {
    if (padRef.current) {
      padRef.current.clear();
      setIsEmpty(true);
      onChange?.("");
    }
  }

  const fieldId = `signature-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const errorId = `${fieldId}-error`;

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label
        htmlFor={fieldId}
        className="text-sm font-medium text-foreground"
      >
        {label}
        {required && (
          <span className="text-error ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>

      <div ref={containerRef} className="w-full">
        <canvas
          ref={canvasRef}
          id={fieldId}
          role="img"
          aria-label={`Signature pad for ${label}. Draw your signature here.`}
          aria-describedby={error ? errorId : undefined}
          tabIndex={0}
          className={`w-full rounded-[8px] border-2 border-dashed cursor-crosshair touch-none
            ${
              error
                ? "border-error bg-error-light"
                : isEmpty
                  ? "border-primary/40 bg-white"
                  : "border-primary bg-white"
            }`}
          style={{ height: "200px" }}
        />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {isEmpty ? "Sign above using your mouse or finger" : "Signature captured"}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={isEmpty}
          aria-label="Clear signature"
        >
          Clear
        </Button>
      </div>

      {error && (
        <p id={errorId} className="text-xs text-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

export { SignaturePad };
export type { SignaturePadProps };
