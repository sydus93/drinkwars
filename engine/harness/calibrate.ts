/**
 * Calibration harness (DW-040) — "is the industry this engine produces the real one?"
 *
 *   npm run calibrate                  # 24 seeds, baseline config
 *   npm run calibrate -- 60            # more seeds
 *   DW_MODULES=all npm run calibrate   # pro-mode configuration (every module on)
 *
 * Runs the same sweeps the balance gate uses, but instead of hunting for game-design
 * pathologies it extracts the aggregate moments an industry economist would compute —
 * margins, capacity utilization, exit rate, concentration, leverage — and scores them
 * against published craft-beverage benchmarks (harness/calibration-targets.ts).
 *
 * THREE POPULATIONS, because "what the simulation does" depends on who is playing it:
 *   fixed     — eight scripted archetypes that never reposition. A floor: what the
 *               economy does when nobody adapts.
 *   adaptive  — eight best-response agents that re-price and re-target every round.
 *               A ceiling: since the DW-041 retrench/treasury upgrade they simply do
 *               not fail, so their exit rate measures skill, not the economy.
 *   mixed     — four best-response agents and four scripted archetypes in the same
 *               game (DW-042). A real section is exactly this mixed-ability field,
 *               and it is the population the report card grades.
 *
 * Measurement window: rounds ≥ WARMUP. Every firm starts identical and spends the first
 * quarters ramping; including that transient would drag margins and utilization down and
 * flatter the concentration number. Exit and survival are measured over the whole game.
 *
 * Output: a console report card, out/calibration.csv (every moment, both populations,
 * per seed — the file to regress on), and out/calibration.md (a paper-ready appendix).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import type { FirmRoundResult, RoundResult } from "../src/types.js";
import { loadConfig } from "../src/config/load.js";
import { runAdaptive, runBaseline, runMixed, runOverbuilder, type RunMetrics } from "./run.js";
import { CALIBRATION_TARGETS, type CalibrationTarget } from "./calibration-targets.js";

const N_SEEDS = Number(process.argv[2]) || 24;
const BASE_SEED = 1000;
const WARMUP = 4; // quarters of ramp-up excluded from the steady-state moments

// ── moment extraction ────────────────────────────────────────────────────────

/** Every moment we score, computed from one run. Null = not measurable in that run. */
interface Moments {
  gross_margin: number | null;
  net_margin: number | null;
  capacity_utilization: number | null;
  unit_price_mass: number | null;
  revenue_per_qtr: number | null;
  annual_exit_rate: number | null;
  survival_4yr: number | null;
  hhi: number | null;
  leverage: number | null;
}

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Firms that actually traded this round — a withdrawn or dead firm would drag every ratio. */
const trading = (rr: RoundResult): FirmRoundResult[] =>
  rr.firm_results.filter((f) => f.status === "active" && f.pnl.revenue > 0);

