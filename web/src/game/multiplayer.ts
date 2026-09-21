/**
 * Multiplayer client — talks to the local transport (server/src/transport.ts)
 * over fetch. The student client maps the transport's view onto the same
 * `GameView` the single-player components already render, so DecisionForm /
 * Diagnostics / Standings are reused unchanged. The instructor client drives
 * the passcode-gated create / lock / resolve endpoints.
 */
import type { AllianceSummary, Config, ConfigOverride, FirmDecision, FirmId, FirmRoundResult, FirmState, LobbySummary, RoleBriefing, ScheduledShock, SegmentId } from "drinkwars-engine";
import { inventoryEnabled, DESK_LEVERS, ROLE_DESK } from "drinkwars-engine";

/** The instructor gamemaster payload (GET /instructor/games/:id/timeline). */
export interface GameTimeline {
  round: number;
  nRounds: number;
  timeline: ScheduledShock[];
  liveTriggers: string[];
  catalog: { id: string; kind: string; target: string; magnitude_mean: number; duration: number; regional: boolean }[];
  regions: string[];
}

/** Module-enable map sent to the create endpoint (id → { enabled }). */
export type ModuleSelection = Record<string, { enabled: boolean }>;

/** One seat's slice of the team plan (team firms, DW-038): who, which desk, and the
 *  levers they've put on the table this round. `me` marks this client's own seat. */
export interface TeamPlanSeat {
  name: string; role: string | null; desk: string | null; submitted: boolean; me: boolean;
  updated_at: number | null; partial: Partial<FirmDecision> | null;
}
/** The team's live plan: every seat's submitted slice + the composed firm decision
 *  they merge into (the record the engine will resolve). Refreshed by the 2.5s poll. */
export interface TeamPlan { seats: TeamPlanSeat[]; composed: FirmDecision | null; locked: boolean }
import type { InstructorDashboard } from "drinkwars-server";
import type { GameView, Standing } from "./controller.js";
import { setFirmStyles } from "../lib/teamColors.js";
import { same } from "../lib/reconcile.js";

export const TRANSPORT_URL: string =
  (import.meta as any).env?.VITE_TRANSPORT_URL ?? "http://localhost:8787";

/** Multiplayer needs a reachable game server. On the public static build it has
 *  none, so the Join/Instructor entries are hidden there. Shown in local dev
 *  (`npm run dev`), or when VITE_ENABLE_MP=1 once a transport is hosted. */
export const MP_ENABLED: boolean =
  Boolean((import.meta as any).env?.DEV) || (import.meta as any).env?.VITE_ENABLE_MP === "1";

export interface RawView {
  round: number;
  lifecycle: string;
  nRounds: number;
  complete: boolean;
  segments: { id: SegmentId; active: boolean; D: number }[];
  own: FirmState | null;
  ownResult: FirmRoundResult | null;
  unitCostEst: number;
  standings: { firm_id: FirmId; rank: number; score: number; status: string; name?: string }[];
  events: string[]; // arrive pre-renamed (server substitutes brewery names)
  submitted: boolean;
  briefings?: RoleBriefing[]; // MOD-B05
  fx?: Record<string, number>; // MOD-B02
  agreements?: AllianceSummary[]; // MOD-A05/A06
  lobbyInitiatives?: LobbySummary[]; // MOD-A09
  names?: Record<string, string>; // firm_id → brewery name
  styles?: Record<string, { color: string | null; emblem: string | null }>; // DW-051 house colour/mark per firm
  markets?: GameView["markets"]; // MOD-B01 per-team city view (projected server-side)
  seats?: GameView["seats"]; // team firms: this firm's C-suite seats + submit status
  teamPlan?: TeamPlan; // team firms: each seat's slice + the composed decision (same-firm only)
  firms?: GameView["firms"]; // public per-firm snapshots (rivals redacted unless research bought)
  shocks?: GameView["shocks"]; // active + telegraphed shocks
  history?: GameView["history"]; // own trend + public field aggregate
  hiringMarket?: GameView["hiringMarket"]; // MOD-B12 candidate pool (shared/public)
  infoActive?: boolean; // DW-051: the firm composed plan buys research this round (server truth)
  standing?: FirmDecision | null; // DW-048: the firm's standing plan (server carry-forward) — the draft seed after a reload
  draft?: FirmDecision | null; // DW-048: solo firms — this round's own submitted decision (resume exactly)
  deadlineAt?: number | null; // DW-048: instructor-announced submission deadline for this round (ms epoch)
}

