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
import type { FirmDecision } from "drinkwars-engine";
import { GameOrchestrator, InMemoryAdapter, createSupabaseAdapter, type StorageAdapter } from "./index.js";

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
const useSupabase = (process.env.DW_ADAPTER ?? "memory") === "supabase";

const store: StorageAdapter = useSupabase ? createSupabaseAdapter() : new InMemoryAdapter();
const orch = new GameOrchestrator(store, () => Date.now(), { botFillEmptySlots: true });

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
  if (own) {
    const lastFull = (await store.getRoundResults(gameId)).at(-1);
    ownResult = lastFull ? (lastFull.result.firm_results.find((f) => f.firm_id === own.id) ?? null) : null;
  }
  return {
    round: pub.round,
    lifecycle: pub.lifecycle,
    nRounds: game?.n_rounds,
    complete: pub.lifecycle === "complete",
    segments: pub.segments,
    own, // full FirmState (this firm only)
    ownResult,
    unitCostEst,
    standings: last?.standings ?? [],
    events: last?.events ?? [],
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
    const userId = randomUUID();
    let joined;
    try {
      joined = await orch.joinGame(String(code).toUpperCase(), String(name).slice(0, 40), userId);
    } catch (e) {
      return send(res, 400, { error: msg(e) });
    }
    const token = randomUUID();
    sessions.set(token, { gameId: joined.gameId, teamId: joined.teamId, userId });
    const game = await store.getGame(joined.gameId);
    return send(res, 200, { token, gameId: joined.gameId, teamId: joined.teamId, firmId: joined.firmId, nRounds: game?.n_rounds, config: game?.config });
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
    if (req.headers["x-instructor-pass"] !== PASS) return send(res, 401, { error: "bad instructor passcode" });

    if (method === "POST" && path === "/instructor/games") {
      const { nFirms = 6, nRounds = 16 } = await readJson(req);
      const config = loadConfig({ game: { n_firms: nFirms, n_rounds: nRounds } } as never);
      const code = GameOrchestrator.makeJoinCode();
      const teams = Array.from({ length: nFirms }, (_, i) => ({ name: `Open slot ${i + 1}` }));
      const gameId = await orch.createGame({ config, joinCode: code, teams });
      return send(res, 200, { gameId, joinCode: code, nFirms, nRounds });
    }

    const m = path.match(/^\/instructor\/games\/([^/]+)\/(status|lock|resolve|advance)$/);
    if (m) {
      const [, gameId, action] = m;
      try {
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
  console.log(`Drink Wars transport → http://localhost:${PORT}  (adapter: ${useSupabase ? "supabase" : "memory"}, instructor pass: ${PASS === "letmein" ? '"letmein" — set DW_INSTRUCTOR_PASS' : "set"})`);
});
