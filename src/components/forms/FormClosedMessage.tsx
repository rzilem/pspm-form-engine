interface FormClosedMessageProps {
  title: string;
  message: string;
  description?: string | null;
}

/** Shown when a form is closed by submission limits (no inputs, no submit). */
export function FormClosedMessage({
  title,
  message,
  description,
}: FormClosedMessageProps) {
  return (
    <div className="rounded-[8px] border border-border bg-white px-6 py-8 text-center space-y-3">
      <h2 className="text-xl font-semibold text-navy">{title}</h2>
      {description && (
        <p className="text-sm text-muted">{description}</p>
      )}
      <p className="text-base text-foreground">{message}</p>
    </div>
  );
}