async function api(base: string, path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(body?.error || `request failed (${res.status})`) as Error & { status?: number }; e.status = res.status; throw e; }
  return body;
}

const labelFor = (firmId: FirmId): string => {
  const n = firmId.replace(/[^0-9]/g, "");
  return n ? `Brewery ${n}` : firmId;
};

/** A roster student's issued credential (from instructor provisioning). */
export interface ProvisionedStudent { external_id: string; name: string; claim_code: string; user_id: string; existing: boolean }
/** A game in a player's return-to-game / career list. */
export interface MyGame { gameId: string; title: string | null; joinCode: string | null; firmId: string; teamName: string; round: number; lifecycle: string; nRounds: number; rank: number | null; score: number | null; status: string | null; complete: boolean }

/** A player's games, by their durable claim code (return-to-game + career). */
export async function fetchMyGames(claim: string, base: string = TRANSPORT_URL): Promise<{ player: { name: string | null; external_id: string | null }; games: MyGame[] }> {
  const res = await fetch(`${base}/me/games?claim=${encodeURIComponent(claim)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "unknown claim code");
  return res.json();
}

/** What the public game-peek endpoint returns — enough to shape the Join flow
 *  (firm_mode gates the C-suite seat picker) WITHOUT joining or minting a user.
 *  Team games also list the firm roster (name + seat occupancy, no identities) so a
 *  joiner can pick WHICH firm to sit down at. */
export interface GamePeek {
  firmMode: "solo" | "team"; title: string | null; nRounds: number; round: number; lifecycle: string; slotsTotal: number; slotsOpen: number;
  teams?: { teamId: string; name: string; members: number; roles: string[] }[];
  yourSeat?: { teamId: string; team: string; role: string | null }; // DW-050: pre-seated / returning claim holder
  yourName?: string | null;
}

/** Validate a join code + learn the game's shape before a student founds a team. */
export async function peekGame(code: string, claim?: string, base: string = TRANSPORT_URL): Promise<GamePeek> {
  const res = await fetch(`${base}/game?code=${encodeURIComponent(code.trim().toUpperCase())}${claim ? `&claim=${encodeURIComponent(claim.trim().toUpperCase())}` : ""}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "no game found for that code");
  return res.json();
}

export class StudentClient {
  constructor(private base: string = TRANSPORT_URL) {}
  token = "";
  gameId = "";
  firmId: FirmId = "";
  config!: Config;
  nRounds = 0;
  firmMode: "solo" | "team" = "solo"; // team ⇒ this client submits its SEAT's slice
  /** off-desk values this seat sent this round (DW-052) — re-sent on later submits while
   *  the composed plan still carries them, since the server replaces the whole partial */
  private sentCovers: Record<string, unknown> = {};
  private sentCoversRound = -1;
  role: string | null = null; // the player's C-suite seat in a team firm (null = solo controller)
  claim = ""; // this player's durable return code (roster-provided OR auto-issued on join)
  claimIssued = false; // true when the server AUTO-issued the code this join (no claim entered) → worth surfacing
  private last: RawView | null = null;
  private lastDecision: FirmDecision | null = null;

  /** Join by code. Roster students pass their `claim` code (persistent identity); team
   *  games take a `role` (C-suite seat) and optional `teamId` (which firm to join). An
   *  anonymous joiner gets a claim code auto-issued (returned as `claim`). */
  async join(code: string, name: string, opts: { claim?: string; teamId?: string; role?: string; teamName?: string; color?: string; emblem?: string } = {}): Promise<void> {
    // `name` is the PERSON; `teamName` the brewery (team games only — a founder names it,
    // a joiner inherits it). Solo games keep the one-field behaviour: name = brewery.
    const r = await api(this.base, "/join", { method: "POST", body: JSON.stringify({ code, name, claim: opts.claim, teamId: opts.teamId, role: opts.role, teamName: opts.teamName, color: opts.color, emblem: opts.emblem }) });
    this.token = r.token;
    this.gameId = r.gameId;
    this.firmId = r.firmId;
    this.config = r.config;
    this.nRounds = r.nRounds;
    this.firmMode = r.firmMode === "team" ? "team" : "solo";
    this.role = r.role ?? opts.role ?? null;
    this.claim = r.claim ?? opts.claim ?? "";
    this.claimIssued = !opts.claim && !!r.claim; // surfaced once for a casual player, not for roster students
    this.save();
  }

