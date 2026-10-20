/**
 * Drink Wars — persistence + orchestration layer, public API.
 * The presentation layer (future) reads/writes only through this; it never calls
 * the engine directly (application-spec §2.3).
 */
export * from "./types.js";
export * from "./dashboard.js";
export * from "./debrief.js"; // DW-068 phase 2: the board-meeting debrief (pure; canonical rules)
export { GameOrchestrator, LifecycleError, gamemasterOverlay, type CreateGameInput, type GamemasterIntervention, type InstructorTeamDecisions, type InstructorTeamDecision, type InstructorTeamSeat } from "./lifecycle.js";
export { InMemoryAdapter } from "./adapters/memory.js";
export { randomBreweryNames, renameFirms, visibleEvents } from "./names.js";
export { SupabaseAdapter, createSupabaseAdapter } from "./adapters/supabase.js";
export { withRequestCache } from "./request-cache.js";
export * from "./forecasts.js";
