/**
 * Bundle entry for the Supabase Edge Function. esbuild bundles exactly what the
 * Deno function needs — the orchestrator, the Supabase adapter, and the
 * browser-safe config builder — into one module, so the function needs no
 * workspace/node resolution at deploy time. @supabase/supabase-js is left
 * external (the function imports it via npm: in the Deno import map).
 *
 * Note: resolveConfig (not loadConfig) — no node:fs, so the bundle stays
 * Deno-safe.
 */
export { GameOrchestrator } from "./lifecycle.js";
export { SupabaseAdapter } from "./adapters/supabase.js";
export { buildInstructorDashboard, dashboardToCsv } from "./dashboard.js";
export { randomBreweryNames, renameFirms } from "./names.js";
export { resolveConfig, roleBriefings } from "drinkwars-engine";