function momentsOf(run: RunMetrics, nRounds: number): Moments {
  const mature = run.history.filter((rr) => rr.round >= WARMUP);
  const firmRounds = mature.flatMap(trading);

  // Ratios are computed per firm-quarter then averaged, not as a ratio of sums: the
  // classroom question is "what does a typical brewery's P&L look like", and a
  // sum-of-sums silently weights the answer toward whichever firm got biggest.
  const grossMargins = firmRounds.map((f) => (f.pnl.revenue - f.pnl.cogs) / f.pnl.revenue);
  const netMargins = firmRounds.map((f) => f.pnl.net_income / f.pnl.revenue);
  // Utilization = PRODUCTION over INSTALLED CAPACITY, and both halves need care:
  //   numerator   — with the inventory module on a firm can sell more than it brewed by
  //                 drawing down stock, so sales overstate use of the brewhouse.
  //   denominator — FirmRoundResult.state.cap is only the generic capacity stock. With the
  //                 facilities module on, most capacity lives in facilities, and dividing
  //                 by state.cap alone produced a nonsensical 235%. run.ts snapshots the
  //                 real installed figure (generic + online facilities) as effectiveCap.
  const capAt = new Map(run.firmRounds.map((m) => [`${m.firm_id}:${m.round}`, m.effectiveCap]));
  const utilization = mature.flatMap((rr) =>
    trading(rr).map((f) => {
      const cap = capAt.get(`${f.firm_id}:${rr.round}`) ?? f.state.cap;
      if (!(cap > 0)) return null;
      const sold = Object.values(f.segments).reduce((a, s) => a + s.q_sold, 0);
      const produced = f.inventory ? f.inventory.produced : sold;
      return produced / cap;
    }).filter((x): x is number => x != null),
  );
  const massPrices = firmRounds.map((f) => f.segments.mass?.price ?? 0).filter((p) => p > 0);
  const revenues = firmRounds.map((f) => f.pnl.revenue);
  const leverages = firmRounds.filter((f) => f.balance_sheet.equity > 0).map((f) => f.balance_sheet.debt / f.balance_sheet.equity);

  // Exit: distinct firms forced out, annualized over the game's length in years.
  const nFirms = run.history[0]?.firm_results.length ?? 0;
  const exits = new Set(run.bankruptcies.map((b) => b.firm)).size;
  const years = nRounds / 4;
  const annualExit = nFirms > 0 && years > 0 ? (exits / nFirms / years) * 100 : null;
  const survivors = run.finalScores.filter((s) => s.status === "active" || s.status === "exited_invested").length;
  const survival = nFirms > 0 ? (survivors / nFirms) * 100 : null;

  // Concentration at the end of the game — where a runaway would have shown up.
  const hhi = run.hhiByRound.length ? run.hhiByRound[run.hhiByRound.length - 1] : null;

  return {
    gross_margin: pct(median(grossMargins)),
    net_margin: pct(median(netMargins)),
    capacity_utilization: pct(mean(utilization)),
    unit_price_mass: median(massPrices),
    revenue_per_qtr: median(revenues),
    annual_exit_rate: annualExit,
    survival_4yr: survival,
    hhi,
    leverage: median(leverages),
  };
}

const pct = (x: number | null): number | null => (x == null ? null : x * 100);

// ── scoring ──────────────────────────────────────────────────────────────────

type Verdict = "PASS" | "WARN" | "FAIL" | "N/A";

function verdictFor(t: CalibrationTarget, value: number | null): Verdict {
  if (value == null || !Number.isFinite(value)) return "N/A";
  if (value >= t.pass[0] && value <= t.pass[1]) return "PASS";
  if (value >= t.warn[0] && value <= t.warn[1]) return "WARN";
  return "FAIL";
}

/** Per-drink prices and per-quarter revenues share a unit but not a scale: show cents
 *  below $1,000 and thousands above it, or a $7.50 pour renders as "$8". */
const money = (v: number): string =>
  Math.abs(v) >= 1000 ? `$${Math.round(v).toLocaleString()}` : `$${v.toFixed(2)}`;

const fmt = (t: CalibrationTarget, v: number | null): string => {
  if (v == null || !Number.isFinite(v)) return "—";
  if (t.unit === "$") return money(v);
  if (t.unit === "%") return `${v.toFixed(1)}%`;
  if (t.unit === "×") return `${v.toFixed(2)}×`;
  return v.toFixed(3);
};

const band = (t: CalibrationTarget): string =>
  t.unit === "$"
    ? `${money(t.pass[0])}–${money(t.pass[1])}`
    : t.unit === "%"
      ? `${t.pass[0]}–${t.pass[1]}%`
      : `${t.pass[0]}–${t.pass[1]}`;

// ── run ──────────────────────────────────────────────────────────────────────

const config = loadConfig();
const nRounds = config.game.n_rounds;

const bar = (s: string) => console.log(`\n${"─".repeat(84)}\n${s}\n${"─".repeat(84)}`);

console.log(`Drink Wars — calibration report card`);
console.log(`  ${N_SEEDS} seeds × ${config.game.n_firms} firms × ${nRounds} rounds (${nRounds / 4} simulated years)`);
console.log(`  steady-state window: rounds ${WARMUP}–${nRounds - 1}${process.env.DW_MODULES ? `   modules: ${process.env.DW_MODULES}` : "   modules: base config"}`);

