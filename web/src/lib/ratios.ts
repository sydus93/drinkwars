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
  /** Statements & Ratios page: the formula in words, the statement lines it is built from
   *  (Statements.tsx line keys — hovering the ratio lights those rows), and what it tells you. */
  formula: string;
  uses: string[];
  meaning: string;
  /** Scoring benchmark band this ratio is graded against, where the economy has one. */
  band?: "roic" | "interest_cover";
}

export const RATIO_GROUPS: { id: RatioGroup; label: string }[] = [
  { id: "profitability", label: "Profitability" },
  { id: "liquidity", label: "Liquidity" },
  { id: "leverage", label: "Leverage" },
];

export const RATIO_DEFS: RatioDef[] = [
  { key: "grossMargin", label: "Gross margin", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.revenue > 0 ? r.gross / r.revenue : null),
    formula: "Gross profit ÷ Revenue", uses: ["gross", "revenue"], meaning: "What is left of each sales dollar after brewing the drink. Price and unit cost set it — nothing else." },
  { key: "opMargin", label: "Operating margin", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.revenue > 0 ? r.ebit / r.revenue : null),
    formula: "Operating income ÷ Revenue", uses: ["ebit", "revenue"], meaning: "What is left after running the business too: overhead, the programs you fund, depreciation. A wide gap below gross margin means spending, not pricing, is the issue." },
  { key: "netMargin", label: "Net margin", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.revenue > 0 ? r.netIncome / r.revenue : null),
    formula: "Net income ÷ Revenue", uses: ["net", "revenue"], meaning: "The bottom line per sales dollar, after lenders are paid." },
  { key: "roic", label: "Return on invested capital", group: "profitability", fmt: "pct", better: "high", band: "roic", compute: (r) => (r.debt + r.equity > 0 ? r.netIncome / (r.debt + r.equity) : null),
    formula: "Net income ÷ (Debt + Equity)", uses: ["net", "debt", "equity"], meaning: "Profit earned this quarter on all the capital in the business, whoever supplied it. The Financial part of your scorecard grades this. Quarterly: 3% a quarter is about 12% a year." },
  { key: "roa", label: "Return on assets", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.assets > 0 ? r.netIncome / r.assets : null),
    formula: "Net income ÷ Total assets", uses: ["net", "assets"], meaning: "How hard everything you own is working. Idle tanks and idle cash both drag it down." },
  { key: "roe", label: "Return on equity", group: "profitability", fmt: "pct", better: "high", compute: (r) => (r.equity > 0 ? r.netIncome / r.equity : null),
    formula: "Net income ÷ Total equity", uses: ["net", "equity"], meaning: "The owners' return. Debt lifts it when the business earns more than the loan costs — and sinks it when it doesn't." },
  { key: "cashRatio", label: "Cash ratio", group: "liquidity", fmt: "x", better: "high", compute: (r) => (r.debt > 0 ? r.cash / r.debt : null), // null = no debt (∞)
    formula: "Cash ÷ Debt", uses: ["cash", "debt"], meaning: "Could you repay your lenders from the cash on hand today? Above 1× you could." },
  { key: "runway", label: "Cash runway", group: "liquidity", fmt: "x", better: "high", compute: (r) => (r.netIncome < 0 ? r.cash / Math.max(1, -r.netIncome) : null), // rounds of cash at the current burn; null = self-funding
    formula: "Cash ÷ this quarter's loss", uses: ["cash", "net"], meaning: "Quarters of cash left if you keep losing money at this rate. Only shown while you are losing money." },
  { key: "debtAssets", label: "Debt-to-assets", group: "leverage", fmt: "pct", better: "low", compute: (r) => (r.assets > 0 ? r.debt / r.assets : null),
    formula: "Debt ÷ Total assets", uses: ["debt", "assets"], meaning: "The share of what you own that lenders financed." },
  { key: "debtEquity", label: "Debt-to-equity", group: "leverage", fmt: "x", better: "low", compute: (r) => (r.equity > 0 ? r.debt / r.equity : null),
    formula: "Debt ÷ Total equity", uses: ["debt", "equity"], meaning: "Lenders' money against owners' money. Borrowing gets dearer as this climbs, and a loss raises it even if you borrow nothing, because a loss shrinks equity." },
  { key: "rate", label: "Interest rate paid (qtr)", group: "leverage", fmt: "pct", better: "low", compute: (r) => (r.debt > 0 ? r.interest / r.debt : null),
    formula: "Interest ÷ Debt", uses: ["interest", "debt"], meaning: "What your lender actually charged this quarter. It is not fixed: it climbs with debt-to-equity, and it widens as operating income stops comfortably covering the interest bill — the pricing grid a real credit agreement runs on. A rise here with no new borrowing means the bank has repriced you, and the cure is to repay or to earn back your cover." },
  { key: "tie", label: "Times interest earned", group: "leverage", fmt: "x", better: "high", band: "interest_cover", compute: (r) => (r.interest > 0 ? r.ebit / r.interest : null),
    formula: "Operating income ÷ Interest", uses: ["ebit", "interest"], meaning: "How many times over operating income covers the interest bill. Under 1× the business cannot pay its lenders from operations — that puts you below the safety line." },
];

/** Unit suffix for a CHANGE in this ratio. Not derivable from `fmt` alone: runway is carried
 *  as "x" but reads in rounds, so its delta used to print "2.9×" beside a value of "7.4 rds". */
export function ratioDeltaUnit(def: RatioDef): string {
  if (def.key === "runway") return " rds";
  return def.fmt === "pct" ? " pt" : "×";
}

/** Render a ratio value, including the semantic nulls (no debt / self-funding). */
export function ratioDisplay(def: RatioDef, v: number | null): string {
  if (v == null) {
    if (def.key === "cashRatio") return "∞"; // no debt
    // No interest to cover ⇒ coverage is unbounded. The engine says 999 and the decision form
    // prints ∞; printing "—" here made the same firm look un-measured on one screen and
    // comfortable on another.
    if (def.key === "tie") return "∞";
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
  /** Engine solvency clock (DW-046) — optional so older rows still work. */
  belowSafety?: boolean;
  roundsBelowSafety?: number;
}

/** Short flag labels for the LATEST round given one firm's per-round history
 *  (ascending by round). Empty array = healthy. */
export function distressFlags(history: DistressRow[]): string[] {
  const n = history.length;
  if (n === 0) return [];
  const last = history[n - 1];
  const flags: string[] = [];
  // The engine's own rule first: below the safety line (cash under the threshold or
  // coverage under 1×). The covenant breaches after `solvency_runway_rounds` such quarters
  // — 5 since DW-051, not 3 — and only if cover is still under 1× AND cash is under HALF the
  // safety line in that quarter (exit.ts). A rival can bid once `min_distress_rounds` = 3
  // have passed. Everything after this is a heuristic early warning.
  if (last.belowSafety) flags.push(`below safety line${(last.roundsBelowSafety ?? 0) > 1 ? ` · ${last.roundsBelowSafety} qtrs` : ""}`);
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