  /** Persist the (stateless, signed) token + config so a refresh resumes the SAME firm. */
  private save() {
    try {
      localStorage.setItem("dw_mp", JSON.stringify({ token: this.token, config: this.config, firmId: this.firmId, nRounds: this.nRounds, firmMode: this.firmMode, role: this.role, claim: this.claim, claimIssued: this.claimIssued }));
    } catch {
      /* localStorage unavailable — just no resume */
    }
  }
  clearSaved() {
    try {
      localStorage.removeItem("dw_mp");
    } catch {
      /* ignore */
    }
  }
  static restore(base: string = TRANSPORT_URL): StudentClient | null {
    try {
      const s = JSON.parse(localStorage.getItem("dw_mp") || "null");
      if (!s?.token) return null;
      const c = new StudentClient(base);
      c.token = s.token;
      c.config = s.config;
      c.firmId = s.firmId;
      c.nRounds = s.nRounds ?? 0;
      c.firmMode = s.firmMode === "team" ? "team" : "solo";
      c.role = s.role ?? null;
      c.claim = s.claim ?? "";
      c.claimIssued = !!s.claimIssued;
      return c;
    } catch {
      return null;
    }
  }

  async fetchView(): Promise<RawView> {
    this.last = await api(this.base, `/view?token=${encodeURIComponent(this.token)}`);
    return this.last!;
  }
  /** DW-050: the cheap change signal — poll this; fetch the full view only when `stamp` moves. */
  fetchPulse(): Promise<{ round: number; lifecycle: string; deadlineAt: number | null; stamp: string }> {
    return api(this.base, `/pulse?token=${encodeURIComponent(this.token)}`);
  }

  raw(): RawView | null {
    return this.last;
  }

  infoCost(): number {
    return this.config?.information?.cost ?? 0;
  }

  /** Map the transport view onto the GameView the existing components expect. */
  toGameView(v: RawView): GameView {
    setFirmStyles(v.styles); // DW-051: board colours/marks as the server knows them
    const standings: Standing[] = v.standings.map((s) => ({
      firm_id: s.firm_id,
      name: s.name ?? labelFor(s.firm_id),
      score: s.score,
      status: s.status,
      isYou: s.firm_id === this.firmId,
    }));
    return {
      round: v.round,
      nRounds: v.nRounds,
      lifecycle: v.lifecycle,
      complete: v.complete,
      difficulty: "competitive",
      segments: v.segments,
      own: v.own as FirmState,
      ownActive: v.own?.status === "active",
      unitCostEst: v.unitCostEst,
      ownResult: v.ownResult,
      result: null,
      standings,
      events: v.events,
      history: v.history ?? [],
      firms: v.firms ?? [],
      infoActive: v.infoActive ?? !!this.lastDecision?.buy_info,
      names: v.names ?? {},
      styles: v.styles ?? {},
      inventoryEnabled: this.config ? inventoryEnabled(this.config) : false,
      modules: this.config?.modules,
      scoring: this.config?.scoring,
      capacity: this.config?.capacity,
      finance: this.config?.finance,
      briefings: v.briefings ?? [],
      fx: v.fx ?? {},
      markets: v.markets ?? [], // MOD-B01 per-team city view (projected server-side)
      seats: v.seats ?? [], // team firms: C-suite seats + submit status
      teamPlan: v.teamPlan ?? null, // team firms: the live plan review surface
      agreements: v.agreements ?? [],
      lobbyInitiatives: v.lobbyInitiatives ?? [],
      shocks: v.shocks ?? [],
      hiringMarket: v.hiringMarket ?? [],
      ownTagline: "",
    };
  }

