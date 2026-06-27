/**
 * Drink Wars engine — public API. The engine is a pure, backend-agnostic
 * resolution function (state, decisions, config, seed) → (next state, results),
 * per model spec §1/§13. The persistence/UI layers depend on this; they never
 * reimplement resolution logic.
 */
export * from "./types.js";
export { defaultConfig } from "./config/defaults.js";
export { resolveConfig, deepMerge } from "./config/resolve.js";
// Expansion-module registry, presets, and accessors (04_expansion_module_spec).
export {
  defaultModules, MODULE_REGISTRY, MODULE_CATEGORIES, moduleMeta, PRESETS, presetById,
  moduleEnabled, inventoryEnabled, modulesOverride,
} from "./config/modules.js";
export type { ModuleMeta, ModuleCategory, Preset } from "./config/modules.js";
export { validateConfig, ConfigError } from "./config/schema.js";
export { initGame, initFirm } from "./engine/init.js";
export { resolveRound } from "./engine/resolve.js";
export { firmValuation, InvariantError } from "./engine/finance.js";
export { resilienceMitigation, rollTimeline } from "./engine/shocks.js";
export { activeMarkets } from "./engine/geography.js";
export { roleBriefings } from "./engine/briefings.js";
export type { RoleBriefing } from "./engine/briefings.js";
// Coopetition (MOD-A05/A06) + lobbying (MOD-A09) presentation summaries.
export { summarizeAgreementsFor, summarizeLobbying, projectMarkets, projectFirms, projectShocks, projectHistory } from "./engine/views.js";
export type { AllianceSummary, AllianceClauseSummary, LobbySummary } from "./engine/views.js";
export { generateHiringMarket } from "./engine/employees.js";
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
