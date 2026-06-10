// Drink Wars — multiplayer transport as a Supabase Edge Function (Deno).
// A port of server/src/transport.ts: instructor create/lock/resolve (passcode-
// gated) + student join/view/submit, all on the service role (auto-injected).
// Deploy with verify_jwt disabled — the function does its own gating (instructor
// passcode + join code); session tokens are HMAC-signed + stateless so they
// survive the multi-instance/ephemeral serverless runtime.
//
// Game logic comes from ./drinkwars-core.js (esbuild bundle of the orchestrator
// + Supabase adapter + engine). Rebuild it with `npm run build:edge` in server/.
import { createClient } from "@supabase/supabase-js";
import { GameOrchestrator, SupabaseAdapter, buildInstructorDashboard, dashboardToCsv, resolveConfig } from "./drinkwars-core.js";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PASS = Deno.env.get("DW_INSTRUCTOR_PASS") ?? "letmein";
// Optional secondary passcode (full access, same as the main one) for a colleague
// to test with, without sharing the primary credential. Unset = disabled.
const TEST_PASS = Deno.env.get("DW_INSTRUCTOR_PASS_TEST") ?? "";
const PASSES = [PASS, ...(TEST_PASS ? [TEST_PASS] : [])];
const validInstructorPass = (p: string | null): boolean => p !== null && PASSES.includes(p);
// Map a passcode to its control tier. Games are owned by the tier that created
// them; the primary tier is a super-user over all games, the test tier only its own.
type InstructorTier = "primary" | "test";
const instructorTier = (p: string | null): InstructorTier | null =>
  p === null ? null : p === PASS ? "primary" : TEST_PASS && p === TEST_PASS ? "test" : null;
