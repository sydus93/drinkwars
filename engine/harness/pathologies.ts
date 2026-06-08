/**
 * Balance pathology detectors (§16). Each consumes the multi-seed baseline runs
 * (and, for cooperation, the coopetition scenario) and returns a PASS/WARN/FAIL
 * finding tied to the specific config knobs that tune it. These are the gates
 * that must pass before any UI investment (application-spec §9 step 2).
 */
import type { RunMetrics } from "./run.js";

export type Severity = "PASS" | "WARN" | "FAIL";
export interface Finding {
  id: string;
  name: string;
  status: Severity;
  detail: string;
  suggestion: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  order.forEach(([, idx], k) => (r[idx] = k));
  return r;
}
function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}
const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

// ----------------------------------------------------------------------------

export function detectInvariants(runs: RunMetrics[]): Finding {
  const broken = runs.filter((r) => r.invariantError);
  return {
    id: "invariants",
    name: "Finance invariants (§7.2)",
    status: broken.length ? "FAIL" : "PASS",
    detail: broken.length ? `${broken.length}/${runs.length} runs threw: ${broken[0].invariantError}` : `Balance sheet + cash reconciliation held across all ${runs.length} runs, every firm-round.`,
    suggestion: broken.length ? "An accounting identity broke — bug in finance.ts, not a tuning issue. Fix before anything else." : "—",
  };
}

export function detectRunawayLeader(runs: RunMetrics[]): Finding {
  const finalHHI = runs.map((r) => r.hhiByRound.at(-1) ?? 0);
  const hhiSlope = runs.map((r) => (r.hhiByRound.at(-1) ?? 0) - (r.hhiByRound[Math.floor(r.hhiByRound.length / 3)] ?? 0));
  const mh = mean(finalHHI);
  const rising = mean(hhiSlope);
  let status: Severity = "PASS";
  if (mh > 0.4) status = "FAIL";
  else if (mh > 0.3 && rising > 0.05) status = "WARN";
  return {
    id: "runaway_leader",
    name: "Runaway leader (§16.1)",
    status,
    detail: `Mean final output HHI ${mh.toFixed(3)} (1.0 = monopoly, ${(1 / runs[0].assignment.length).toFixed(3)} = even); concentration drift from ⅓-mark ${rising >= 0 ? "+" : ""}${rising.toFixed(3)}.`,
    suggestion: status === "PASS" ? "Concave returns + outside option are holding the leader in check." : "Strengthen concavity (lower stocks.*.gain or use log conversion), lower learning_rate effect, or raise segment U0 so a leader can't run away.",
  };
}

export function detectDominantStrategy(runs: RunMetrics[]): Finding {
  const wins = new Map<string, number>();
  for (const r of runs) if (r.winner) wins.set(r.winner.archetype, (wins.get(r.winner.archetype) ?? 0) + 1);
  const sorted = [...wins.entries()].sort((a, b) => b[1] - a[1]);
  const topRate = sorted.length ? sorted[0][1] / runs.length : 0;
  // Mean final-score rank per archetype across runs.
  const rankAcc = new Map<string, number[]>();
  for (const r of runs) {
    const sorted2 = [...r.finalScores].sort((a, b) => b.score - a.score);
    sorted2.forEach((s, i) => {
      const arr = rankAcc.get(s.archetype) ?? [];
      arr.push(i + 1);
      rankAcc.set(s.archetype, arr);
    });
  }
  const rankStr = [...rankAcc.entries()].map(([a, rs]) => `${a} ${mean(rs).toFixed(1)}`).sort().join(", ");
  let status: Severity = "PASS";
  if (topRate > 0.6) status = "FAIL";
  else if (topRate > 0.45) status = "WARN";
  return {
    id: "dominant_strategy",
    name: "Dominant strategy (§16.2)",
    status,
    detail: `Win share by archetype over ${runs.length} seeds: ${sorted.map(([a, n]) => `${a} ${((n / runs.length) * 100).toFixed(0)}%`).join(", ") || "—"}. Mean final rank: ${rankStr}.`,
    suggestion: status === "PASS" ? "No single archetype dominates across seeds; tradeoffs look live." : `"${sorted[0]?.[0]}" wins too often — find its free lunch (price↔margin, focus↔breadth, invest↔buffer) and add a countervailing cost to the relevant knob.`,
  };
}

