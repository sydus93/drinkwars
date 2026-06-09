/**
 * Live connectivity + round-trip check for the Supabase StorageAdapter.
 * Loads server/.env, exercises the mutable CRUD path + lock semantics against the
 * real database, confirms every table is reachable (i.e. the schema is applied),
 * then deletes the throwaway game so nothing is left behind.
 *
 *   Run:  npm run supabase:smoke   (from server/)
 *
 * It writes no append-only rows, so the cleanup delete cascades cleanly.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdapter } from "./adapters/supabase.js";
import type { DecisionRecord, GameRecord, TeamRecord } from "./types.js";

// Load server/.env into process.env (no dependency).
try {
  const envPath = new URL("../.env", import.meta.url);
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* env may be supplied externally */
}

const ok = (label: string) => console.log(`  ✓ ${label}`);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "SUPABASE_URL missing in server/.env");
  assert(key, "SUPABASE_SERVICE_ROLE_KEY missing in server/.env");
  console.log(`Supabase: ${url}`);

  const store = createSupabaseAdapter();
  const raw = createClient(url, key, { auth: { persistSession: false } });

  const gameId = randomUUID();
  const teamId = randomUUID();
  let wroteGame = false;

  try {
    // 1. games — create, read, jsonb + timestamptz round-trip
    const game: GameRecord = {
      id: gameId, config: { smoke: true } as any, n_rounds: 3, current_round: 0,
      lifecycle: "open", join_code: null, created_at: Date.now(),
    };
    await store.createGame(game);
    wroteGame = true;
    const g1 = await store.getGame(gameId);
    assert(g1 && g1.lifecycle === "open" && (g1.config as any).smoke === true, "getGame round-trips config + lifecycle");
    assert(typeof g1!.created_at === "number" && g1!.created_at > 0, "created_at maps timestamptz -> epoch ms");
    ok("games: create / read / jsonb + timestamptz round-trip");

    await store.setGameLifecycle(gameId, "locked", 1);
    const g2 = await store.getGame(gameId);
    assert(g2 && g2.lifecycle === "locked" && g2.current_round === 1, "lifecycle update persisted");
    ok("games: lifecycle update");

    // 2. teams — no members (avoids the auth.users FK); exercise the join mapping
    const team: TeamRecord = { id: teamId, game_id: gameId, firm_id: "firm_1", name: "Smoke Brewing", member_user_ids: [] };
    await store.createTeam(team);
    const teams = await store.getTeams(gameId);
    assert(teams.length === 1 && teams[0].firm_id === "firm_1", "getTeams returns the team");
    const t1 = await store.getTeam(teamId);
    assert(t1 && Array.isArray(t1.member_user_ids), "getTeam reconstructs member_user_ids via team_members join");
    ok("teams: create / read / team_members join");

    // 3. decisions — upsert, revise, read, lock, locked-write rejected
    const dec: DecisionRecord = {
      game_id: gameId, round: 0, team_id: teamId, firm_id: "firm_1", decision: { smoke: true } as any,
      submitted: true, locked: false, revision_count: 1, submitted_at: Date.now(), first_opened_at: Date.now(),
    };
    await store.upsertDecision(dec);
    await store.upsertDecision({ ...dec, revision_count: 2 });
    const d1 = await store.getDecision(gameId, 0, teamId);
    assert(d1 && d1.revision_count === 2 && d1.submitted === true, "decision upsert + revise");
    assert(typeof d1!.submitted_at === "number", "decision submitted_at maps timestamptz -> ms");
    assert((await store.getDecisions(gameId, 0)).length === 1, "getDecisions by round");
    ok("decisions: upsert / revise / read");

    await store.lockDecisions(gameId, 0);
    const d2 = await store.getDecision(gameId, 0, teamId);
    assert(d2 && d2.locked === true, "lockDecisions set locked");
    let threw = false;
    try { await store.upsertDecision({ ...dec, revision_count: 3 }); } catch { threw = true; }
    assert(threw, "upsert on a locked decision is rejected");
    ok("decisions: lock + locked-write rejected");

    // 4. reachability of every append-only / research table (confirms schema applied)
    assert((await store.getLatestWorldState(gameId)) === null, "world_states reachable");
    assert((await store.getRoundResults(gameId)).length === 0, "round_results reachable");
    assert((await store.getFirmRounds(gameId)).length === 0, "firm_round reachable");
    assert((await store.getAgreements(gameId)).length === 0, "agreements reachable");
    assert((await store.getBeliefs(gameId)).length === 0, "beliefs reachable");
    assert((await store.getTelemetry(gameId)).length === 0, "telemetry reachable");
    assert((await store.getReflections(gameId)).length === 0, "reflections reachable");
    assert((await store.getDistinctiveness(gameId)).length === 0, "distinctiveness reachable");
    ok("all research/append-only tables reachable (schema applied; RLS bypassed by service role)");

    console.log("\nAll checks passed — SupabaseAdapter is wired to the live database.");
  } finally {
    if (wroteGame) {
      const { error } = await raw.from("games").delete().eq("id", gameId);
      if (error) console.warn(`(cleanup) could not delete test game ${gameId}: ${error.message}`);
      else console.log(`(cleanup) removed test game ${gameId}`);
    }
  }
}

main().catch((e) => {
  console.error("\nSMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
