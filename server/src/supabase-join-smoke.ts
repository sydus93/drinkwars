/**
 * Live verification of the multiplayer JOIN flow against the real database.
 * Creates a game + open slots directly via the adapter (no world_state, so it
 * cleans up), spins up two real auth users, joins them by code, checks slot
 * assignment + display names + the full-game guard, then deletes everything.
 *
 *   Run:  npm run supabase:join   (from server/)   — needs migration 0002 applied.
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdapter, GameOrchestrator } from "./index.js";
import type { GameRecord, TeamRecord } from "./types.js";

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

  const store = createSupabaseAdapter();
  const orch = new GameOrchestrator(store);
  const raw = createClient(url, key, { auth: { persistSession: false } });

  const gameId = randomUUID();
  const code = GameOrchestrator.makeJoinCode();
  const userIds: string[] = [];
  let createdGame = false;

  try {
    // Game row + 2 open slots, created directly via the adapter (no world_state → cleanable).
    const game: GameRecord = {
      id: gameId, config: { mp_smoke: true } as any, n_rounds: 1, current_round: 0,
      lifecycle: "open", join_code: code, owner_tag: null, created_at: Date.now(),
    };
    await store.createGame(game);
    createdGame = true;
    for (const firm of ["firm_1", "firm_2"]) {
      const team: TeamRecord = { id: randomUUID(), game_id: gameId, firm_id: firm, name: `Open ${firm}`, member_user_ids: [] };
      await store.createTeam(team);
    }
    ok(`created game + 2 open slots, join code ${code}`);

    assert((await store.getGameByCode(code))?.id === gameId, "getGameByCode resolves the game");
    ok("getGameByCode works — migration 0002 (join_code) is applied");

    for (const name of ["Alice Brewing", "Bob's Taproom"]) {
      const { data, error } = await raw.auth.admin.createUser({ email: `smoke-${randomUUID()}@drinkwars.test`, email_confirm: true });
      if (error || !data.user) throw new Error(`admin.createUser failed: ${error?.message}`);
      userIds.push(data.user.id);
      const res = await orch.joinGame(code, name, data.user.id);
      assert(res.gameId === gameId, "joinGame returns the game");
    }
    ok("two authenticated users joined (users + team_members FK writes ok)");

    const teams = await store.getTeams(gameId);
    assert(teams.filter((t) => t.member_user_ids.length === 1).length === 2, "both slots claimed by distinct firms");
    const names = teams.map((t) => t.name).sort();
    assert(names[0] === "Alice Brewing" && names[1] === "Bob's Taproom", "display names persisted to teams");
    ok("slots claimed; display names saved");

    // Full game rejects a third joiner.
    const { data: u3, error: e3 } = await raw.auth.admin.createUser({ email: `smoke-${randomUUID()}@drinkwars.test`, email_confirm: true });
    if (e3 || !u3.user) throw new Error(`admin.createUser failed: ${e3?.message}`);
    userIds.push(u3.user.id);
    let threw = false;
    try { await orch.joinGame(code, "Carol", u3.user.id); } catch { threw = true; }
    assert(threw, "joining a full game is rejected");
    ok("full game rejected");

    console.log("\nJoin flow verified live — multiplayer join works against the real database.");
  } finally {
    if (createdGame) {
      const { error } = await raw.from("games").delete().eq("id", gameId);
      if (error) console.warn(`(cleanup) game delete: ${error.message}`);
    }
    for (const uid of userIds) {
      const { error } = await raw.auth.admin.deleteUser(uid);
      if (error) console.warn(`(cleanup) auth user ${uid}: ${error.message}`);
    }
    console.log(`(cleanup) removed test game + ${userIds.length} auth users`);
  }
}

main().catch((e) => {
  console.error("\nJOIN SMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
