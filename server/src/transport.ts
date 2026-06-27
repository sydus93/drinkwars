/**
 * Local multiplayer transport for Drink Wars (development / first classroom test).
 * A tiny HTTP API that holds the service-role authority: instructors create /
 * lock / resolve games (gated by an instructor passcode) and students join by
 * code, view their own firm, and submit decisions. The privileged engine work
 * never touches the browser. Harden to a Supabase Edge Function for a deployed
 * classroom; the handlers below port over directly.
 *
 *   Run:  npm run serve            (from server/)
 *   Env:  DW_INSTRUCTOR_PASS  instructor passcode (default "letmein")
 *         PORT                default 8787
 *         DW_ADAPTER          memory | supabase   (default memory)
 *
 * Default (memory) needs no database — perfect for a local 2-browser test.
 * DW_ADAPTER=supabase persists to the real project (reads server/.env).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { loadConfig } from "drinkwars-engine/node";
import { deepMerge, projectMarkets, roleBriefings, summarizeAgreementsFor, summarizeLobbying } from "drinkwars-engine";
import type { FirmDecision } from "drinkwars-engine";
import { createClient } from "@supabase/supabase-js";
import { GameOrchestrator, InMemoryAdapter, buildInstructorDashboard, createSupabaseAdapter, dashboardToCsv, randomBreweryNames, renameFirms, type StorageAdapter } from "./index.js";

// Load server/.env (only needed for supabase mode; harmless otherwise).
try {
  const envPath = new URL("../.env", import.meta.url);
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env — fine in memory mode */
}

const PORT = Number(process.env.PORT ?? 8787);
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
// Optional secondary passcode (full access, same as the main one) to hand to a
// colleague for testing without sharing the primary credential. Unset = disabled.
const TEST_PASS = process.env.DW_INSTRUCTOR_PASS_TEST ?? "";
const PASSES = [PASS, ...(TEST_PASS ? [TEST_PASS] : [])];
const validInstructorPass = (p: unknown): boolean => typeof p === "string" && PASSES.includes(p);
// Map a passcode to its control tier. Games are owned by the tier that created
// them; the primary tier is a super-user over all games, the test tier only its own.
type InstructorTier = "primary" | "test";
const instructorTier = (p: unknown): InstructorTier | null =>
  typeof p !== "string" ? null : p === PASS ? "primary" : TEST_PASS && p === TEST_PASS ? "test" : null;
const ownsGame = (tier: InstructorTier | null, game: { owner_tag: string | null }): boolean =>
  tier === "primary" || (tier != null && game.owner_tag === tier);
const useSupabase = (process.env.DW_ADAPTER ?? "memory") === "supabase";

const store: StorageAdapter = useSupabase ? createSupabaseAdapter() : new InMemoryAdapter();
const orch = new GameOrchestrator(store, () => Date.now(), { botFillEmptySlots: true });

// In supabase mode the users→auth.users FK requires a real auth user per joiner,
// so /join admin-creates an anonymous one. (Memory mode needs no auth.)
const admin = useSupabase
  ? createClient(process.env.SUPABASE_URL ?? "", process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } })
  : null;

// token -> student session. In-memory; fine for a single-process local transport.
const sessions = new Map<string, { gameId: string; teamId: string; userId: string }>();

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function cors(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Instructor-Pass");
}
function send(res: ServerResponse, status: number, body: unknown) {
  cors(res);
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(body));
}
function sendAttachment(res: ServerResponse, status: number, contentType: string, body: string, filename: string) {
  cors(res);
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.writeHead(status);
  res.end(body);
}
async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

/** Everything a joined student needs to render: their OWN full firm state +
 *  their own last-round diagnostics + the public standings/market. A rival's
 *  private state is never included (this team's slice only). */
