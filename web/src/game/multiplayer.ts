/**
 * Multiplayer client — talks to the local transport (server/src/transport.ts)
 * over fetch. The student client maps the transport's view onto the same
 * `GameView` the single-player components already render, so DecisionForm /
 * Diagnostics / Standings are reused unchanged. The instructor client drives
 * the passcode-gated create / lock / resolve endpoints.
 */
import type { AllianceSummary, Config, ConfigOverride, FirmDecision, FirmId, FirmRoundResult, FirmState, LobbySummary, RoleBriefing, ScheduledShock, SegmentId } from "drinkwars-engine";
import { inventoryEnabled } from "drinkwars-engine";

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
  markets?: GameView["markets"]; // MOD-B01 per-team city view (projected server-side)
  seats?: GameView["seats"]; // team firms: this firm's C-suite seats + submit status
  teamPlan?: TeamPlan; // team firms: each seat's slice + the composed decision (same-firm only)
  firms?: GameView["firms"]; // public per-firm snapshots (rivals redacted unless research bought)
  shocks?: GameView["shocks"]; // active + telegraphed shocks
  history?: GameView["history"]; // own trend + public field aggregate
  hiringMarket?: GameView["hiringMarket"]; // MOD-B12 candidate pool (shared/public)
}

async function api(base: string, path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${base}${path}`, {
    ...opts,
    headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `request failed (${res.status})`);
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
}

/** Validate a join code + learn the game's shape before a student founds a team. */
export async function peekGame(code: string, base: string = TRANSPORT_URL): Promise<GamePeek> {
  const res = await fetch(`${base}/game?code=${encodeURIComponent(code.trim().toUpperCase())}`);
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
  role: string | null = null; // the player's C-suite seat in a team firm (null = solo controller)
  claim = ""; // this player's durable return code (roster-provided OR auto-issued on join)
  claimIssued = false; // true when the server AUTO-issued the code this join (no claim entered) → worth surfacing
  private last: RawView | null = null;
  private lastDecision: FirmDecision | null = null;

  /** Join by code. Roster students pass their `claim` code (persistent identity); team
   *  games take a `role` (C-suite seat) and optional `teamId` (which firm to join). An
   *  anonymous joiner gets a claim code auto-issued (returned as `claim`). */
  async join(code: string, name: string, opts: { claim?: string; teamId?: string; role?: string } = {}): Promise<void> {
    const r = await api(this.base, "/join", { method: "POST", body: JSON.stringify({ code, name, claim: opts.claim, teamId: opts.teamId, role: opts.role }) });
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

  raw(): RawView | null {
    return this.last;
  }

  infoCost(): number {
    return this.config?.information?.cost ?? 0;
  }

  /** Map the transport view onto the GameView the existing components expect. */
  toGameView(v: RawView): GameView {
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
      infoActive: !!this.lastDecision?.buy_info,
      names: v.names ?? {},
      inventoryEnabled: this.config ? inventoryEnabled(this.config) : false,
      modules: this.config?.modules,
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
    const own = v.own;
    const unit = v.unitCostEst || 3;
    const active = v.segments.filter((s) => s.active).map((s) => s.id);
    const allSegs = v.segments.map((s) => s.id);

    // Team firms: if THIS seat already submitted this round, resume that exact slice —
    // a reload (or another device) picks the draft back up instead of resetting it.
    // teamPlan is always the CURRENT round, so a fresh round naturally skips this.
    const mine = v.teamPlan?.seats.find((s) => s.me && s.partial);
    if (mine?.partial && !this.lastDecision) {
      this.lastDecision = { ...(mine.partial as FirmDecision), firm_id: this.firmId };
      return { ...this.lastDecision };
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

  async submit(decision: FirmDecision): Promise<void> {
    this.lastDecision = { ...decision, firm_id: this.firmId };
    await api(this.base, "/submit", { method: "POST", body: JSON.stringify({ token: this.token, decision: this.lastDecision }) });
  }
}

export interface InstructorStatus {
  lifecycle: string;
  round: number;
  joinCode: string;
  nRounds: number;
  nonSubmitters: string[];
  teams: { teamId: string; firmId: FirmId; name: string; joined: boolean }[];
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
  async provisionRoster(roster: { external_id: string; name: string; email?: string }[], cohort?: string): Promise<{ students: ProvisionedStudent[] }> {
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
  resolve(gameId: string): Promise<{ round: number; lifecycle: string }> {
    return api(this.base, `/instructor/games/${gameId}/resolve`, { method: "POST", headers: this.headers() });
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