export function detectFlailing(runs: RunMetrics[]): Finding {
  const autocorrs: number[] = [];
  for (const r of runs) {
    const byFirm = new Map<string, number[]>();
    for (const fr of r.firmRounds) {
      const arr = byFirm.get(fr.firm_id) ?? [];
      arr.push(fr.shareSum);
      byFirm.set(fr.firm_id, arr);
    }
    for (const series of byFirm.values()) {
      if (series.length >= 4) autocorrs.push(pearson(series.slice(1), series.slice(0, -1)));
    }
  }
  const ac = mean(autocorrs);
  const status: Severity = ac < 0.3 ? "WARN" : "PASS";
  return {
    id: "flailing",
    name: "Memoryless flailing (§16.3)",
    status,
    detail: `Mean lag-1 autocorrelation of firm market share ${ac.toFixed(3)} (high ⇒ path dependence from stocks/lags, the intended behavior).`,
    suggestion: status === "PASS" ? "Stocks-with-lags are producing persistent positions, not round-to-round whipsaw." : "Positions are too volatile — increase stock lags or lower depreciation so investment commitments persist.",
  };
}

export function detectDeathSpiral(runs: RunMetrics[]): Finding {
  const nFirms = runs[0].assignment.length;
  const bankruptcyRate = mean(runs.map((r) => new Set(r.bankruptcies.map((b) => b.firm)).size / nFirms));
  let comebacks = 0;
  let behindFirms = 0;
  for (const r of runs) {
    const rounds = Math.max(...r.firmRounds.map((f) => f.round)) + 1;
    const mid = Math.floor(rounds / 2);
    const atMid = r.firmRounds.filter((f) => f.round === mid);
    const atEnd = r.finalScores;
    if (!atMid.length || !atEnd.length) continue;
    const midSorted = [...atMid].sort((a, b) => a.score - b.score); // ascending
    const bottomHalf = new Set(midSorted.slice(0, Math.floor(midSorted.length / 2)).map((f) => f.firm_id));
    const endSorted = [...atEnd].sort((a, b) => b.score - a.score); // descending
    const topHalf = new Set(endSorted.slice(0, Math.ceil(endSorted.length / 2)).map((f) => f.firm));
    for (const id of bottomHalf) {
      behindFirms++;
      if (topHalf.has(id)) comebacks++;
    }
  }
  // Rank mobility = mean |rank change| mid→end among shared firms (an agency signal
  // that doesn't require strategy adaptation the scripted archetypes can't do).
  const mobilities: number[] = [];
  for (const r of runs) {
    const rounds = Math.max(...r.firmRounds.map((f) => f.round)) + 1;
    const mid = Math.floor(rounds / 2);
    const midRank = new Map([...r.firmRounds.filter((f) => f.round === mid)].sort((a, b) => b.score - a.score).map((f, i) => [f.firm_id, i]));
    const endRank = new Map([...r.finalScores].sort((a, b) => b.score - a.score).map((f, i) => [f.firm, i]));
    for (const [id, mr] of midRank) if (endRank.has(id)) mobilities.push(Math.abs(mr - endRank.get(id)!));
  }
  const mobility = mean(mobilities);

  // FAIL is reserved for a genuine wipeout. Zero comebacks among *fixed* archetypes
  // is expected (they never reposition/re-enter), so it is a WARN flagged for the
  // adaptive playtest (§9 step 4/8), not a structural engine failure.
  let status: Severity = "PASS";
  if (bankruptcyRate > 0.5) status = "FAIL";
  else if (bankruptcyRate > 0.42 || (comebacks === 0 && behindFirms > 0)) status = "WARN";
  return {
    id: "death_spiral",
    name: "Death spiral / no agency (§16.4)",
    status,
    detail: `Mean bankruptcy rate ${(bankruptcyRate * 100).toFixed(0)}%; ${comebacks}/${behindFirms} behind-at-midpoint firms recovered to the top half; mean rank mobility ${mobility.toFixed(2)}.`,
    suggestion:
      status === "PASS"
        ? "Shakeout is bounded; rank order is not frozen."
        : bankruptcyRate > 0.42
          ? "Bankruptcies trending high — soften the cash bleed (lower fixed_overhead / fixed_cost_per_unit, raise starting_cash) or slow shock onset."
          : "No comebacks among the fixed archetypes (expected — they never re-enter/reposition). Validate comeback agency with adaptive play and the re-entry path in the playtest before trusting this gate.",
  };
}

