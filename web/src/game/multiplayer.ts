/**
 * Multiplayer client — talks to the local transport (server/src/transport.ts)
 * over fetch. The student client maps the transport's view onto the same
 * `GameView` the single-player components already render, so DecisionForm /
 * Diagnostics / Standings are reused unchanged. The instructor client drives
 * the passcode-gated create / lock / resolve endpoints.
 */
import type { AllianceSummary, Config, ConfigOverride, FirmDecision, FirmId, FirmRoundResult, FirmState, LobbySummary, RoleBriefing, SegmentId } from "drinkwars-engine";
import { inventoryEnabled } from "drinkwars-engine";

/** Module-enable map sent to the create endpoint (id → { enabled }). */
export type ModuleSelection = Record<string, { enabled: boolean }>;
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

export class StudentClient {
  constructor(private base: string = TRANSPORT_URL) {}
  token = "";
  gameId = "";
  firmId: FirmId = "";
  config!: Config;
  nRounds = 0;
  firmMode: "solo" | "team" = "solo"; // team ⇒ this client submits its SEAT's slice
  role: string | null = null; // the player's C-suite seat in a team firm (null = solo controller)
  private last: RawView | null = null;
  private lastDecision: FirmDecision | null = null;

  /** Join by code. Roster students pass their `claim` code (persistent identity); team
   *  games take a `role` (C-suite seat) and optional `teamId` (which firm to join). */
  async join(code: string, name: string, opts: { claim?: string; teamId?: string; role?: string } = {}): Promise<void> {
    const r = await api(this.base, "/join", { method: "POST", body: JSON.stringify({ code, name, claim: opts.claim, teamId: opts.teamId, role: opts.role }) });
    this.token = r.token;
    this.gameId = r.gameId;
    this.firmId = r.firmId;
    this.config = r.config;
    this.nRounds = r.nRounds;
    this.firmMode = r.firmMode === "team" ? "team" : "solo";
    this.role = r.role ?? opts.role ?? null;
    this.save();
  }

  /** Persist the (stateless, signed) token + config so a refresh resumes the SAME firm. */
  private save() {
    try {
      localStorage.setItem("dw_mp", JSON.stringify({ token: this.token, config: this.config, firmId: this.firmId, nRounds: this.nRounds, firmMode: this.firmMode, role: this.role }));
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
        // One-shot module actions are deliberate each round (don't auto-repeat).
        pr_action: null, invest_water_efficiency: 0, public_good_contributions: {},
        invest_rnd: 0, buy_vertical: [], hire_roles: [], fire_roles: [],
        draw_convertible: 0, draw_rbf: 0, acquisition_bid: null,
        build_facilities: [], maintain_facilities: {}, mothball_facilities: [], reactivate_facilities: [], divest_facilities: [],
        hire_employees: [], fire_employees: [], raise_employees: {}, poach_employees: [],
      };
    }

    const price: Record<SegmentId, number> = {};
    const presence: Record<SegmentId, number> = {};
    for (const s of allSegs) { price[s] = 0; presence[s] = 0; }
    for (const s of active) { price[s] = Math.round(unit * 1.8 * 100) / 100; presence[s] = 1; }
    const cash = own?.cash ?? 0;
    const cap = own?.cap ?? 0;
    const budget = Math.max(0, cash) * 0.25;
    return {
      firm_id: this.firmId, price, presence,
      invest_cap: Math.round((this.config.capacity.depreciation * cap) / this.config.capacity.gain),
      invest_process: Math.round(budget * 0.2), invest_Q: Math.round(budget * 0.3), invest_B: Math.round(budget * 0.3), invest_T_emp: Math.round(budget * 0.2),
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
  /** Research data export — the per-firm-per-round panel as a downloadable file.
   *  Uses raw fetch (not `api`) so the passcode header reaches the attachment route. */
  async exportData(gameId: string, format: "csv" | "json"): Promise<Blob> {
    const res = await fetch(`${this.base}/instructor/games/${gameId}/export?format=${format}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`export failed (${res.status})`);
    return res.blob();
  }
}