const fixedRuns: RunMetrics[] = [];
const adaptiveRuns: RunMetrics[] = [];
const mixedRuns: RunMetrics[] = [];
for (let i = 0; i < N_SEEDS; i++) {
  fixedRuns.push(runBaseline(BASE_SEED + i));
  adaptiveRuns.push(runAdaptive(BASE_SEED + i));
  mixedRuns.push(runMixed(BASE_SEED + i));
}
const fixedMoments = fixedRuns.map((r) => momentsOf(r, nRounds));
const adaptiveMoments = adaptiveRuns.map((r) => momentsOf(r, nRounds));
const mixedMoments = mixedRuns.map((r) => momentsOf(r, nRounds));

/** Across-seed central tendency of one moment — the number the report card grades. */
const across = (ms: Moments[], k: keyof Moments): number | null =>
  median(ms.map((m) => m[k]).filter((x): x is number => x != null && Number.isFinite(x)));

bar("REPORT CARD  (graded on the MIXED population — a classroom is a mixed-ability field)");
console.log(`  ${"Moment".padEnd(34)} ${"mixed".padStart(11)} ${"adaptive".padStart(11)} ${"fixed".padStart(11)}  ${"real-world".padStart(11)}  ${"pass band".padStart(17)}   verdict`);

const TAG: Record<Verdict, string> = { PASS: "PASS", WARN: "» WARN", FAIL: "✗ FAIL", "N/A": "  n/a" };
const rows: { t: CalibrationTarget; mixed: number | null; adaptive: number | null; fixed: number | null; verdict: Verdict }[] = [];
for (const t of CALIBRATION_TARGETS) {
  const m = across(mixedMoments, t.id as keyof Moments);
  const a = across(adaptiveMoments, t.id as keyof Moments);
  const f = across(fixedMoments, t.id as keyof Moments);
  const v = verdictFor(t, m);
  rows.push({ t, mixed: m, adaptive: a, fixed: f, verdict: v });
  const real = t.target == null ? "—" : fmt(t, t.target);
  console.log(
    `  ${t.label.padEnd(34)} ${fmt(t, m).padStart(11)} ${fmt(t, a).padStart(11)} ${fmt(t, f).padStart(11)}  ${real.padStart(11)}  ${band(t).padStart(17)}   ${TAG[v]}`,
  );
}

const fails = rows.filter((r) => r.verdict === "FAIL");
const warns = rows.filter((r) => r.verdict === "WARN");
bar("WHERE THE MODEL DIVERGES");
if (!fails.length && !warns.length) {
  console.log("  Every moment lands inside its empirical band.");
} else {
  for (const r of [...fails, ...warns]) {
    console.log(`\n  ${TAG[r.verdict]}  ${r.t.label}: simulated ${fmt(r.t, r.mixed)} vs ${r.t.target == null ? "band" : fmt(r.t, r.t.target)} (${r.t.kind})`);
    console.log(`         source: ${r.t.source}`);
    if (r.t.note) console.log(`         note:   ${r.t.note}`);
  }
}

