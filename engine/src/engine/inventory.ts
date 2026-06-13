/**
 * Carried finished-goods inventory + spoilage (demand-side enrichment).
 *
 * Config-gated: `invCfg(c)` returns a *disabled* default when `c.inventory` is
 * absent, so games created before this feature (whose persisted config has no
 * inventory block) keep the exact legacy behavior — produce-to-sell, working
 * capital ≡ 0. When enabled, a firm chooses a production run-rate (a fraction of
 * effective capacity), unsold output carries to the next round at weighted-average
 * cost, and a fraction spoils each round. Carrying inventory at weighted-average
 * cost and restoring the `− ΔInventory` term in operating cash flow keeps the two
 * §7.2 finance invariants exact (see finance.ts).
 */
import type { Config, InventoryConfig } from "../types.js";

const DISABLED: InventoryConfig = { enabled: false, spoilage_rate: 0, max_run_rate: 1, holding_cost_per_unit: 0 };

/** Resolved inventory settings; disabled (legacy) when the module is absent. Reads
 *  the canonical `modules.inventory` and falls back to a pre-relocation top-level
 *  `inventory` block so an in-flight local game still resolves correctly. */
export function invCfg(c: Config): InventoryConfig {
  return c.modules?.inventory ?? (c as { inventory?: InventoryConfig }).inventory ?? DISABLED;
}

export interface InventoryFlow {
  begin: number; // units on hand at start of round
  produced: number; // units brewed this round (= run_rate · effectiveCap)
  sold: number; // units sold this round (from demand resolution)
  spoiled: number; // units lost to spoilage
  end: number; // units carried to next round
  avg_cost: number; // weighted-average unit cost of the pooled stock
  cogs: number; // cost of goods sold (= sold · avg_cost)
  spoilage_cost: number; // write-off (= spoiled · avg_cost)
  value_begin: number; // $ cost basis at start of round
  value_end: number; // $ cost basis carried forward
  turnover: number; // sold / average-on-hand (0 when nothing on hand)
}

/**
 * Weighted-average-cost inventory accounting for one firm-round. `unitCost` is this
 * round's marginal production cost; `qSold` comes from the demand step and is
 * guaranteed ≤ begin + produced (sellable supply was capped at that). Spoilage is
 * applied to the post-sale stock.
 */
export function computeInventory(
  beginUnits: number,
  beginValue: number,
  produced: number,
  unitCost: number,
  qSold: number,
  spoilageRate: number,
): InventoryFlow {
  const prod = Math.max(0, produced);
  const productionCost = prod * unitCost;
  const poolUnits = beginUnits + prod;
  const avgCost = poolUnits > 1e-9 ? (beginValue + productionCost) / poolUnits : unitCost;

  const sold = Math.max(0, Math.min(qSold, poolUnits));
  const cogs = sold * avgCost;

  const afterSale = Math.max(0, poolUnits - sold);
  const spoiled = Math.max(0, Math.min(afterSale, spoilageRate * afterSale));
  const end = afterSale - spoiled;
  const spoilageCost = spoiled * avgCost;
  const valueEnd = end * avgCost;

  // Average on-hand over the round (begin and post-production midpoint) for turnover.
  const avgOnHand = (beginUnits + poolUnits) / 2;
  const turnover = avgOnHand > 1e-9 ? sold / avgOnHand : 0;

  return {
    begin: beginUnits,
    produced: prod,
    sold,
    spoiled,
    end,
    avg_cost: avgCost,
    cogs,
    spoilage_cost: spoilageCost,
    value_begin: beginValue,
    value_end: valueEnd,
    turnover,
  };
}