  /** Carry standing levers forward; reset one-shot transactions (mirrors single-player). */
  async defaultDecision(): Promise<FirmDecision> {
    const v = this.last ?? (await this.fetchView());
    const d = await this.seedDecision(v);
    return this.mirrorFirm(d, v);
  }
  /** DW-050: a specialist's form shows the FIRM's values on every desk that isn't theirs —
   *  the composed plan once anyone has submitted, else the standing plan the server would
   *  trade on. Their own desk is never touched. Without this a fresh round seeded zeros on
   *  the other desks and Reconcile flagged them all as "not your desk" edits. */
  mirrorFirm(d: FirmDecision, v: RawView = this.last!): FirmDecision {
    const desk = this.role ? (ROLE_DESK[this.role] ?? "all") : "all";
    const firm = (v.teamPlan?.composed ?? v.standing) as FirmDecision | null | undefined;
    if (this.firmMode !== "team" || desk === "all" || !firm) return d;
    const own = new Set<string>(DESK_LEVERS[desk] as string[]);
    const out = { ...d } as unknown as Record<string, unknown>;
    for (const k of Object.keys(firm)) if (!own.has(k) && k !== "firm_id" && k in out) out[k] = (firm as unknown as Record<string, unknown>)[k];
    return out as unknown as FirmDecision;
  }
  private async seedDecision(v: RawView): Promise<FirmDecision> {
    const own = v.own;
    const unit = v.unitCostEst || 3;
    const active = v.segments.filter((s) => s.active).map((s) => s.id);
    const allSegs = v.segments.map((s) => s.id);

    // Team firms: if THIS seat already submitted this round, resume that exact slice —
    // a reload (or another device) picks the draft back up instead of resetting it.
    // teamPlan is always the CURRENT round, so a fresh round naturally skips this.
    const mine = v.teamPlan?.seats.find((s) => s.me && s.partial);
    if (mine?.partial && !this.lastDecision) {
      // (other desks are mirrored from the firm's plan by mirrorFirm, after seeding)
      this.lastDecision = { ...(mine.partial as FirmDecision), firm_id: this.firmId };
      // A reload must not forget the covers this seat already sent (DW-052) — they're the
      // off-desk keys present in our stored slice.
      const desk = this.role ? (ROLE_DESK[this.role] ?? "all") : "all";
      if (this.firmMode === "team" && desk !== "all") {
        const own = new Set<string>(DESK_LEVERS[desk] as string[]);
        this.sentCovers = {}; this.sentCoversRound = v.round;
        for (const [k, val] of Object.entries(mine.partial as Record<string, unknown>)) if (!own.has(k) && k !== "firm_id" && val !== undefined) this.sentCovers[k] = val;
      }
      return { ...this.lastDecision };
    }
    // Solo firms: this round's own submitted decision survives a reload verbatim (DW-048).
    if (!this.lastDecision && v.draft && this.firmMode !== "team") {
      this.lastDecision = { ...v.draft, firm_id: this.firmId };
      return { ...this.lastDecision };
    }
    // Nothing in memory (fresh tab, new device, reload on a new round): seed from the firm's
    // STANDING plan — the same carry-forward the server trades on if this seat says nothing
    // — never the house defaults, which silently re-priced the firm at 1.8× cost and put it
    // back in every segment the moment an inattentive teammate hit Submit (DW-048).
    if (!this.lastDecision && v.standing) {
      const s = v.standing;
      return {
        ...s, firm_id: this.firmId,
        debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, beliefs: {}, reflection: "",
        agreement_actions: [], exit_action: null,
        pr_action: null, invest_water_efficiency: 0, public_good_contributions: {},
        invest_rnd: 0, buy_vertical: [], hire_roles: [], fire_roles: [],
        draw_convertible: 0, draw_rbf: 0, acquisition_bid: null,
        build_facilities: [], maintain_facilities: {}, mothball_facilities: [], reactivate_facilities: [], divest_facilities: [],
        hire_employees: [], hire_bids: {}, fire_employees: [], raise_employees: {}, poach_employees: [],
      } as FirmDecision;
    }

    if (this.lastDecision) {
      const price: Record<SegmentId, number> = {};
      const presence: Record<SegmentId, number> = {};
      for (const s of allSegs) {
        price[s] = this.lastDecision.price[s] ?? 0;
        presence[s] = this.lastDecision.presence[s] ?? 0;
      }
      for (const s of active) if (!price[s]) price[s] = Math.round(unit * 1.8 * 100) / 100;
      return {
        ...this.lastDecision, firm_id: this.firmId, price, presence,
        debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, beliefs: {}, reflection: "",
        // agreement_actions/exit_action MUST reset too (mirrors the solo controller) —
        // otherwise a "form alliance" or exit action re-fires every round, silently
        // re-proposing (and before mutual consent, re-FORMING) a duplicate pact.
        agreement_actions: [], exit_action: null,
        // One-shot module actions are deliberate each round (don't auto-repeat).
        pr_action: null, invest_water_efficiency: 0, public_good_contributions: {},
        invest_rnd: 0, buy_vertical: [], hire_roles: [], fire_roles: [],
        draw_convertible: 0, draw_rbf: 0, acquisition_bid: null,
        build_facilities: [], maintain_facilities: {}, mothball_facilities: [], reactivate_facilities: [], divest_facilities: [],
        hire_employees: [], hire_bids: {}, fire_employees: [], raise_employees: {}, poach_employees: [],
      };
    }

    const price: Record<SegmentId, number> = {};
    const presence: Record<SegmentId, number> = {};
    for (const s of allSegs) { price[s] = 0; presence[s] = 0; }
    for (const s of active) { price[s] = Math.round(unit * 1.8 * 100) / 100; presence[s] = 1; }
    const cap = own?.cap ?? 0;
    return {
      firm_id: this.firmId, price, presence,
      // Maintenance capex only — every strategic investment defaults to ZERO (mirrors
      // the solo controller; see the path-dependence audit, vault 09: the old standing
      // 25%-of-cash package was a hidden autopilot). Investment is a DECISION; a
      // deliberately-set value still carries forward as a standing lever.
      invest_cap: Math.round((this.config.capacity.depreciation * cap) / this.config.capacity.gain),
      invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0,
      invest_T_inv: 0, invest_T_gov: 0,
      debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
      buy_info: false, agreement_actions: [], exit_action: null, beliefs: {}, reflection: "",
    };
  }