const ownsGame = (tier: InstructorTier | null, game: { owner_tag: string | null }): boolean =>
  tier === "primary" || (tier != null && game.owner_tag === tier);

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const store = new SupabaseAdapter(db);
const orch = new GameOrchestrator(store, () => Date.now(), { botFillEmptySlots: true });

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Instructor-Pass",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const attachment = (status: number, contentType: string, body: string, filename: string) =>
  new Response(body, { status, headers: { ...CORS, "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"` } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── stateless signed session tokens (Web Crypto HMAC; secret = service key) ──
const enc = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;
const hmacKey = () =>
  (keyPromise ??= crypto.subtle.importKey("raw", enc.encode(serviceKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]));
const b64url = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

type Session = { gameId: string; teamId: string; userId: string };
async function mintToken(p: Session): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return `${body}.${b64url(sig)}`;
}
async function readToken(token: string): Promise<Session | null> {
  const [body, sig] = (token ?? "").split(".");
  if (!body || !sig) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64url(sig), enc.encode(body));
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(body)));
  } catch {
    return null;
  }
}

/** This team's own full firm + own diagnostics + the public standings/market. */
async function viewFor(gameId: string, teamId: string) {
  const pub = await orch.getPublicState(gameId);
  const tv = await orch.getTeamView(gameId, teamId);
  const game = await store.getGame(gameId);
  const last = (await store.getPublicRounds(gameId)).at(-1) ?? null;
  const decision = await store.getDecision(gameId, pub.round, teamId);
  const own = tv.own as any;
  const config: any = game?.config;
  const unitCostEst = own ? (own.unit_cost > 0 ? own.unit_cost : (config?.costs?.c_base ?? 0) * 0.85) : 0;
  let ownResult: any = null;
  if (own) {
    const lastFull = (await store.getRoundResults(gameId)).at(-1);
    ownResult = lastFull ? (lastFull.result.firm_results.find((f: any) => f.firm_id === own.id) ?? null) : null;
  }
  return {
    round: pub.round, lifecycle: pub.lifecycle, nRounds: game?.n_rounds, complete: pub.lifecycle === "complete",
    segments: pub.segments, own, ownResult, unitCostEst,
    standings: last?.standings ?? [], events: last?.events ?? [], submitted: decision?.submitted ?? false,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(req.url);
  const path = u.pathname.replace(/^.*\/drinkwars/, "") || "/"; // strip /functions/v1/drinkwars
  const method = req.method;
  const body: any = method === "POST" ? await req.json().catch(() => ({})) : {};

  try {
    if (method === "GET" && path === "/health") return json(200, { ok: true, adapter: "supabase" });

    // ---- student ----
    if (method === "POST" && path === "/join") {
      const { code, name } = body;
      if (!code || !name) return json(400, { error: "code and name required" });
      const codeUp = String(code).toUpperCase();
      // Validate BEFORE creating an auth user, so a bad/typo code leaves no orphan.
      const game = await store.getGameByCode(codeUp);
      if (!game) return json(400, { error: "no game found for that code" });
      const teams = await store.getTeams(game.id);
      if (!teams.some((t: any) => t.member_user_ids.length === 0)) return json(400, { error: "that game is full" });
      const created = await db.auth.admin.createUser({ email: `anon-${crypto.randomUUID()}@drinkwars.local`, email_confirm: true });
      if (created.error || !created.data.user) return json(500, { error: `auth: ${created.error?.message ?? "could not create player"}` });
      const userId = created.data.user.id;
      const joined = await orch.joinGame(codeUp, String(name).slice(0, 40), userId);
      const token = await mintToken({ gameId: joined.gameId, teamId: joined.teamId, userId });
      return json(200, { token, gameId: joined.gameId, teamId: joined.teamId, firmId: joined.firmId, nRounds: game.n_rounds, config: game.config });
    }
    if (method === "GET" && path === "/view") {
      const s = await readToken(u.searchParams.get("token") ?? "");
      if (!s) return json(401, { error: "invalid or expired token" });
      return json(200, await viewFor(s.gameId, s.teamId));
    }
    if (method === "POST" && path === "/submit") {
      const s = await readToken(body.token);
      if (!s) return json(401, { error: "invalid or expired token" });
      await orch.submitDecision(s.gameId, s.teamId, body.decision);
      return json(200, { ok: true });
    }

    // ---- instructor (passcode-gated) ----
    if (path.startsWith("/instructor")) {
      if (!validInstructorPass(req.headers.get("x-instructor-pass"))) return json(401, { error: "bad instructor passcode" });
      const tier = instructorTier(req.headers.get("x-instructor-pass"));
      if (method === "POST" && path === "/instructor/games") {
        const nFirms = Number(body.nFirms ?? 6);
        const nRounds = Number(body.nRounds ?? 16);
        const config = resolveConfig({ game: { n_firms: nFirms, n_rounds: nRounds } } as any);
        const code = GameOrchestrator.makeJoinCode();
        const teams = Array.from({ length: nFirms }, (_, i) => ({ name: `Open slot ${i + 1}` }));
        const gameId = await orch.createGame({ config, joinCode: code, teams, ownerTag: tier });
        return json(200, { gameId, joinCode: code, nFirms, nRounds });
      }
      // Re-enter a running game by its join code (instructor reconnect after a drop).
      if (method === "POST" && path === "/instructor/resume") {
        const game = await store.getGameByCode(String(body.code ?? "").toUpperCase());
        if (!game) return json(404, { error: "no game found for that code" });
        if (!ownsGame(tier, game)) return json(403, { error: "not your game" });
        return json(200, { gameId: game.id, joinCode: game.join_code, nRounds: game.n_rounds });
      }
      // Every remaining /instructor/games/:id/* route is scoped to the owning tier.
      const owned = path.match(/^\/instructor\/games\/([^/]+)\//);
      if (owned) {
        const g = await store.getGame(owned[1]);
        if (!g) return json(404, { error: `no game ${owned[1]}` });
        if (!ownsGame(tier, g)) return json(403, { error: "not your game" });
      }
      // Instructor analytics dashboard (read-only) + research data export.
      const ex = path.match(/^\/instructor\/games\/([^/]+)\/export$/);
      if (ex && method === "GET") {
        const gameId = ex[1];
        const dash = await buildInstructorDashboard(store, gameId);
        const format = (u.searchParams.get("format") ?? "csv").toLowerCase();
        if (format === "json") return attachment(200, "application/json", JSON.stringify(dash, null, 2), `drinkwars-${gameId}.json`);
        return attachment(200, "text/csv", dashboardToCsv(dash), `drinkwars-${gameId}.csv`);
      }
      const m = path.match(/^\/instructor\/games\/([^/]+)\/(status|lock|resolve|advance|dashboard)$/);
      if (m) {
        const [, gameId, action] = m;
        if (action === "dashboard" && method === "GET") return json(200, await buildInstructorDashboard(store, gameId));
        if (action === "status" && method === "GET") {
          const status = await orch.getStatus(gameId);
          const game = await store.getGame(gameId);
          const teams = await store.getTeams(gameId);
          return json(200, {
            ...status,
            joinCode: game?.join_code,
            nRounds: game?.n_rounds,
            teams: teams.map((t: any) => ({ teamId: t.id, firmId: t.firm_id, name: t.name, joined: t.member_user_ids.length > 0 })),
          });
        }
        if (action === "lock" && method === "POST") return json(200, { nonSubmitters: await orch.lockRound(gameId) });
        if (action === "resolve" && method === "POST") {
          const r = await orch.resolveRound(gameId);
          if (r.lifecycle === "published") await orch.advanceRound(gameId);
          return json(200, r);
        }
        if (action === "advance" && method === "POST") {
          await orch.advanceRound(gameId);
          return json(200, { ok: true });
        }
      }
    }
    return json(404, { error: "not found" });
  } catch (e) {
    return json(400, { error: errMsg(e) });
  }
});