// ── stylized facts without a numeric target (context, not a grade) ───────────
bar("STYLIZED FACTS  (no numeric target — read for shape)");
{
  const growth: number[] = [];
  const shareChurn: number[] = [];
  for (const run of mixedRuns) {
    for (let i = 1; i < run.history.length; i++) {
      const prev = new Map(run.history[i - 1].firm_results.map((f) => [f.firm_id, f]));
      for (const f of trading(run.history[i])) {
        const p = prev.get(f.firm_id);
        if (p && p.pnl.revenue > 0) growth.push(Math.log(f.pnl.revenue / p.pnl.revenue));
        const shareNow = Object.values(f.segments).reduce((a, s) => a + s.share, 0);
        const sharePrev = p ? Object.values(p.segments).reduce((a, s) => a + s.share, 0) : shareNow;
        shareChurn.push(Math.abs(shareNow - sharePrev));
      }
    }
  }
  const g = growth.filter(Number.isFinite);
  const gMean = mean(g) ?? 0;
  const sd = Math.sqrt((mean(g.map((x) => (x - gMean) ** 2)) ?? 0));
  const fatTail = g.filter((x) => Math.abs(x - gMean) > 2 * sd).length / (g.length || 1);
  console.log(`  Quarterly revenue growth:  mean ${(gMean * 100).toFixed(1)}%   sd ${(sd * 100).toFixed(1)}pp`);
  console.log(`  Beyond ±2sd:               ${(fatTail * 100).toFixed(1)}% of firm-quarters  (a normal distribution gives 4.6%; real firm growth is fat-tailed, so above 4.6% is the realistic direction)`);
  console.log(`  Mean |Δ market share|:     ${((mean(shareChurn) ?? 0) * 100).toFixed(2)}pp per quarter  (positions contestable, not frozen)`);
  const anyExit = mixedRuns.filter((r) => r.bankruptcies.length > 0).length;
  console.log(`  Runs with at least one exit: ${anyExit}/${N_SEEDS}  (failure has to be reachable for risk to mean anything)`);
}

// ── the stranded-capacity probe (DW-042) ─────────────────────────────────────
// A population average can't show the overbuild trap: rational agents refuse to
// walk into it. So push one firm in: same seed, same rivals, but firm 6 must build
// capacity hard through rounds 1–5. Compare it with its disciplined twin.
bar("STRANDED-CAPACITY PROBE  (is overbuilding a real mistake students can make?)");
{
  // DW-046: the probe rotates the forced firm across every slot (seed i → slot i mod 8) —
  // pinning it to one slot measured a single personality, and in the classroom preset that
  // slot happened to be the field's dominant firm, which can sell through any amount of
  // capacity. And the cost is read off TERMINAL EQUITY, not cumulative net income: capex is a
  // cash outflow that never touches the P&L, so a firm that "earned more" while spending its
  // way into bankruptcy showed a positive NI delta and a death.
  const PROBE_SEEDS = Math.min(8, N_SEEDS);
  const N_SLOTS = 8;
  let dUtil: number[] = [], dEq: number[] = [], deaths = 0;
  for (let i = 0; i < PROBE_SEEDS; i++) {
    const slot = i % N_SLOTS;
    const FIRM = `firm_${slot + 1}`;
    const twin = runAdaptive(BASE_SEED + i);
    const over = runOverbuilder(BASE_SEED + i, slot);
    const util = (run: RunMetrics) => {
      const xs = run.history.filter((rr) => rr.round >= 10).flatMap((rr) => {
        const f = rr.firm_results.find((x) => x.firm_id === FIRM && x.status === "active");
        const cap = run.firmRounds.find((m) => m.firm_id === FIRM && m.round === rr.round)?.effectiveCap ?? 0;
        if (!f || !(cap > 0)) return [];
        const sold = Object.values(f.segments).reduce((a, s) => a + s.q_sold, 0);
        return [(f.inventory ? f.inventory.produced : sold) / cap];
      });
      return mean(xs);
    };
    // Compare book equity at the SAME round: the last round both twins are still on the board.
    const rowsO = over.firmRounds.filter((m) => m.firm_id === FIRM), rowsT = twin.firmRounds.filter((m) => m.firm_id === FIRM);
    const tStar = Math.min(rowsO.length ? rowsO[rowsO.length - 1].round : 0, rowsT.length ? rowsT[rowsT.length - 1].round : 0);
    const eqAt = (rows: typeof rowsO) => rows.find((m) => m.round === tStar)?.equity ?? 0;
    const uT = util(twin), uO = util(over);
    if (uT != null && uO != null) dUtil.push(uO - uT);
    dEq.push(eqAt(rowsO) - eqAt(rowsT));
    if (over.bankruptcies.some((b) => b.firm === FIRM) && !twin.bankruptcies.some((b) => b.firm === FIRM)) deaths++;
  }
  const mU = mean(dUtil);
  // Median, not mean: one dominant slot that can sell through any capacity swings the mean by
  // millions; the median firm is the one a student team resembles.
  const sortedEq = [...dEq].sort((a, b) => a - b);
  const mE = sortedEq.length ? sortedEq[Math.floor(sortedEq.length / 2)] : null;
  const reachable = (mE != null && mE < -50_000) || deaths >= Math.ceil(PROBE_SEEDS / 4);
  console.log(`  One firm forced to over-expand into the maturing market (+40% of its own capacity per quarter, rounds 5–9 ≈ 2.5×) vs its disciplined twin, ${PROBE_SEEDS} seeds, rotating slots:`);
  console.log(`  Late-game utilization:   ${mU == null ? "—" : `${(mU * 100).toFixed(1)}pp`} vs twin  (negative = capacity sits idle)`);
  console.log(`  Terminal book equity:    ${mE == null ? "—" : `$${Math.round(mE).toLocaleString()}`} vs twin, median firm  (the cost of the mistake, capex included; per slot: ${dEq.map((x) => `${x < 0 ? "−" : "+"}${Math.round(Math.abs(x) / 1000)}k`).join(" ")})`);
  console.log(`  Overbuilder deaths its twin avoided: ${deaths}/${PROBE_SEEDS}`);
  console.log(`  Read: the trap is ${reachable ? "REACHABLE — overbuilding is a real, punishable mistake" : "NOT yet punishing — overbuilding costs too little to teach"}.`);
}

