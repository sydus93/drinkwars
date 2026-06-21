/**
 * Multiplayer client — talks to the local transport (server/src/transport.ts)
 * over fetch. The student client maps the transport's view onto the same
 * `GameView` the single-player components already render, so DecisionForm /
 * Diagnostics / Standings are reused unchanged. The instructor client drives
 * the passcode-gated create / lock / resolve endpoints.
 */
import type { AllianceSummary, Config, FirmDecision, FirmId, FirmRoundResult, FirmState, LobbySummary, RoleBriefing, SegmentId } from "drinkwars-engine";
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

export class StudentClient {
  constructor(private base: string = TRANSPORT_URL) {}
  token = "";
  gameId = "";
  firmId: FirmId = "";
  config!: Config;
  nRounds = 0;
  private last: RawView | null = null;
  private lastDecision: FirmDecision | null = null;

  async join(code: string, name: string): Promise<void> {
    const r = await api(this.base, "/join", { method: "POST", body: JSON.stringify({ code, name }) });
    this.token = r.token;
    this.gameId = r.gameId;
    this.firmId = r.firmId;
    this.config = r.config;
    this.nRounds = r.nRounds;
    this.save();
  }

  /** Persist the (stateless, signed) token + config so a refresh resumes the SAME firm. */
  private save() {
    try {
      localStorage.setItem("dw_mp", JSON.stringify({ token: this.token, config: this.config, firmId: this.firmId, nRounds: this.nRounds }));
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
      history: [],
      firms: [],
      infoActive: !!this.lastDecision?.buy_info,
      names: v.names ?? {},
      inventoryEnabled: this.config ? inventoryEnabled(this.config) : false,
      modules: this.config?.modules,
      briefings: v.briefings ?? [],
      fx: v.fx ?? {},
      agreements: v.agreements ?? [],
      lobbyInitiatives: v.lobbyInitiatives ?? [],
      shocks: (v as { shocks?: GameView["shocks"] }).shocks ?? [], // transport doesn't project shocks yet → none
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
  async createGame(nFirms: number, nRounds: number, modules: ModuleSelection = {}): Promise<{ gameId: string; joinCode: string }> {
    return api(this.base, "/instructor/games", { method: "POST", headers: this.headers(), body: JSON.stringify({ nFirms, nRounds, modules }) });
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