async function viewFor(gameId: string, teamId: string) {
  const pub = await orch.getPublicState(gameId);
  const tv = await orch.getTeamView(gameId, teamId);
  const game = await store.getGame(gameId);
  const last = (await store.getPublicRounds(gameId)).at(-1) ?? null;
  const decision = await store.getDecision(gameId, pub.round, teamId);
  const own = tv.own as any; // full FirmState for this team's firm | null
  const config: any = game?.config;
  const unitCostEst = own ? (own.unit_cost > 0 ? own.unit_cost : (config?.costs?.c_base ?? 0) * 0.85) : 0;
  // This team's own last-round diagnostics only (extracted server-side).
  let ownResult: any = null;
  const lastFull = own ? (await store.getRoundResults(gameId)).at(-1) : null;
  if (own) {
    ownResult = lastFull ? (lastFull.result.firm_results.find((f) => f.firm_id === own.id) ?? null) : null;
  }
  // Presentation names: every firm id that leaks into display text (events,
  // briefings) reads as its team's brewery name, never `firm_3`.
  const names: Record<string, string> = {};
  for (const t of await store.getTeams(gameId)) names[t.firm_id] = t.name;
  const nameOf = (id: string) => names[id] ?? id;
  // MOD-B05 briefings + MOD-B02 FX + MOD-A05/A06 alliances + MOD-A09 lobbying come
  // from the live world (this team's slice only).
  let briefings: { role: string; title: string; lines: string[] }[] = [];
  let fx: Record<string, number> = {};
  let agreements: ReturnType<typeof summarizeAgreementsFor> = [];
  let lobbyInitiatives: ReturnType<typeof summarizeLobbying> = [];
  let markets: ReturnType<typeof projectMarkets> = []; // MOD-B01 per-team city view (same projection as single-player)
  if (own) {
    const ws = await store.getLatestWorldState(gameId);
    if (ws && config?.modules?.teamRoles?.enabled) briefings = roleBriefings(ws.state, config, own.id) as never;
    if (ws) {
      fx = ws.state.fx_rates ?? {};
      agreements = summarizeAgreementsFor(ws.state, own.id, nameOf);
      if (config) lobbyInitiatives = summarizeLobbying(config, ws.state);
      if (config) markets = projectMarkets(ws.state, config, own.id, pub.round, lastFull?.result.firm_results ?? [], nameOf);
    }
  }
  return {
    briefings: briefings.map((b) => ({ ...b, lines: b.lines.map((l) => renameFirms(l, names)) })),
    fx,
    agreements,
    lobbyInitiatives,
    markets,
    names,
    round: pub.round,
    lifecycle: pub.lifecycle,
    nRounds: game?.n_rounds,
    complete: pub.lifecycle === "complete",
    segments: pub.segments,
    own, // full FirmState (this firm only)
    ownResult,
    unitCostEst,
    standings: (last?.standings ?? []).map((s: { firm_id: string }) => ({ ...s, name: names[s.firm_id] ?? s.firm_id })),
    events: (last?.events ?? []).map((e: string) => renameFirms(e, names)),
    submitted: decision?.submitted ?? false,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";
  if (method === "OPTIONS") return send(res, 204, {});
  if (method === "GET" && path === "/health") return send(res, 200, { ok: true, adapter: useSupabase ? "supabase" : "memory" });

  // ---- student ----
  if (method === "POST" && path === "/join") {
    const { code, name } = await readJson(req);
    if (!code || !name) return send(res, 400, { error: "code and name required" });
    const codeUp = String(code).toUpperCase();
    // Validate BEFORE creating an auth user, so a bad/typo code leaves no orphan.
    const game = await store.getGameByCode(codeUp);
    if (!game) return send(res, 400, { error: "no game found for that code" });
    const teams = await store.getTeams(game.id);
    if (!teams.some((t) => t.member_user_ids.length === 0)) return send(res, 400, { error: "that game is full" });
    let userId: string = randomUUID();
    if (admin) {
      const { data, error } = await admin.auth.admin.createUser({ email: `anon-${userId}@drinkwars.local`, email_confirm: true });
      if (error || !data.user) return send(res, 500, { error: `auth: ${error?.message ?? "could not create player"}` });
      userId = data.user.id;
    }
    let joined;
    try {
      joined = await orch.joinGame(codeUp, String(name).slice(0, 40), userId);
    } catch (e) {
      return send(res, 400, { error: msg(e) });
    }
    const token = randomUUID();
    sessions.set(token, { gameId: joined.gameId, teamId: joined.teamId, userId });
    return send(res, 200, { token, gameId: joined.gameId, teamId: joined.teamId, firmId: joined.firmId, nRounds: game.n_rounds, config: game.config });
  }
  if (method === "GET" && path === "/view") {
    const s = sessions.get(url.searchParams.get("token") ?? "");
    if (!s) return send(res, 401, { error: "invalid or expired token" });
    return send(res, 200, await viewFor(s.gameId, s.teamId));
  }
  if (method === "POST" && path === "/submit") {
    const { token, decision } = await readJson(req);
    const s = sessions.get(token);
    if (!s) return send(res, 401, { error: "invalid or expired token" });
    try {
      await orch.submitDecision(s.gameId, s.teamId, decision as FirmDecision);
    } catch (e) {
      return send(res, 400, { error: msg(e) });
    }
    return send(res, 200, { ok: true });
  }

  // ---- instructor (passcode-gated) ----
  if (path.startsWith("/instructor")) {
    if (!validInstructorPass(req.headers["x-instructor-pass"])) return send(res, 401, { error: "bad instructor passcode" });
    const tier = instructorTier(req.headers["x-instructor-pass"]);

    if (method === "POST" && path === "/instructor/games") {
      const { nFirms = 6, nRounds = 16, modules, inventory = false, configOverride } = await readJson(req);
      let override: Record<string, unknown> = { game: { n_firms: nFirms, n_rounds: nRounds } };
      // Expansion modules: the instructor selector sends a `modules` override block
      // ({ asymmetricStarts: { enabled: true }, … }). Legacy `inventory` boolean still honored.
      const mods: Record<string, unknown> = modules && typeof modules === "object" ? { ...modules } : {};
      if (inventory) mods.inventory = { enabled: true };
      if (Object.keys(mods).length) override.modules = mods;
      // Tuning Board: a full ConfigOverride (demand/spatial/trade/conduct/shock knobs) deep-merged
      // over the module-enable block before the config is resolved + validated.
      if (configOverride && typeof configOverride === "object") override = deepMerge(override, configOverride as Record<string, unknown>);
      const config = loadConfig(override as never);
      const code = GameOrchestrator.makeJoinCode();
      // Slots get real brewery names up front (students rename theirs on join),
      // so an unfilled bot slot never reads as "Open slot 3" mid-game.
      const teams = randomBreweryNames(nFirms).map((name) => ({ name }));
      const gameId = await orch.createGame({ config, joinCode: code, teams, ownerTag: tier });
      return send(res, 200, { gameId, joinCode: code, nFirms, nRounds });
    }

    // Re-enter a running game by its join code (instructor reconnect after a drop).
    if (method === "POST" && path === "/instructor/resume") {
      const { code } = await readJson(req);
      const g = await store.getGameByCode(String(code ?? "").toUpperCase());
      if (!g) return send(res, 404, { error: "no game found for that code" });
      if (!ownsGame(tier, g)) return send(res, 403, { error: "not your game" });
      return send(res, 200, { gameId: g.id, joinCode: g.join_code, nRounds: g.n_rounds });
    }

    // Every remaining /instructor/games/:id/* route (status/lock/resolve/advance/
    // dashboard/export) is scoped to the owning tier.
    const owned = path.match(/^\/instructor\/games\/([^/]+)\//);
    if (owned) {
      const g = await store.getGame(owned[1]);
      if (!g) return send(res, 404, { error: `no game ${owned[1]}` });
      if (!ownsGame(tier, g)) return send(res, 403, { error: "not your game" });
    }

    // Instructor analytics dashboard (read-only) + research data export.
    const ex = path.match(/^\/instructor\/games\/([^/]+)\/export$/);
    if (ex && method === "GET") {
      const gameId = ex[1];
      try {
        const dash = await buildInstructorDashboard(store, gameId);
        const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
        if (format === "json") return sendAttachment(res, 200, "application/json", JSON.stringify(dash, null, 2), `drinkwars-${gameId}.json`);
        return sendAttachment(res, 200, "text/csv", dashboardToCsv(dash), `drinkwars-${gameId}.csv`);
      } catch (e) {
        return send(res, 400, { error: msg(e) });
      }
    }

    const m = path.match(/^\/instructor\/games\/([^/]+)\/(status|lock|resolve|advance|dashboard)$/);
    if (m) {
      const [, gameId, action] = m;
      try {
        if (action === "dashboard" && method === "GET") return send(res, 200, await buildInstructorDashboard(store, gameId));
        if (action === "status" && method === "GET") {
          const status = await orch.getStatus(gameId);
          const game = await store.getGame(gameId);
          const teams = await store.getTeams(gameId);
          return send(res, 200, {
            ...status,
            joinCode: game?.join_code,
            nRounds: game?.n_rounds,
            teams: teams.map((t) => ({ teamId: t.id, firmId: t.firm_id, name: t.name, joined: t.member_user_ids.length > 0 })),
          });
        }
        if (action === "lock" && method === "POST") return send(res, 200, { nonSubmitters: await orch.lockRound(gameId) });
        if (action === "resolve" && method === "POST") {
          const r = await orch.resolveRound(gameId);
          if (r.lifecycle === "published") await orch.advanceRound(gameId); // open the next round
          return send(res, 200, r);
        }
        if (action === "advance" && method === "POST") {
          await orch.advanceRound(gameId);
          return send(res, 200, { ok: true });
        }
      } catch (e) {
        return send(res, 400, { error: msg(e) });
      }
    }
  }

  return send(res, 404, { error: "not found" });
}

createServer((req, res) => {
  handle(req, res).catch((e) => send(res, 500, { error: msg(e) }));
}).listen(PORT, () => {
  console.log(`Drink Wars transport → http://localhost:${PORT}  (adapter: ${useSupabase ? "supabase" : "memory"}, instructor pass: ${PASS === "letmein" ? '"letmein" — set DW_INSTRUCTOR_PASS' : "set"}${TEST_PASS ? " (+test pass)" : ""})`);
});
