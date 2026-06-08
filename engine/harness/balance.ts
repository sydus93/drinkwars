/**
 * Balance harness entry point (application-spec §9 step 2 / model-spec §16).
 * Runs the baseline across many seeds + the coopetition scenario, checks
 * determinism and the finance invariants, runs every §16 pathology detector, and
 * prints a gate report. Also writes a sample firm_round CSV to confirm the §15.1
 * Stata export schema. THIS MUST PASS before any UI work begins.
 *
 *   npm run balance            # 24 seeds
 *   npm run balance -- 60      # custom seed count
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { ConfigError } from "../src/index.js";
import { loadConfig } from "../src/config/load.js";
import { BASELINE_ASSIGNMENT } from "./archetypes.js";
import { coopetitionScenario, runAdaptive, runBaseline, type RunMetrics } from "./run.js";
import { detectDominantStrategy, detectRunawayLeader, detectThinSegmentMonopoly, runAllDetectors, type Finding, type Severity } from "./pathologies.js";

const N_SEEDS = Number(process.argv[2]) || 24;
const BASE_SEED = 1000;

function bar(label: string): void {
  console.log(`\n${"─".repeat(78)}\n${label}\n${"─".repeat(78)}`);
}
const TAG: Record<Severity, string> = { PASS: "  PASS", WARN: "» WARN", FAIL: "✗ FAIL" };

// --- 1. Sanity: the loader rejects a broken config (application-spec §7.4) ----
bar("CONFIG LOADER");
try {
  loadConfig({ scoring: { weights: { financial: 0.5, market: 0.5, intangible: 0.5, stakeholder: 0.5 } } } as never);
  console.log("  ✗ loader accepted weights that sum to 2.0 — validation gap");
} catch (e) {
  console.log(`  PASS  baseline loads; bad override rejected (${e instanceof ConfigError ? e.issues[0] : "error"})`);
}
console.log(`  PASS  baseline config: ${loadConfig().game.n_firms} firms, ${loadConfig().game.n_rounds} rounds, ${loadConfig().segments.length} segments`);

// --- 2. Determinism (application-spec §3.3 replayability) ---------------------
bar("DETERMINISM");
{
  const a = runBaseline(BASE_SEED);
  const b = runBaseline(BASE_SEED);
  const same =
    a.finalScores.length === b.finalScores.length &&
    a.finalScores.every((s, i) => s.firm === b.finalScores[i].firm && Math.abs(s.score - b.finalScores[i].score) < 1e-12);
  console.log(`  ${same ? "PASS" : "✗ FAIL"}  same (config, seed) reproduces identical final scores`);
}

// --- 3. Run the sweep ---------------------------------------------------------
bar(`BASELINE SWEEP — ${N_SEEDS} seeds × ${BASELINE_ASSIGNMENT.length} firms × ${loadConfig().game.n_rounds} rounds`);
const baseline: RunMetrics[] = [];
for (let i = 0; i < N_SEEDS; i++) baseline.push(runBaseline(BASE_SEED + i));
const coop = coopetitionScenario(BASE_SEED).metrics;

const meanBankrupt = baseline.reduce((a, r) => a + new Set(r.bankruptcies.map((b) => b.firm)).size, 0) / baseline.length;
const meanFinalActive = baseline.reduce((a, r) => a + r.finalScores.filter((s) => s.status === "active").length, 0) / baseline.length;
const frontierRuns = baseline.filter((r) => r.history.some((h) => h.events.some((e) => e.startsWith("NEW CATEGORY")))).length;
console.log(`  Mean firms bankrupt: ${meanBankrupt.toFixed(1)}/${BASELINE_ASSIGNMENT.length}   |   mean still active at end: ${meanFinalActive.toFixed(1)}`);
console.log(`  Frontier segment emerged in ${frontierRuns}/${N_SEEDS} runs.`);

// One representative run's standings.
const rep = baseline[0];
console.log(`\n  Representative run (seed ${rep.seed}) final standings:`);
[...rep.finalScores].sort((a, b) => b.score - a.score).forEach((s, i) => {
  console.log(`    ${String(i + 1).padStart(2)}. ${s.firm.padEnd(8)} ${s.archetype.padEnd(16)} score ${s.score.toFixed(3).padStart(7)}  [${s.status}]`);
});

// --- 4. Pathology gate --------------------------------------------------------
bar("PATHOLOGY GATE (§16)");
const findings: Finding[] = runAllDetectors(baseline, coop);
for (const f of findings) {
  console.log(`\n${TAG[f.status]}  ${f.name}`);
  console.log(`        ${f.detail}`);
  if (f.status !== "PASS") console.log(`        → ${f.suggestion}`);
}

// --- 4b. Adaptive cross-check -------------------------------------------------
// The fixed-archetype "dominant strategy" gate can't distinguish a true exploit
// from bots that simply never reposition. Re-run with adaptive best-response
// agents: if niche dominance is an artifact, crowding should erode it here.
bar("ADAPTIVE CROSS-CHECK (best-response agents)");
const adaptive: RunMetrics[] = [];
for (let i = 0; i < N_SEEDS; i++) adaptive.push(runAdaptive(BASE_SEED + i));
const adFindings = [detectDominantStrategy(adaptive), detectRunawayLeader(adaptive), detectThinSegmentMonopoly(adaptive)];
const adBankrupt = adaptive.reduce((a, r) => a + new Set(r.bankruptcies.map((b) => b.firm)).size, 0) / adaptive.length;
console.log(`  Mean firms bankrupt (adaptive): ${adBankrupt.toFixed(1)}/8`);
for (const f of adFindings) {
  console.log(`\n${TAG[f.status]}  ${f.name} [adaptive]`);
  console.log(`        ${f.detail}`);
}
console.log("\n  Read: if 'Dominant strategy' relaxes here vs the fixed sweep, the fixed-bot FAIL is largely an artifact of non-repositioning, not an engine exploit.");

// --- 5. Sample CSV export (validates §15.1 firm_round schema) ------------------
bar("DATA EXPORT (§15.1 firm_round — Stata long format)");
const SEGS = ["mass", "niche", "frontier"];
const cols = [
  "firm_id", "round", "status",
  ...SEGS.flatMap((s) => [`price_${s}`, `q_${s}`, `share_${s}`]),
  "unit_cost", "revenue", "cogs", "opex", "ebit", "interest", "net_income",
  "cash", "debt", "equity", "ppe", "Q", "B", "T_emp", "T_inv", "T_gov", "process",
  "r_debt", "coverage", "leverage", "credit_rationed",
  "score_financial", "score_market", "score_intangible", "score_stakeholder", "score_cumulative",
  "maha", "nn", "valuation", "info_purchased",
];
const rows: string[] = [cols.join(",")];
for (const rr of rep.history) {
  for (const f of rr.firm_results) {
    const seg = (s: string, k: "price" | "q_sold" | "share") => (f.segments[s]?.[k] ?? 0).toFixed(3);
    rows.push([
      f.firm_id, f.round, f.status,
      ...SEGS.flatMap((s) => [seg(s, "price"), seg(s, "q_sold"), seg(s, "share")]),
      f.unit_cost.toFixed(3), f.pnl.revenue.toFixed(2), f.pnl.cogs.toFixed(2), f.pnl.opex.toFixed(2), f.pnl.ebit.toFixed(2), f.pnl.interest.toFixed(2), f.pnl.net_income.toFixed(2),
      f.balance_sheet.cash.toFixed(2), f.balance_sheet.debt.toFixed(2), f.balance_sheet.equity.toFixed(2), f.balance_sheet.ppe.toFixed(2),
      f.state.Q.toFixed(3), f.state.B.toFixed(3), f.state.T_emp.toFixed(3), f.state.T_inv.toFixed(3), f.state.T_gov.toFixed(3), f.state.process.toFixed(3),
      f.cost_of_capital.r_debt.toFixed(4), f.cost_of_capital.coverage.toFixed(3), f.cost_of_capital.leverage.toFixed(3), f.cost_of_capital.credit_rationed ? 1 : 0,
      f.scorecard_norm.financial.toFixed(4), f.scorecard_norm.market.toFixed(4), f.scorecard_norm.intangible.toFixed(4), f.scorecard_norm.stakeholder.toFixed(4), f.scorecard_cumulative.toFixed(4),
      (f.distinctiveness?.mahalanobis ?? 0).toFixed(4), (f.distinctiveness?.nearest_neighbor ?? 0).toFixed(4), f.valuation.toFixed(2), f.info_purchased ? 1 : 0,
    ].join(","));
  }
}
mkdirSync("out", { recursive: true });
writeFileSync("out/firm_round_sample.csv", rows.join("\n"));
console.log(`  Wrote out/firm_round_sample.csv — ${rows.length - 1} firm-rounds × ${cols.length} columns.`);

// --- 6. Verdict ---------------------------------------------------------------
bar("VERDICT");
const fails = findings.filter((f) => f.status === "FAIL").length;
const warns = findings.filter((f) => f.status === "WARN").length;
console.log(`  ${findings.length} checks: ${findings.length - fails - warns} PASS, ${warns} WARN, ${fails} FAIL.`);
console.log(fails ? "  ✗ Gate not clear — resolve FAILs (and ideally WARNs) before UI work (app-spec §9).\n" : warns ? "  » Gate clear of FAILs; WARNs are tuning opportunities, not blockers.\n" : "  ✓ All pathology gates pass. Cleared for UI work per app-spec §9.\n");
