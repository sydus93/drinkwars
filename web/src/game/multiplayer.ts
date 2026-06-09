/**
 * Multiplayer client — talks to the local transport (server/src/transport.ts)
 * over fetch. The student client maps the transport's view onto the same
 * `GameView` the single-player components already render, so DecisionForm /
 * Diagnostics / Standings are reused unchanged. The instructor client drives
 * the passcode-gated create / lock / resolve endpoints.
 */
import type { Config, FirmDecision, FirmId, FirmRoundResult, FirmState, SegmentId } from "drinkwars-engine";
import type { GameView, Standing } from "./controller.js";

export const TRANSPORT_URL: string =
  (import.meta as any).env?.VITE_TRANSPORT_URL ?? "http://localhost:8787";

export interface RawView {
  round: number;
  lifecycle: string;
  nRounds: number;
  complete: boolean;
  segments: { id: SegmentId; active: boolean; D: number }[];
  own: FirmState | null;
  ownResult: FirmRoundResult | null;
  unitCostEst: number;
  standings: { firm_id: FirmId; rank: number; score: number; status: string }[];
  events: string[];
  submitted: boolean;
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
      name: s.firm_id === this.firmId ? "You" : labelFor(s.firm_id),
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
  async createGame(nFirms: number, nRounds: number): Promise<{ gameId: string; joinCode: string }> {
    return api(this.base, "/instructor/games", { method: "POST", headers: this.headers(), body: JSON.stringify({ nFirms, nRounds }) });
  }
  status(gameId: string): Promise<InstructorStatus> {
    return api(this.base, `/instructor/games/${gameId}/status`, { headers: this.headers() });
  }
  lock(gameId: string): Promise<{ nonSubmitters: string[] }> {
    return api(this.base, `/instructor/games/${gameId}/lock`, { method: "POST", headers: this.headers() });
  }
  resolve(gameId: string): Promise<{ round: number; lifecycle: string }> {
    return api(this.base, `/instructor/games/${gameId}/resolve`, { method: "POST", headers: this.headers() });
  }
}