// ── artifacts ────────────────────────────────────────────────────────────────
mkdirSync("out", { recursive: true });

const csv: string[] = ["population,seed," + CALIBRATION_TARGETS.map((t) => t.id).join(",")];
for (const [pop, ms] of [["mixed", mixedMoments], ["adaptive", adaptiveMoments], ["fixed", fixedMoments]] as const) {
  ms.forEach((m, i) => {
    csv.push([pop, BASE_SEED + i, ...CALIBRATION_TARGETS.map((t) => {
      const v = m[t.id as keyof Moments];
      return v == null || !Number.isFinite(v) ? "" : v.toFixed(4);
    })].join(","));
  });
}
writeFileSync("out/calibration.csv", csv.join("\n"));

const md: string[] = [
  `# Drink Wars — calibration against the US craft-beverage industry`,
  ``,
  `${N_SEEDS} seeds × ${config.game.n_firms} firms × ${nRounds} quarters (${nRounds / 4} simulated years), mixed-ability`,
  `population (four best-response agents + four scripted archetypes per game — the shape of a real section),`,
  `steady-state moments measured over rounds ${WARMUP}–${nRounds - 1}. Generated by \`npm run calibrate\`.`,
  ``,
  `| Moment | Simulated | Real-world benchmark | Pass band | Verdict | Source |`,
  `|---|---|---|---|---|---|`,
  ...rows.map((r) => `| ${r.t.label} | ${fmt(r.t, r.mixed)} | ${r.t.target == null ? "—" : fmt(r.t, r.t.target)} | ${band(r.t)} | ${r.verdict} | ${r.t.kind === "empirical" ? r.t.source : "structural invariant"} |`),
  ``,
  `**Interpretation.** Agreement here supports the claim that the simulated industry operates`,
  `within the empirical envelope of the US craft-beverage industry — margins, utilization,`,
  `exit rates and concentration of the right order. It does not support a forecasting claim.`,
  `Rows marked *structural* are design invariants, not empirical findings.`,
  ``,
];
writeFileSync("out/calibration.md", md.join("\n"));

bar("SUMMARY");
console.log(`  ${rows.filter((r) => r.verdict === "PASS").length} pass · ${warns.length} warn · ${fails.length} fail   (of ${rows.length} moments)`);
console.log(`  Wrote out/calibration.csv and out/calibration.md`);
if (fails.length) {
  console.log(`\n  A FAIL means the emergent industry sits outside the published envelope. Fix the`);
  console.log(`  engine parameter, or — if the benchmark is the thing that's wrong — fix the target`);
  console.log(`  and record why in harness/calibration-targets.ts.`);
}
