/**
 * Stock dynamics (§2 "stocks with depreciation and lags", §3.1).
 *
 *   S_{t+1} = (1 - δ)·S_t + convert(invest_{t-lag})
 *
 * Every investable intangible (Q, B, the three stakeholder sub-stocks, process)
 * and capacity share this machinery. Concave conversion prevents within-round
 * rich-get-richer (§16.1); the lag pipeline creates path dependence and stops
 * single-round whipsaw exploits (§2).
 */
import type { ConversionKind } from "../types.js";

/** Concave (or linear) $→stock conversion. */
export function convert(amount: number, conversion: ConversionKind, gain: number): number {
  const a = Math.max(0, amount);
  switch (conversion) {
    case "sqrt":
      return gain * Math.sqrt(a);
    case "log":
      return gain * Math.log1p(a);
    case "linear":
    default:
      return gain * a;
  }
}

/**
 * Advance a lag pipeline by one round. The pipeline holds the `lag` most recent
 * not-yet-matured investments, oldest at index 0. Push this round's investment,
 * return the matured one (made `lag` rounds ago). lag=0 ⇒ matures immediately.
 */
export function advancePipeline(pipeline: number[], lag: number, newInvest: number): { matured: number; pipeline: number[] } {
  if (lag <= 0) return { matured: Math.max(0, newInvest), pipeline: [] };
  const p = pipeline.slice();
  while (p.length < lag) p.unshift(0);
  const matured = p.shift() ?? 0;
  p.push(Math.max(0, newInvest));
  return { matured, pipeline: p };
}

/** Apply depreciation to the prior stock and add the matured, converted investment. */
export function updateStock(prev: number, depreciation: number, maturedInvest: number, conversion: ConversionKind, gain: number): number {
  return (1 - depreciation) * prev + convert(maturedInvest, conversion, gain);
}

/** Initialize a zero-filled pipeline of the right length for a given lag. */
export function emptyPipeline(lag: number): number[] {
  return new Array(Math.max(0, lag)).fill(0);
}