  async submit(decision: FirmDecision, covers?: Set<string>): Promise<void> {
    this.lastDecision = { ...decision, firm_id: this.firmId };
    let slice: Partial<FirmDecision> = this.lastDecision;
    const desk = this.role ? (ROLE_DESK[this.role] ?? "all") : "all";
    if (this.firmMode === "team" && desk !== "all") {
      // DW-051: send ONLY this desk's levers plus deliberate covers — off-desk values that differ
      // from the firm's plan as of RIGHT NOW (fresh fetch, so a mirror a few seconds stale can't
      // re-assert e.g. buy_info:false over the CEO's purchase under "later word wins"). Mirrored
      // values equal to the plan are dropped: they'd read as covers on the CEO's card.
      const v = await this.fetchView();
      const plan = (v.teamPlan?.composed ?? v.standing ?? null) as unknown as Record<string, unknown> | null;
      const own = new Set<string>(DESK_LEVERS[desk] as string[]);
      const out: Record<string, unknown> = { firm_id: this.firmId };
      const src = this.lastDecision as unknown as Record<string, unknown>;
      // DW-052: the server REPLACES this seat's partial on every submit, so a cover sent
      // earlier this round (a research buy, a hire for an empty chair) must be RE-SENT or
      // it silently drops out of the composed plan when this player tweaks their own desk.
      // Remembered covers are re-sent only while the plan still equals what we sent — if
      // the plan moved (someone overruled us), we let their later word stand and forget.
      if (this.sentCoversRound !== v.round) { this.sentCovers = {}; this.sentCoversRound = v.round; }
      for (const k of Object.keys(src)) {
        if (k === "firm_id") continue;
        if (own.has(k)) { out[k] = src[k]; continue; }
        const deliberate = covers ? covers.has(k) : true; // the form says which off-desk values the player actually changed
        if (deliberate && (!plan || !(k in plan) || !same(src[k], plan[k]))) { out[k] = src[k]; this.sentCovers[k] = src[k]; continue; }
        if (k in this.sentCovers) {
          if (plan && same(plan[k], this.sentCovers[k])) out[k] = this.sentCovers[k];
          else delete this.sentCovers[k];
        }
      }
      slice = out as Partial<FirmDecision>;
    }
    await api(this.base, "/submit", { method: "POST", body: JSON.stringify({ token: this.token, decision: slice }) });
  }
}

