"use client";

interface TotalDisplayProps {
  total: number;
  label?: string;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function TotalDisplay({ total, label = "Total" }: TotalDisplayProps) {
  return (
    <div
      className="flex items-center justify-between rounded-[12px] bg-primary-light border border-primary/20 px-5 py-4"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="text-sm font-semibold text-navy">{label}</span>
      <span className="text-xl font-bold text-primary tabular-nums">
        {formatCurrency(total)}
      </span>
    </div>
  );
}

export { TotalDisplay, formatCurrency };
export type { TotalDisplayProps };
