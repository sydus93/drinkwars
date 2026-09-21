/**
 * Real-world calibration targets for the Drink Wars economy (DW-040).
 *
 * WHAT THIS IS. The balance harness (harness/balance.ts) asks "is the GAME sound?" —
 * deterministic, no dominant strategy, no runaway leader. This file asks a different
 * question: "is the INDUSTRY the engine produces recognizably the real one?" It is the
 * output side of calibration. The input side already exists — config/defaults.ts anchors
 * dollars, drinks, prices and rates to published craft-beverage benchmarks (DW-029). What
 * was missing is a check that those inputs EMERGE as the right aggregate behaviour once
 * eight firms compete for sixteen quarters.
 *
 * WHAT IT IS NOT. This is not a forecasting claim. A teaching simulation is validated the
 * way agent-based economic models are — by reproducing the STYLIZED FACTS of the domain
 * (margins, utilization, exit rates, fragmentation), not by predicting a named firm's
 * revenue. Passing every target below licenses one sentence: "the simulated industry
 * operates within the empirical envelope of the US craft-beverage industry." It does not
 * license "the simulation predicts craft-beverage outcomes." Keep that line in the paper.
 *
 * TWO KINDS OF TARGET.
 *   empirical  — a published number with a source. Disagreement means the ENGINE is off.
 *   structural — a design invariant with no external referent (e.g. "no duopoly forms in
 *                a local craft market"). Disagreement means the DESIGN drifted.
 *
 * MAINTAINING IT. Re-check the empirical rows each year against the primary sources; the
 * craft industry is contracting, so exit rates and margins move. `confidence: "provisional"`
 * marks a figure taken from a secondary summary that should be verified against the
 * Brewers Association release itself before it appears in a publication.
 */

export type TargetKind = "empirical" | "structural";
export type Confidence = "high" | "medium" | "provisional";

export interface CalibrationTarget {
  id: string;
  label: string;
  unit: "%" | "$" | "×" | "index";
  kind: TargetKind;
  /** The published point estimate (null when only a plausible range is defensible). */
  target: number | null;
  /** Inside `pass` → PASS. Outside `pass` but inside `warn` → WARN. Outside both → FAIL. */
  pass: [number, number];
  warn: [number, number];
  source: string;
  confidence: Confidence;
  note?: string;
}

