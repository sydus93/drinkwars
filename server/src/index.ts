/**
 * Drink Wars — persistence + orchestration layer, public API.
 * The presentation layer (future) reads/writes only through this; it never calls
 * the engine directly (application-spec §2.3).
 */
export * from "./types.js";
export * from "./dashboard.js";
export { GameOrchestrator, LifecycleError, type CreateGameInput } from "./lifecycle.js";
export { InMemoryAdapter } from "./adapters/memory.js";
export { randomBreweryNames, renameFirms } from "./names.js";
export { SupabaseAdapter, createSupabaseAdapter } from "./adapters/supabase.js";