export function detectFirstRoundLottery(runs: RunMetrics[]): Finding {
  const spearmans: number[] = [];
  for (const r of runs) {
    const r1 = r.firmRounds.filter((f) => f.round === 1);
    if (r1.length < 3) continue;
    const r1Map = new Map(r1.map((f) => [f.firm_id, f.score]));
    const finalCommon = r.finalScores.filter((f) => r1Map.has(f.firm));
    if (finalCommon.length < 3) continue;
    spearmans.push(spearman(finalCommon.map((f) => r1Map.get(f.firm)!), finalCommon.map((f) => f.score)));
  }
  // Earliest round any shock fires across runs (early randomness would be a lottery driver).
  let earliestShock = Infinity;
  for (const r of runs) {
    r.history.forEach((h) => {
      if (h.events.some((e) => e.startsWith("SHOCK")) && h.round < earliestShock) earliestShock = h.round;
    });
  }
  // Cross-seed dispersion of each archetype's final score.
  const byArch = new Map<string, number[]>();
  for (const r of runs) for (const s of r.finalScores) (byArch.get(s.archetype) ?? byArch.set(s.archetype, []).get(s.archetype)!).push(s.score);
  const crossSeedStd = mean([...byArch.values()].map(std));
  const sp = mean(spearmans);
  const status: Severity = earliestShock < 4 ? "WARN" : "PASS";
  return {
    id: "first_round_lottery",
    name: "First-round lottery (§16.5)",
    status,
    detail: `Earliest shock at round ${Number.isFinite(earliestShock) ? earliestShock : "none"} (design wants shocks mid/late); Spearman(round-1 rank, final rank) ${sp.toFixed(2)}; cross-seed archetype score σ ${crossSeedStd.toFixed(3)}.`,
    suggestion: status === "PASS" ? "Early randomness is suppressed; outcomes track strategy, not an opening dice roll." : "Push shock earliest_round later and keep round-1 deterministic so the opening isn't a lottery.",
  };
}

export function detectThinSegmentMonopoly(runs: RunMetrics[]): Finding {
  let worstSeg = "";
  let worstSustained = 0;
  for (const r of runs) {
    for (const [seg, series] of r.maxSegShareByRound) {
      // Longest run of consecutive rounds above 0.7, take its min share as "sustained".
      let i = 0;
      while (i < series.length) {
        if (series[i] > 0.7) {
          let j = i;
          let minShare = 1;
          while (j < series.length && series[j] > 0.7) {
            minShare = Math.min(minShare, series[j]);
            j++;
          }
          if (j - i >= 3 && minShare > worstSustained) {
            worstSustained = minShare;
            worstSeg = seg;
          }
          i = j;
        } else i++;
      }
    }
  }
  let status: Severity = "PASS";
  if (worstSustained > 0.85) status = "FAIL";
  else if (worstSustained > 0.7) status = "WARN";
  return {
    id: "thin_segment_monopoly",
    name: "Thin-segment monopoly (§16.7 / §5.3)",
    status,
    detail: worstSustained > 0 ? `Worst sustained (≥3 rounds) within-segment share: ${(worstSustained * 100).toFixed(0)}% in "${worstSeg}".` : "No segment sustained a >70% single-firm share.",
    suggestion: status === "PASS" ? "Outside option + cross-segment substitution are preventing accidental monopoly." : `Raise "${worstSeg}" U0 and/or demand.cross_segment_substitution so a near-empty segment doesn't hand one firm uncontested rents.`,
  };
}

export function detectDegenerateCooperation(coop: RunMetrics): Finding {
  const cartelActiveAtEnd = (coop.agreementCountByRound.at(-1) ?? 0) > 0;
  const cartelMembers = new Set(["firm_1", "firm_2", "firm_3"]);
  const sorted = [...coop.finalScores].sort((a, b) => b.score - a.score);
  const cartelInTop3 = sorted.slice(0, 3).filter((s) => cartelMembers.has(s.firm)).length;
  const lateOutside = mean(coop.outsideShareByRound.slice(-4));
  const sleepy = lateOutside > 0.5;
  let status: Severity = "PASS";
  // Degenerate = a stable, profitable cartel that antitrust never disturbs.
  if (cartelActiveAtEnd && !coop.antitrustFired && cartelInTop3 >= 2 && sleepy) status = "FAIL";
  else if (cartelActiveAtEnd && !coop.antitrustFired) status = "WARN";
  return {
    id: "degenerate_cooperation",
    name: "Degenerate cooperation (§16.6 / §11.4)",
    status,
    detail: `Capacity-coordination guild active at end: ${cartelActiveAtEnd}; antitrust ever fired: ${coop.antitrustFired}; cartel members in top 3: ${cartelInTop3}/3; late-game outside-option share ${(lateOutside * 100).toFixed(0)}% (sleepy >50%).`,
    suggestion: status === "PASS" ? "Antitrust trigger + defection trust-cost are keeping cooperation honest." : "A stable cartel persists undisturbed — raise antitrust base_prob / lower antitrust_coordination_threshold, or raise capacity_restraint's antitrust exposure.",
  };
}

export function runAllDetectors(baseline: RunMetrics[], coop: RunMetrics): Finding[] {
  return [
    detectInvariants(baseline),
    detectRunawayLeader(baseline),
    detectDominantStrategy(baseline),
    detectFlailing(baseline),
    detectDeathSpiral(baseline),
    detectFirstRoundLottery(baseline),
    detectThinSegmentMonopoly(baseline),
    detectDegenerateCooperation(coop),
  ];
}