export const CALIBRATION_TARGETS: CalibrationTarget[] = [
  // ── Profitability ─────────────────────────────────────────────────────────
  {
    id: "gross_margin",
    label: "Gross margin",
    unit: "%",
    kind: "empirical",
    target: 41,
    pass: [33, 52],
    warn: [25, 60],
    source: "Brewers Association Brewery Operations/Financial Benchmarking Survey, 2024 release (2023 operations): median gross profit margin 41%, down from 51% in 2019.",
    confidence: "high",
    note: "The band spans the 2019→2023 deterioration deliberately: a simulated industry landing anywhere in 41–51% is defensible, and the engine's own header targets ~35% at start rising with learning.",
  },
  {
    id: "net_margin",
    label: "Net margin",
    unit: "%",
    kind: "empirical",
    target: 14,
    pass: [3, 16],
    warn: [-2, 22],
    source: "Brewers Association benchmarking release, 2024 (median net income ~14%).",
    confidence: "provisional",
    note: "VERIFY AGAINST THE PRIMARY RELEASE before citing. 14% median net income is high relative to the usual small-brewery picture, and reported margin definitions vary (owner compensation and taproom vs. distribution mix both move it). The pass band is deliberately wide and low-anchored. INTERPRETATION CAVEAT (DW-042): the engine expenses ALL capability investment (quality, brand, trust spend) straight to opex, and the best-response agents reinvest a fixed fraction of cash every quarter by construction — so the adaptive column can print negative net margins while building value and never failing. Read this row on the mixed population and alongside gross margin.",
  },

  // ── Operations ────────────────────────────────────────────────────────────
  {
    id: "capacity_utilization",
    label: "Capacity utilization",
    unit: "%",
    kind: "empirical",
    target: 51,
    pass: [45, 70],
    warn: [35, 85],
    source: "Brewers Association craft-brewer capacity analysis (2024): brewers producing ~51% of installed capacity; commentary puts the industry average nearer 60%, against a ~80% operating rule of thumb.",
    confidence: "high",
    note: "Chronic overbuild is one of the most distinctive facts about this industry. DW-040 diagnosed the old config as structurally supply-constrained (demand 1.95× installed capacity, boom-rate growth — firms sold everything they brewed, so the stranded-capacity trap was unreachable). DW-042 moved the posture: demand/capacity now starts at 1.22× with post-boom growth (mass +2%/yr), idle capacity carries a real cost ($0.4/drink/qtr), and rationed customers mostly walk instead of spilling to whoever has spare tanks. Population-average utilization still runs high (~75–90%) because a growing game with competent players SHOULD run its plant hard — but the stranded-capacity probe below now shows a mistimed expansion losing real money, which is the teachable part. Matching the real 51% needs a demand-stagnation 'mature market' scenario config (post-semester).",
  },
  {
    id: "unit_price_mass",
    label: "Price per drink · mass segment",
    unit: "$",
    kind: "empirical",
    target: 7.5,
    pass: [5.5, 9.5],
    warn: [4, 12],
    source: "Config DW-029 anchor: US taproom pours $6–9 per drink.",
    confidence: "medium",
  },
  {
    id: "revenue_per_qtr",
    label: "Revenue per firm per quarter",
    unit: "$",
    kind: "empirical",
    target: 550_000,
    pass: [350_000, 800_000],
    warn: [200_000, 1_200_000],
    source: "Config DW-029 anchor: taproom-tier craft brewery ≈ 80k drinks/qtr (~1,300 bbl/yr), revenue ~$400–700k/qtr.",
    confidence: "medium",
  },

  // ── Industry dynamics ─────────────────────────────────────────────────────
  {
    id: "annual_exit_rate",
    label: "Annual exit rate",
    unit: "%",
    kind: "empirical",
    target: 4.4,
    pass: [2, 9],
    warn: [0.5, 15],
    source: "Brewers Association, 2025 year in beer: 434 closings against 9,778 operating breweries (4.4%); 268 openings, a second consecutive year of net contraction (−2.9% to 9,578).",
    confidence: "high",
    note: "A round is a quarter, so a 16-round game is four years. Zero exits across a whole sweep means failure has been engineered out; above ~15%/yr the game is a meat grinder and students stop taking risks.",
  },
  {
    id: "survival_4yr",
    label: "Firms still trading after 4 years",
    unit: "%",
    kind: "empirical",
    target: 84,
    pass: [70, 96],
    warn: [55, 100],
    source: "Implied by the BA closing rate above compounded over the 16-quarter horizon (0.956⁴ ≈ 0.84).",
    confidence: "medium",
  },

  // ── Structure (design invariants, no external referent) ───────────────────
  {
    id: "hhi",
    label: "Output concentration (HHI)",
    unit: "index",
    kind: "structural",
    target: null,
    pass: [0.13, 0.35],
    warn: [0.125, 0.5],
    source: "Structural: a local craft scene is fragmented. Eight equal firms = 0.125; 0.25 ≈ four effective competitors; >0.5 is a duopoly.",
    confidence: "high",
    note: "Some concentration SHOULD emerge — strategy has to pay. The failure mode is a market that resolves to one winner every time, which ends the game before the last rounds.",
  },
  {
    id: "leverage",
    label: "Leverage (debt / equity)",
    unit: "×",
    kind: "structural",
    target: null,
    pass: [0.1, 1.5],
    warn: [0, 2.5],
    source: "Structural: small brewery balance sheets carry equipment debt but are not LBOs. The config caps leverage at 3.0.",
    confidence: "medium",
    note: "READ THIS BEFORE TUNING ON IT (DW-056). This moment does not measure the economy — it measures the harness bots' financing scripts. Archetype debt_draw/debt_repay are hardcoded constants (only `aggressive` borrows, only `conservative` repays) and the adaptive best-response agents have no financing lever at all, so simulated leverage sits near 0.06x whatever debt costs. A standing WARN here is expected and is NOT evidence that debt is mispriced; conversely the sweep cannot validate leverage pricing, so spread_leverage_k has to be set against real lending benchmarks instead. Giving the adaptive agent a financing decision would make this moment informative — post-semester work.",
  },
];

export const targetById = (id: string): CalibrationTarget | undefined => CALIBRATION_TARGETS.find((t) => t.id === id);
