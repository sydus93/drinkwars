/**
 * Benchmark-band derivation (scoring-layer §5, DW-045) — the display-only
 * weak/sound/strong thresholds students read their raw metrics against.
 *
 *   npm run bands            # 24 seeds, base config
 *   DW_MODULES=full npm run bands
 *
 * Bands answer the question z-scores can't: "are we running this company WELL,
 * regardless of what the rest of the room is doing?" They must therefore come from
 * the economy itself, not taste: we take the steady-state distribution of each
 * metric across the mixed-ability population (the same population the calibration
 * report card grades) and cut it at the 30th and 75th percentiles —
 *   below P30 → weak · P30–P75 → sound · above P75 → strong
 * with the median printed as the reference tick. Re-run after any economy retune
 * and paste the block below into defaults.ts (provenance comment included).
 */
import { runMixed, type RunMetrics } from "./run.js";

const N_SEEDS = Number(process.argv[2]) || 24;
const BASE_SEED = 1000;
const WARMUP = 4;

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
};

// One entry per band the UI renders — computed exactly the way the client computes
// the student's own reading from ownResult, so gauge and band always share units.
const series: Record<string, number[]> = { roic: [], interest_cover: [], segment_share: [], intangible_index: [], stakeholder_mean: [] };

for (let i = 0; i < N_SEEDS; i++) {
  const run: RunMetrics = runMixed(BASE_SEED + i);
  for (const rr of run.history) {
    if (rr.round < WARMUP) continue;
    for (const f of rr.firm_results) {
      if (f.status !== "active" || f.pnl.revenue <= 0) continue;
      const invested = f.balance_sheet.debt + f.balance_sheet.equity;
      if (invested > 0) series.roic.push(f.pnl.net_income / invested);
      // Coverage is unbounded when interest ≈ 0; cap at 20 so a debt-free quarter
      // doesn't drag the "strong" cut to infinity (the UI caps its gauge the same way).
      series.interest_cover.push(Math.min(20, f.cost_of_capital.coverage));
      series.segment_share.push(Object.values(f.segments).reduce((a, s) => a + s.share, 0));
      series.intangible_index.push(f.state.Q + f.state.B);
      series.stakeholder_mean.push((f.state.T_emp + f.state.T_inv + f.state.T_gov) / 3);
    }
  }
}

console.log(`Benchmark bands — ${N_SEEDS} mixed-population seeds, steady-state rounds ≥ ${WARMUP}${process.env.DW_MODULES ? `, modules: ${process.env.DW_MODULES}` : ", base config"}`);
console.log(`metric                n        P30 (weak<)   P50 (sound~)   P75 (strong≥)`);
const fmt = (v: number) => (Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1));
const out: string[] = [];
for (const [k, xs] of Object.entries(series)) {
  const [w, s, g] = [pct(xs, 0.3), pct(xs, 0.5), pct(xs, 0.75)];
  console.log(`${k.padEnd(20)} ${String(xs.length).padStart(6)}   ${fmt(w).padStart(11)}   ${fmt(s).padStart(12)}   ${fmt(g).padStart(13)}`);
  out.push(`      ${k}: { weak: ${fmt(w)}, sound: ${fmt(s)}, strong: ${fmt(g)} },`);
}
console.log(`\nPaste into defaults.ts scoring.benchmark_bands:\n${out.join("\n")}`);