/** One chair on a firm, as the instructor sees it (DW-048): who, which seat, submitted? */
export interface RosterMember { userId: string; name: string; externalId: string | null; claim: string | null; role: string | null; submitted: boolean; updatedAt: number | null }
/** One row of the instructor's game list (DW-049). */
export interface GameSummary { gameId: string; title: string | null; joinCode: string | null; round: number; nRounds: number; lifecycle: string; firmMode: "solo" | "team"; nFirms: number; joined: number; players: number; createdAt: number; modules: string[]; practiceRounds: number }
export interface InstructorStatus {
  lifecycle: string;
  round: number;
  joinCode: string;
  nRounds: number;
  firmMode?: "solo" | "team";
  deadlineAt?: number | null; // DW-048
  // DW-049 set-up card
  title?: string | null;
  nFirms?: number;
  modules?: string[];
  practiceRounds?: number;
  createdAt?: number;
  nonSubmitters: string[];
  teams: { teamId: string; firmId: FirmId; name: string; joined: boolean; members?: RosterMember[] }[];
}

export class InstructorClient {
  constructor(private pass: string, private base: string = TRANSPORT_URL) {}
  private headers() {
    return { "x-instructor-pass": this.pass };
  }
  async createGame(nFirms: number, nRounds: number, modules: ModuleSelection = {}, configOverride?: ConfigOverride, opts: { firmMode?: "solo" | "team"; title?: string } = {}): Promise<{ gameId: string; joinCode: string; firmMode?: string }> {
    return api(this.base, "/instructor/games", { method: "POST", headers: this.headers(), body: JSON.stringify({ nFirms, nRounds, modules, configOverride, firmMode: opts.firmMode ?? "solo", title: opts.title }) });
  }
  /** Provision a roster (NetID + name per student) → durable claim codes to distribute. */
  async provisionRoster(roster: { external_id: string; name: string; email?: string }[], cohort?: string): Promise<{ students: ProvisionedStudent[]; errors?: { external_id: string; error: string }[] }> {
    return api(this.base, "/instructor/roster", { method: "POST", headers: this.headers(), body: JSON.stringify({ roster, cohort }) });
  }
  status(gameId: string): Promise<InstructorStatus> {
    return api(this.base, `/instructor/games/${gameId}/status`, { headers: this.headers() });
  }
  /** Re-attach to a running game by its join code (reconnect after a drop). */
  resume(code: string): Promise<{ gameId: string; joinCode: string; nRounds: number }> {
    return api(this.base, "/instructor/resume", { method: "POST", headers: this.headers(), body: JSON.stringify({ code }) });
  }
  lock(gameId: string): Promise<{ nonSubmitters: string[] }> {
    return api(this.base, `/instructor/games/${gameId}/lock`, { method: "POST", headers: this.headers() });
  }
  /** Re-open a locked round (DW-048) — a mis-click, or a late team that gets the window back. */
  unlock(gameId: string): Promise<{ ok: boolean }> {
    return api(this.base, `/instructor/games/${gameId}/unlock`, { method: "POST", headers: this.headers() });
  }
  /** Drop a member from their firm (wrong-firm join, dropped student). Their slice is removed. */
  removeMember(gameId: string, teamId: string, userId: string): Promise<{ ok: boolean }> {
    return api(this.base, `/instructor/games/${gameId}/members`, { method: "POST", headers: this.headers(), body: JSON.stringify({ op: "remove", teamId, userId }) });
  }
  /** Move a member to another firm's free chair (team games). */
  moveMember(gameId: string, userId: string, toTeamId: string, role: string): Promise<{ ok: boolean }> {
    return api(this.base, `/instructor/games/${gameId}/members`, { method: "POST", headers: this.headers(), body: JSON.stringify({ op: "move", userId, toTeamId, role }) });
  }
  /** Announce (ms epoch) or clear (null) this round's submission deadline — display-only. */
  /** DW-050: pre-seat provisioned students (NetID → firm → chair). Row errors come back, not thrown. */
  applySeatPlan(gameId: string, plan: { external_id: string; team: string; role: string }[]): Promise<{ seated: { external_id: string; name: string; team: string; role: string; moved: boolean }[]; errors: { external_id: string; error: string }[] }> {
    return api(this.base, `/instructor/games/${gameId}/seats`, { method: "POST", headers: this.headers(), body: JSON.stringify({ plan }) });
  }
  /** DW-049: the instructor's own games, newest first. */
  listGames(): Promise<{ games: GameSummary[] }> {
    return api(this.base, "/instructor/games", { headers: this.headers() });
  }
  /** DW-049: end the season at the current round (irreversible). */
  endGame(gameId: string): Promise<{ ok: boolean }> {
    return api(this.base, `/instructor/games/${gameId}/end`, { method: "POST", headers: this.headers() });
  }
  /** DW-049: rename (null clears). */
  rename(gameId: string, title: string | null): Promise<{ ok: boolean }> {
    return api(this.base, `/instructor/games/${gameId}/title`, { method: "POST", headers: this.headers(), body: JSON.stringify({ title }) });
  }
  setDeadline(gameId: string, deadlineAt: number | null): Promise<{ ok: boolean }> {
    return api(this.base, `/instructor/games/${gameId}/deadline`, { method: "POST", headers: this.headers(), body: JSON.stringify({ deadlineAt }) });
  }
  /** `force` re-runs a resolve that died mid-way (game stuck in "resolving"); the server
   *  makes the re-run idempotent. */
  resolve(gameId: string, opts: { force?: boolean } = {}): Promise<{ round: number; lifecycle: string }> {
    return api(this.base, `/instructor/games/${gameId}/resolve`, { method: "POST", headers: this.headers(), body: JSON.stringify({ force: !!opts.force }) });
  }
  /** Open the next round when a resolve published but the auto-advance didn't land. */
  advance(gameId: string): Promise<{ ok: boolean }> {
    return api(this.base, `/instructor/games/${gameId}/advance`, { method: "POST", headers: this.headers() });
  }
  /** Full analytics payload for the dashboard (read-only; assembled server-side). */
  dashboard(gameId: string): Promise<InstructorDashboard> {
    return api(this.base, `/instructor/games/${gameId}/dashboard`, { headers: this.headers() });
  }
  // ---- Gamemaster (DW-037): the forward shock schedule + live triggers ----
  /** The forward schedule: engine-rolled + instructor-planted shocks, the plantable
   *  catalog, and any armed live triggers. */
  timeline(gameId: string): Promise<GameTimeline> {
    return api(this.base, `/instructor/games/${gameId}/timeline`, { headers: this.headers() });
  }
  /** Plant a disruption on a future (or the current) round. */
  scheduleShock(gameId: string, spec: { type_id: string; round: number; magnitude?: number; duration?: number; region?: string }): Promise<{ scheduled: ScheduledShock; timeline: ScheduledShock[] }> {
    return api(this.base, `/instructor/games/${gameId}/timeline`, { method: "POST", headers: this.headers(), body: JSON.stringify({ op: "schedule", spec }) });
  }
  /** Remove a not-yet-fired scheduled shock (engine-rolled or planted). */
  unscheduleShock(gameId: string, shockId: string): Promise<{ timeline: ScheduledShock[] }> {
    return api(this.base, `/instructor/games/${gameId}/timeline`, { method: "POST", headers: this.headers(), body: JSON.stringify({ op: "unschedule", shockId }) });
  }
  /** Arm (or disarm) a live trigger: the shock type fires when THIS round resolves. */
  setLiveTrigger(gameId: string, typeId: string, armed: boolean): Promise<{ liveTriggers: string[] }> {
    return api(this.base, `/instructor/games/${gameId}/timeline`, { method: "POST", headers: this.headers(), body: JSON.stringify({ op: "trigger", typeId, armed }) });
  }
  /** Research data export — the per-firm-per-round panel as a downloadable file.
   *  Uses raw fetch (not `api`) so the passcode header reaches the attachment route. */
  async exportData(gameId: string, format: "csv" | "json"): Promise<Blob> {
    const res = await fetch(`${this.base}/instructor/games/${gameId}/export?format=${format}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`export failed (${res.status})`);
    return res.blob();
  }
}
