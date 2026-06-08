/**
 * Drink Wars — persistence + orchestration layer, public API.
 * The presentation layer (future) reads/writes only through this; it never calls
 * the engine directly (application-spec §2.3).
 */
export * from "./types.js";
export { GameOrchestrator, LifecycleError, type CreateGameInput } from "./lifecycle.js";
export { InMemoryAdapter } from "./adapters/memory.js";
