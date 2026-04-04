"use client";

import { useFormContext } from "react-hook-form";

interface ConditionalFieldProps {
  /** The name of the watched field */
  watchField: string;
  /** The value(s) that should cause children to render */
  showWhen: string | string[];
  /** Content to render when condition is met */
  children: React.ReactNode;
}

function ConditionalField({
  watchField,
  showWhen,
  children,
}: ConditionalFieldProps) {
  const { watch } = useFormContext();
  const watchValue = watch(watchField) as string | undefined;

  const shouldShow = Array.isArray(showWhen)
    ? showWhen.includes(watchValue ?? "")
    : watchValue === showWhen;

  if (!shouldShow) {
    return null;
  }

  return <div className="animate-fade-in">{children}</div>;
}

export { ConditionalField };
export type { ConditionalFieldProps };
