/**
 * Drink Wars engine — public API. The engine is a pure, backend-agnostic
 * resolution function (state, decisions, config, seed) → (next state, results),
 * per model spec §1/§13. The persistence/UI layers depend on this; they never
 * reimplement resolution logic.
 */
export * from "./types.js";
export { defaultConfig } from "./config/defaults.js";
export { resolveConfig, deepMerge } from "./config/resolve.js";
export { validateConfig, ConfigError } from "./config/schema.js";
export { initGame, initFirm } from "./engine/init.js";
export { resolveRound } from "./engine/resolve.js";
export { firmValuation, InvariantError } from "./engine/finance.js";
export { resilienceMitigation, rollTimeline } from "./engine/shocks.js";
export { RNG, deriveSeed } from "./rng.js";
// Adaptive best-response bot (single-player NPCs, harness, student onboarding).
export { decideAdaptive, ADAPTIVE_LEANS } from "./bots/adaptive.js";
export type { Lean } from "./bots/adaptive.js";
// NOTE: the filesystem/YAML loader `loadConfig` is Node-only — import it from
// "drinkwars-engine/node". The package root stays browser-safe (no node:fs).

import type { Config, FirmDecision, RoundResult, WorldState } from "./types.js";
import { initGame } from "./engine/init.js";
import { resolveRound } from "./engine/resolve.js";

/** Convenience: a decision provider supplies each active firm's vector for a round. */
export type DecisionProvider = (world: WorldState, config: Config) => FirmDecision[];

/** Run a full game headless from a config and a decision provider (used by the harness). */
export function runGame(config: Config, provider: DecisionProvider): { history: RoundResult[]; finalWorld: WorldState } {
  let world = initGame(config);
  const history: RoundResult[] = [];
  for (let r = 0; r < config.game.n_rounds; r++) {
    const decisions = provider(world, config);
    const { world: next, result } = resolveRound(world, decisions, config);
    history.push(result);
    world = next;
  }
  return { history, finalWorld: world };
}
