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
 * with the median printed as the reference tick. Re-run after any economy retune.
 *
 * DO NOT PASTE THE BLOCK BLINDLY (DW-056). This prints a DISTRIBUTION, not a
 * prescription, and two of the five metrics have an outside referent that beats the
 * simulated spread:
 *   · interest_cover comes out {weak 0.0, sound 19.3, strong 20.0} because most firms
 *     carry almost no debt, so coverage hits the 999 sentinel and clips at the 20 cap —
 *     the distribution is bimodal (losing money, or no interest to cover) with nothing
 *     in between. The shipped {1.5, 3.0, 6.0} is the textbook rule of thumb, which is
 *     what a student should be learning to read. Keep it.
 *   · roic's P30 lands slightly negative; the shipped weak: 0.0 ("weak means you lost
 *     money") is a cleaner line to teach than -0.022.
 * Take the empirical cut for segment_share, intangible_index and stakeholder_mean —
 * those have no outside benchmark and are pure "how does this room compare" gauges.
 * These bands are display-only: web/src/components/Scorecard.tsx and Statements.tsx
 * read them to colour a gauge. They do NOT enter the engine's scoring.
 */
import { runMixed, type RunMetrics } from "./run.js";

const N_SEEDS = Number(process.argv[2]) || 24;
const BASE_SEED = 1000;
const WARMUP = Number(process.env.DW_BANDS_FROM ?? 4);
/** Last round to sample, inclusive. The shipped bands describe a full 16-round
 *  tournament, but a classroom sprint is 4-5 rounds and the intangible stocks have
 *  barely started compounding by then — so a sprint has to be gauged against its own
 *  window or every team reads "weak". `DW_BANDS_TO=5 npm run bands` prints that window. */
const WINDOW_END = Number(process.env.DW_BANDS_TO ?? Infinity);

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
/** Same samples, tagged with the round they came from, for the schedule emitter below.
 *  Filled regardless of the DW_BANDS_FROM/TO window so a schedule always covers every round. */
const seriesByRound = new Map<string, { round: number; v: number }[]>(Object.keys(series).map((k) => [k, []]));

for (let i = 0; i < N_SEEDS; i++) {
  const run: RunMetrics = runMixed(BASE_SEED + i);
  for (const rr of run.history) {
    const inWindow = rr.round >= WARMUP && rr.round <= WINDOW_END;
    for (const f of rr.firm_results) {
      if (f.status !== "active" || f.pnl.revenue <= 0) continue;
      const invested = f.balance_sheet.debt + f.balance_sheet.equity;
      const add = (k: string, v: number) => {
        if (inWindow) series[k].push(v);
        seriesByRound.get(k)!.push({ round: rr.round, v });
      };
      if (invested > 0) add("roic", f.pnl.net_income / invested);
      // Coverage is unbounded when interest ≈ 0; cap at 20 so a debt-free quarter
      // doesn't drag the "strong" cut to infinity (the UI caps its gauge the same way).
      add("interest_cover", Math.min(20, f.cost_of_capital.coverage));
      add("segment_share", Object.values(f.segments).reduce((a, s) => a + s.share, 0));
      add("intangible_index", f.state.Q + f.state.B);
      add("stakeholder_mean", (f.state.T_emp + f.state.T_inv + f.state.T_gov) / 3);
    }
  }
}

