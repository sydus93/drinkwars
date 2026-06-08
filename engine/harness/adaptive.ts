/**
 * The adaptive best-response agent now lives in the engine's public API
 * (`src/bots/adaptive.ts`) so it can be reused by the single-player UI / NPCs,
 * not just the harness. This re-export keeps the harness imports stable.
 */
export * from "../src/bots/adaptive.js";
