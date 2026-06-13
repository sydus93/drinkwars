import { useEffect } from "react";
import type { MarketConfig } from "drinkwars-engine";
import { fmt } from "../labels.js";
import { Row, Tag } from "./ui.js";

/** Map a coefficient multiplier (1 = same as home) to a plain-language read for
 *  an advanced-undergrad audience — no betas, just what it means for play. */
function taste(mult: number, hi: string, lo: string, mid = "About the same as home"): { label: string; tone: "hop" | "brick" | "ink" } {
  if (mult >= 1.15) return { label: hi, tone: "hop" };
  if (mult <= 0.85) return { label: lo, tone: "brick" };
  return { label: mid, tone: "ink" };
}

/**
 * Click-out profile of one regional/export market: how big it is, what its
 * drinkers reward (price / quality / brand), how far your brand carries, and the
 * costs of operating there (entry, distribution, tariffs, currency). The strategic
 * "should I expand here?" read, in words rather than coefficients.
 */
export function MarketDetail({
  market,
  view,
  weight,
  entered,
  perf,
  onClose,
}: {
  market: MarketConfig;
  view: { fx: Record<string, number> };
  weight: number; // current capacity-allocation weight (0–1)
  entered: boolean;
  perf?: { revenue: number; q_sold: number } | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const kindLabel = market.kind === "home" ? "Home region" : market.kind === "export" ? "Export market" : "Domestic region";
  const size = market.demand_mult >= 1.1 ? "Larger than your home market" : market.demand_mult <= 0.9 ? "Smaller than your home market" : "About home-sized";
  const price = taste(market.beta_p_mult, "Very price-sensitive — keep prices keen", "Less price-sensitive — room to charge more");
  const quality = taste(market.beta_q_mult, "Rewards quality strongly", "Quality matters less here");
  const brand = taste(market.beta_b_mult, "Brand-driven — buzz sells", "Brand matters less here");
  const reach =
    market.brand_transfer >= 0.95 ? "Your brand is fully known here" :
    market.brand_transfer >= 0.6 ? "Your brand is partly known here" : "You start largely unknown here";
  const fx = view.fx[market.id];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rise flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border-2 border-copper bg-paper shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pt-4 pb-3">
          <div className="min-w-0">
            <div className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-copperdeep">{kindLabel}</div>
            <h3 className="display truncate text-xl font-semibold leading-tight text-ink">{market.label}</h3>
          </div>
          <button onClick={onClose} className="shrink-0 text-inksoft transition-colors hover:text-ink" aria-label="Close">✕</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-inksoft">What the drinkers want</div>
          <div className="grid gap-1">
            <Row label="Market size" value={size} />
            <Row label="Price sensitivity" value={<Tag tone={price.tone}>{price.label}</Tag>} />
            <Row label="Quality" value={<Tag tone={quality.tone}>{quality.label}</Tag>} />
            <Row label="Brand" value={<Tag tone={brand.tone}>{brand.label}</Tag>} />
            <Row label="Brand reach" value={reach} />
          </div>

          <div className="mt-4 mb-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-inksoft">Cost of doing business</div>
          <div className="grid gap-1">
            {market.kind !== "home" && <Row label="One-time entry" value={entered ? <Tag tone="hop">Already in</Tag> : fmt.money(market.entry_cost)} />}
            {market.distribution_cost_per_unit > 0 && <Row label="Distribution" value={`${fmt.price(market.distribution_cost_per_unit)} / unit shipped`} />}
            {market.kind === "export" && <Row label="Tariff" value={`${Math.round(market.tariff_rate * 100)}% on export revenue`} />}
            {market.kind === "export" && fx != null && <Row label="Exchange rate" value={<span className="tnum">{fx.toFixed(2)} {market.fx_volatility > 0 ? `(swings ±${Math.round(market.fx_volatility * 100)}%)` : ""}</span>} />}
          </div>

          <div className="mt-4 mb-1 text-[0.6rem] font-semibold uppercase tracking-[0.14em] text-inksoft">Your position</div>
          <div className="grid gap-1">
            <Row label="Capacity allocated here" value={`${Math.round(weight * 100)}%`} />
            {perf && entered && <Row label="Last round here" value={`${fmt.money(perf.revenue)} · ${fmt.int(perf.q_sold)} units`} />}
          </div>

          {market.kind === "export" && (
            <p className="mt-3 text-[0.68rem] leading-snug text-inksoft">
              Export revenue is converted at the exchange rate, then tariffed — a weak local currency or a high tariff can erase a good margin. Currency drifts each round.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