const windowLabel = Number.isFinite(WINDOW_END) ? `rounds ${WARMUP}-${WINDOW_END}` : `steady-state rounds ≥ ${WARMUP}`;
console.log(`Benchmark bands — ${N_SEEDS} mixed-population seeds, ${windowLabel}${process.env.DW_MODULES ? `, modules: ${process.env.DW_MODULES}` : ", base config"}`);
console.log(`metric                n        P30 (weak<)   P50 (sound~)   P75 (strong≥)`);
const fmt = (v: number) => (Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1));
const out: string[] = [];
for (const [k, xs] of Object.entries(series)) {
  const [w, s, g] = [pct(xs, 0.3), pct(xs, 0.5), pct(xs, 0.75)];
  console.log(`${k.padEnd(20)} ${String(xs.length).padStart(6)}   ${fmt(w).padStart(11)}   ${fmt(s).padStart(12)}   ${fmt(g).padStart(13)}`);
  out.push(`      ${k}: { weak: ${fmt(w)}, sound: ${fmt(s)}, strong: ${fmt(g)} },`);
}
// ── Round-indexed schedule (DW-057) ──────────────────────────────────────────
// The single steady-state cut above describes a 16-round tournament, but these metrics are
// STOCKS that compound: the median firm's stakeholder mean runs 9.0 at round 0 and 34.3 at
// round 15, and intangibles more than double. A flat band therefore cannot serve a 4-round
// sprint and a full season at once — and it is the round, not the planned game length, that
// decides where a firm should be: round 2 of a 4-round game and round 2 of a 12-round game
// are the same firm. So we cut each metric per round-bucket and emit a schedule.
// interest_cover is deliberately EXCLUDED — it saturates at the 20 cap (most firms carry
// almost no debt) so its empirical cut is noise; the textbook 1.5/3/6 stays. roic's `weak`
// is pinned to 0.0 for the same reason: "you lost money" is the line worth teaching.
// Buckets: the first four rounds get one each, because that is BOTH the most volatile stretch
// (everyone posts a founding loss in r0, then r1 reaps the capacity r0 paid for) AND the exact
// window a 4-round classroom sprint plays. After that the curves flatten and wider buckets are
// honest. A round-indexed schedule serves every game length for free: round 2 of a 4-round game
// and round 2 of a 12-round game are the same firm.
const SCHEDULE_BUCKETS: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 5], [6, 9], [10, 99]];
const SCHEDULED = ["roic", "segment_share", "intangible_index", "stakeholder_mean"];
if (process.env.DW_BANDS_SCHEDULE) {
  console.log(`\nRound-indexed schedule — paste into defaults.ts scoring.benchmark_bands_by_round:`);
  console.log("    benchmark_bands_by_round: [");
  for (const [lo, hi] of SCHEDULE_BUCKETS) {
    const rows: string[] = [];
    for (const k of SCHEDULED) {
      const xs = seriesByRound.get(k)?.filter((x) => x.round >= lo && x.round <= hi).map((x) => x.v) ?? [];
      if (!xs.length) continue;
      const p30 = pct(xs, 0.3), p50 = pct(xs, 0.5), p75 = pct(xs, 0.75);
      // Round 0 is not gradable against an ABSOLUTE standard and is forced degenerate for
      // every metric. Measured: across 192 firm-rounds the founding quarter produces just
      // THREE distinct intangible values and six distinct share values, because every firm
      // starts identical and the one quarter of investment it has made has not landed yet
      // (stocks lag a quarter). A percentile cut on a three-point distribution is noise — it
      // put 0% of the field in "weak" against its own P30 and 50% in "strong". The relative
      // reading ("ahead of the field") still works in round 0; the absolute one cannot.
      const ungradable = hi === 0;
      // roic's weak stays the teaching line "you lost money".
      const weak = k === "roic" ? 0 : p30;
      // A band only means something if the field actually spreads ABOVE weak. Two cases fail
      // that, both in the founding quarter, and both must suppress the tier rather than invent
      // one: stakeholder trust is exactly 9.0 for every firm (investment lands a quarter later,
      // so nobody has moved yet), and roic is negative for the whole field (a founding loss is
      // what building a brewery costs — there is no absolute standard to grade it against, and
      // ranking teams by who lost least would reward under-investing). The degenerate triple is
      // how the schedule says "no meaningful band this round"; the UI reads strong <= weak and
      // shows an explanation instead of a gauge.
      const degenerate = ungradable || !(p75 > weak);
      const [w, so, st] = degenerate ? [p50, p50, p50] : [weak, Math.max(weak, p50), p75];
      rows.push(`${k}: { weak: ${fmt(w)}, sound: ${fmt(so)}, strong: ${fmt(st)} }`);
    }
    console.log(`      { from_round: ${lo}, bands: { ${rows.join(", ")} } },`);
  }
  console.log("    ],");
}

console.log(`\nEmpirical cut (read the header before pasting — interest_cover and roic keep their\ntextbook thresholds on purpose):\n${out.join("\n")}`);
