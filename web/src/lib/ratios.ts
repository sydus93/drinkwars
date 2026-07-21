/**
 * Financial ratios + Weighted Competitive Strength (DW-037) — shared by the
 * instructor Finance panel and the player Trends ratio card. Modeled on the
 * GBA 490 "Financial Ratios with WCS Table" workbook: RATIO_DEFS mirrors its
 * statement-analysis sheet, computeWcs its Key Success Factors sheet
 * (importance weight × strength rating → weighted score). All figures are
 * quarterly — one round = one fiscal quarter.
 */
import { fmt } from "../labels.js";

export interface RatioInput {
  revenue: number;
  gross: number;
  ebit: number;
  interest: number;
  netIncome: number;
  cash: number;
  debt: number;
  equity: number;
  assets: number;
}

export type RatioGroup = "profitability" | "liquidity" | "leverage";

export interface RatioDef {
  key: string;
  label: string;
  group: RatioGroup;
  fmt: "pct" | "x" | "money";
  better: "high" | "low";
  compute(r: RatioInput): number | null; // null when the denominator ≤ 0 (semantics per key — see ratioDisplay)
}

export const RATIO_GROUPS: { id: RatioGroup; label: string }[] = [
  { id: "profitability", label: "Profitability" },
  { id: "liquidity", label: "Liquidity" },
  { id: "leverage", label: "Leverage" },
];

export const RATIO_DEFS: RatioDef[] = [
  { key: "grossMargin", label: "Gross margin", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.revenue > 0 ? r.gross / r.revenue : null) },
  { key: "opMargin", label: "Operating margin", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.revenue > 0 ? r.ebit / r.revenue : null) },
  { key: "netMargin", label: "Net margin", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.revenue > 0 ? r.netIncome / r.revenue : null) },
  { key: "roa", label: "Return on assets", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.assets > 0 ? r.netIncome / r.assets : null) },
  { key: "roe", label: "Return on equity", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.equity > 0 ? r.netIncome / r.equity : null) },
  { key: "cashRatio", label: "Cash ratio", group: "liquidity", fmt: "x", better: "high", compute: (r) => (r.debt > 0 ? r.cash / r.debt : null) }, // null = no debt (∞)
  { key: "runway", label: "Cash runway", group: "liquidity", fmt: "x", better: "high", compute: (r) => (r.netIncome < 0 ? r.cash / Math.max(1, -r.netIncome) : null) }, // rounds of cash at the current burn; null = self-funding
  { key: "debtAssets", label: "Debt-to-assets", group: "leverage", fmt: "pct", better: "low", compute: (r) => (r.assets > 0 ? r.debt / r.assets : null) },
  { key: "debtEquity", label: "Debt-to-equity", group: "leverage", fmt: "x", better: "low", compute: (r) => (r.equity > 0 ? r.debt / r.equity : null) },
  { key: "tie", label: "Times interest earned", group: "leverage", fmt: "x", better: "high", compute: (r) => (r.interest > 0 ? r.ebit / r.interest : null) },
];

/** Render a ratio value, including the semantic nulls (no debt / self-funding). */
export function ratioDisplay(def: RatioDef, v: number | null): string {
  if (v == null) {
    if (def.key === "cashRatio") return "∞"; // no debt
    if (def.key === "runway") return "self-funding";
    return "—";
  }
  if (def.key === "runway") return `${v.toFixed(1)} rds`;
  if (def.fmt === "pct") return fmt.pct1(v);
  if (def.fmt === "x") return `${v.toFixed(1)}×`;
  return fmt.money(v);
}

// ─── Weighted Competitive Strength (the workbook's Key Success Factors sheet) ───

export interface WcsRow {
  firmId: string;
  Q: number;
  B: number;
  unitCost: number;
  cap: number;
  equity: number;
  cash: number;
  debt: number;
  T_emp: number;
}

export interface WcsFactor {
  key: string;
  label: string;
  weight: number; // importance weights sum to 1
  value(row: WcsRow): number;
  better: "high" | "low";
}

export const WCS_FACTORS: WcsFactor[] = [
  { key: "quality", label: "Product quality", weight: 0.2, value: (r) => r.Q, better: "high" },
  { key: "brand", label: "Brand", weight: 0.2, value: (r) => r.B, better: "high" },
  { key: "cost", label: "Cost position", weight: 0.2, value: (r) => r.unitCost, better: "low" },
  { key: "scale", label: "Scale", weight: 0.15, value: (r) => r.cap, better: "high" },
  { key: "finance", label: "Financial strength", weight: 0.15, value: (r) => r.equity + r.cash - r.debt, better: "high" },
  { key: "people", label: "People & trust", weight: 0.1, value: (r) => r.T_emp, better: "high" },
];

export interface WcsResult {
  firmId: string;
  ratings: Record<string, number>; // factor key → 1–10 strength rating
  overall: number; // Σ weight × rating
}

/** Min–max normalize each factor across the given firms to a 1–10 strength rating
 *  (inverted when better:"low"; all firms equal ⇒ 5.5), overall = weighted sum.
 *  Sorted best-first. */
export function computeWcs(rows: WcsRow[]): WcsResult[] {
  const out: WcsResult[] = rows.map((r) => ({ firmId: r.firmId, ratings: {}, overall: 0 }));
  for (const f of WCS_FACTORS) {
    const vals = rows.map((r) => f.value(r));
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min;
    rows.forEach((_, i) => {
      const t = span > 0 ? (vals[i] - min) / span : null;
      const rating = t == null ? 5.5 : 1 + 9 * (f.better === "low" ? 1 - t : t);
      out[i].ratings[f.key] = rating;
      out[i].overall += f.weight * rating;
    });
  }
  return out.sort((a, b) => b.overall - a.overall);
}

// ─── Distress flags — early-warning labels for the latest round ───

export interface DistressRow {
  round: number;
  netIncome: number;
  cash: number;
  leverage: number;
  creditRationed: boolean;
  rank: number;
}

/** Short flag labels for the LATEST round given one firm's per-round history
 *  (ascending by round). Empty array = healthy. */
export function distressFlags(history: DistressRow[]): string[] {
  const n = history.length;
  if (n === 0) return [];
  const last = history[n - 1];
  const flags: string[] = [];
  let losses = 0;
  for (let i = n - 1; i >= 0 && history[i].netIncome < 0; i--) losses++;
  if (losses >= 2) flags.push("2+ loss rounds");
  if (last.netIncome < 0 && last.cash / Math.max(1, -last.netIncome) < 2) flags.push("runway < 2 rounds");
  if (last.leverage > 2.5 || last.creditRationed) flags.push("leverage stretched");
  // Rank sliding: worsened by ≥2 places over the last 2 resolved rounds (fall back
  // to the previous round when only two exist).
  const back = n >= 3 ? history[n - 3] : n >= 2 ? history[n - 2] : null;
  if (back && last.rank - back.rank >= 2) flags.push("rank sliding");
  return flags;
}
