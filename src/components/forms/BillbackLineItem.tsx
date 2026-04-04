"use client";

import { formatCurrency } from "@/components/forms/TotalDisplay";

interface BillbackLineItemProps {
  label: string;
  fixedPrice: number;
  userDefinedPrice: boolean;
  quantity: number;
  customPrice?: number;
  onQuantityChange: (qty: number) => void;
  onCustomPriceChange?: (price: number) => void;
  id?: string;
}

function BillbackLineItem({
  label,
  fixedPrice,
  userDefinedPrice,
  quantity,
  customPrice = 0,
  onQuantityChange,
  onCustomPriceChange,
  id,
}: BillbackLineItemProps) {
  const baseId = id ?? `billback-${label.toLowerCase().replace(/\s+/g, "-")}`;
  const effectivePrice = userDefinedPrice ? customPrice : fixedPrice;
  const lineTotal = effectivePrice * quantity;

  function handleQtyChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9]/g, "");
    const parsed = parseInt(raw, 10);
    onQuantityChange(isNaN(parsed) ? 0 : Math.max(0, parsed));
  }

  function handlePriceChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/[^0-9.]/g, "");
    if (raw === "" || raw === ".") {
      onCustomPriceChange?.(0);
      return;
    }
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      onCustomPriceChange?.(Math.round(parsed * 100) / 100);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-2 border-b border-border last:border-b-0">
      {/* Label */}
      <label
        htmlFor={`${baseId}-qty`}
        className="text-sm font-medium text-foreground min-w-0"
      >
        {label}
      </label>

      {/* Price */}
      {userDefinedPrice ? (
        <div className="relative w-24">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted pointer-events-none">
            $
          </span>
          <input
            id={`${baseId}-price`}
            type="text"
            inputMode="decimal"
            aria-label={`Price for ${label}`}
            value={customPrice === 0 ? "" : customPrice.toFixed(2)}
            placeholder="0.00"
            onChange={handlePriceChange}
            className="w-full rounded-[8px] border border-border pl-5 pr-2 py-1.5 text-sm text-right
              focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary
              hover:border-primary/50 bg-white"
          />
        </div>
      ) : (
        <span className="text-sm text-muted w-24 text-right tabular-nums">
          {formatCurrency(fixedPrice)}
        </span>
      )}

      {/* Quantity */}
      <div className="w-16">
        <input
          id={`${baseId}-qty`}
          type="text"
          inputMode="numeric"
          aria-label={`Quantity for ${label}`}
          value={quantity === 0 ? "" : quantity.toString()}
          placeholder="0"
          onChange={handleQtyChange}
          className="w-full rounded-[8px] border border-border px-2 py-1.5 text-sm text-center
            focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary
            hover:border-primary/50 bg-white"
        />
      </div>

      {/* Line Total */}
      <span className="text-sm font-semibold text-navy w-24 text-right tabular-nums">
        {formatCurrency(lineTotal)}
      </span>
    </div>
  );
}

export { BillbackLineItem };
export type { BillbackLineItemProps };
