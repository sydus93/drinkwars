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
import { GameOrchestrator, SupabaseAdapter, buildInstructorDashboard, dashboardToCsv, randomBreweryNames, renameFirms, resolveConfig, roleBriefings, summarizeAgreementsFor, summarizeLobbying, deepMerge, generateHiringMarket, projectMarkets, projectFirms, projectShocks, projectHistory } from "./drinkwars-core.js";

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

type Session = { gameId: string; teamId: string; userId: string; role?: string };
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

/** This team's own full firm + own diagnostics + the public standings/market, PLUS the
 *  per-team projections (MOD-B01 city view, research-gated rival snapshots → scouting &
 *  poaching, shocks, own/field history, MOD-B12 hiring pool). Kept at parity with
 *  server/src/transport.ts::viewFor so deployed multiplayer matches single-player + the
 *  local dev transport — these projections come from the shared engine views.ts helpers. */
async function viewFor(gameId: string, teamId: string) {
  const pub = await orch.getPublicState(gameId);
  const tv = await orch.getTeamView(gameId, teamId);
  const game = await store.getGame(gameId);
  const last = (await store.getPublicRounds(gameId)).at(-1) ?? null;
  const decision = await store.getDecision(gameId, pub.round, teamId);
  const own = tv.own as any;
  const config: any = game?.config;
  const unitCostEst = own ? (own.unit_cost > 0 ? own.unit_cost : (config?.costs?.c_base ?? 0) * 0.85) : 0;
  const allResults = own ? await store.getRoundResults(gameId) : [];
  const lastFull = allResults.at(-1) ?? null;
  const ownResult = own && lastFull ? (lastFull.result.firm_results.find((f: any) => f.firm_id === own.id) ?? null) : null;
  // Presentation names: firm ids in display text read as brewery names.
  const names: Record<string, string> = {};
  for (const t of await store.getTeams(gameId)) names[t.firm_id] = t.name;
  const nameOf = (id: string) => names[id] ?? id;
  // MOD-B05 briefings + MOD-B02 FX + MOD-A05/A06 alliances + MOD-A09 lobbying + MOD-B01 city
  // view + research-gated rival snapshots + shocks + history + MOD-B12 hiring pool.
  let briefings: { role: string; title: string; lines: string[] }[] = [];
  let fx: Record<string, number> = {};
  let agreements: any[] = [];
  let lobbyInitiatives: any[] = [];
  let markets: any[] = []; // MOD-B01 per-team city view (same projection as single-player)
  let firms: any[] = []; // public snapshots; rivals' private fields (incl. roster) redacted unless this team bought research
  let shocks: any[] = [];
  let hiringMarket: any[] = []; // MOD-B12 candidate pool (shared/public — same for every firm)
  const seats = own && game?.firm_mode === "team" ? await orch.getTeamSeats(gameId, teamId) : []; // team firms: C-suite seats + submit status
  const history = own ? projectHistory(allResults, own.id) : []; // own trend + public field aggregate
  if (own) {
    const ws = await store.getLatestWorldState(gameId);
    if (ws && config?.modules?.teamRoles?.enabled) briefings = roleBriefings(ws.state, config, own.id) as never;
    if (ws) {
      fx = ws.state.fx_rates ?? {};
      agreements = summarizeAgreementsFor(ws.state, own.id, nameOf);
      if (config) {
        lobbyInitiatives = summarizeLobbying(config, ws.state);
        markets = projectMarkets(ws.state, config, own.id, pub.round, lastFull?.result.firm_results ?? [], nameOf);
        // reveal = this team bought market research this round → unlocks rivals' rosters (poaching) + private stocks.
        firms = projectFirms(ws.state, config, own.id, lastFull?.result.firm_results ?? [], !!decision?.decision?.buy_info, nameOf);
        hiringMarket = generateHiringMarket(config, ws.state.seed, pub.round);
      }
      shocks = projectShocks(ws.state, pub.round);
    }
  }
  return {
    round: pub.round, lifecycle: pub.lifecycle, nRounds: game?.n_rounds, complete: pub.lifecycle === "complete",
    segments: pub.segments, own, ownResult, unitCostEst, fx, names, agreements, lobbyInitiatives,
    markets, firms, shocks, history, hiringMarket, seats,
    briefings: briefings.map((b) => ({ ...b, lines: b.lines.map((l: string) => renameFirms(l, names)) })),
    standings: (last?.standings ?? []).map((s: any) => ({ ...s, name: names[s.firm_id] ?? s.firm_id })),
    events: (last?.events ?? []).map((e: string) => renameFirms(e, names)),
    submitted: decision?.submitted ?? false,
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
      const { code, name, claim, teamId, role } = body;
      if (!code) return json(400, { error: "code required" });
      const codeUp = String(code).toUpperCase();
      // Validate BEFORE creating an auth user, so a bad/typo code leaves no orphan.
      const game = await store.getGameByCode(codeUp);
      if (!game) return json(400, { error: "no game found for that code" });
      // Identity: a roster-provisioned student (claim code) → their persistent user;
      // otherwise an ephemeral anonymous user. joinGame enforces fullness/seat caps.
      let userId: string;
      let displayName = String(name ?? "").slice(0, 40);
      if (claim) {
        const usr = await store.getUserByClaim(String(claim));
        if (!usr) return json(400, { error: "unknown claim code" });
        userId = usr.id;
        displayName = displayName || usr.display_name || "Player";
      } else {
        if (!displayName) return json(400, { error: "name required" });
        const created = await db.auth.admin.createUser({ email: `anon-${crypto.randomUUID()}@drinkwars.local`, email_confirm: true });
        if (created.error || !created.data.user) return json(500, { error: `auth: ${created.error?.message ?? "could not create player"}` });
        userId = created.data.user.id;
      }
      const joined = await orch.joinGame(codeUp, displayName, userId, { teamId, role });
      const token = await mintToken({ gameId: joined.gameId, teamId: joined.teamId, userId, role: joined.role });
      return json(200, { token, gameId: joined.gameId, teamId: joined.teamId, firmId: joined.firmId, nRounds: game.n_rounds, config: game.config, firmMode: game.firm_mode ?? "solo", role: joined.role ?? null });
    }
    // A player's games (return-to-game / career), resolved by their durable claim code.
    if (method === "GET" && path === "/me/games") {
      const claim = u.searchParams.get("claim") ?? "";
      const usr = claim ? await store.getUserByClaim(claim) : null;
      if (!usr) return json(401, { error: "unknown claim code" });
      return json(200, { player: { name: usr.display_name, external_id: usr.external_id }, games: await orch.getMyGames(usr.id) });
    }
    if (method === "GET" && path === "/view") {
      const s = await readToken(u.searchParams.get("token") ?? "");
      if (!s) return json(401, { error: "invalid or expired token" });
      return json(200, await viewFor(s.gameId, s.teamId));
    }
    if (method === "POST" && path === "/submit") {
      const s = await readToken(body.token);
      if (!s) return json(401, { error: "invalid or expired token" });
      const game = await store.getGame(s.gameId);
      // Team firms: a submit is this SEAT's slice, merged server-side. Solo: full decision.
      if (game?.firm_mode === "team") await orch.submitMemberDecision(s.gameId, s.teamId, s.userId, body.decision, s.role);
      else await orch.submitDecision(s.gameId, s.teamId, body.decision);
      return json(200, { ok: true });
    }

    // ---- instructor (passcode-gated) ----
    if (path.startsWith("/instructor")) {
      if (!validInstructorPass(req.headers.get("x-instructor-pass"))) return json(401, { error: "bad instructor passcode" });
      const tier = instructorTier(req.headers.get("x-instructor-pass"));
      if (method === "POST" && path === "/instructor/games") {
        const nFirms = Number(body.nFirms ?? 6);
        const nRounds = Number(body.nRounds ?? 16);
        let override: Record<string, unknown> = { game: { n_firms: nFirms, n_rounds: nRounds } };
        // Expansion modules (instructor selector) + legacy inventory boolean.
        const mods: Record<string, unknown> = body.modules && typeof body.modules === "object" ? { ...body.modules } : {};
        if (body.inventory) mods.inventory = { enabled: true };
        if (Object.keys(mods).length) override.modules = mods;
        // Tuning Board: a full ConfigOverride (demand/spatial/trade/conduct/shock knobs) deep-merged
        // over the module-enable block before the config is resolved + validated.
        if (body.configOverride && typeof body.configOverride === "object") override = deepMerge(override, body.configOverride as Record<string, unknown>);
        const config = resolveConfig(override as any);
        const code = GameOrchestrator.makeJoinCode();
        // Real brewery names up front (students rename theirs on join).
        const teams = randomBreweryNames(nFirms).map((name: string) => ({ name }));
        const gameId = await orch.createGame({ config, joinCode: code, teams, ownerTag: tier, firmMode: body.firmMode === "team" ? "team" : "solo", title: body.title ?? null });
        return json(200, { gameId, joinCode: code, nFirms, nRounds, firmMode: body.firmMode ?? "solo" });
      }

      // Roster provisioning: persistent users (NetID = career key) + durable claim codes.
      if (method === "POST" && path === "/instructor/roster") {
        const roster = body.roster;
        if (!Array.isArray(roster) || !roster.length) return json(400, { error: "roster array required" });
        const entries: { external_id: string; name: string; email?: string | null; user_id?: string }[] = [];
        for (const r of roster) {
          if (!r?.external_id || !r?.name) continue;
          const existing = await store.getUserByExternalId(String(r.external_id));
          let user_id: string;
          if (existing) user_id = existing.id;
          else {
            const email = r.email || `${String(r.external_id).toLowerCase().replace(/[^a-z0-9._-]/g, "")}@roster.drinkwars.local`;
            const created = await db.auth.admin.createUser({ email, email_confirm: true });
            if (created.error || !created.data.user) return json(500, { error: `auth: ${created.error?.message ?? "could not create roster user"}` });
            user_id = created.data.user.id;
          }
          entries.push({ external_id: String(r.external_id), name: String(r.name), email: r.email ?? null, user_id });
        }
        const students = await orch.provisionRoster(entries, { cohort: body.cohort ?? null });
        return json(200, { students });
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
