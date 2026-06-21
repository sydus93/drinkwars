/**
 * Single-player game controller. Runs the FULL stack in the browser — the engine,
 * the orchestration layer (GameOrchestrator on the in-memory adapter), and the
 * adaptive NPCs — with no backend. The human is firm_1; the rivals are the
 * adaptive best-response bots from the engine. This is app-spec §9 step 0.
 */
import { GameOrchestrator, InMemoryAdapter, randomBreweryNames, renameFirms } from "drinkwars-server";
import { resolveConfig, decideAdaptive, ADAPTIVE_LEANS, inventoryEnabled, roleBriefings, firmValuation, summarizeAgreementsFor, summarizeLobbying } from "drinkwars-engine";
import type { RoleBriefing, AllianceSummary, LobbySummary } from "drinkwars-engine";
import type { Config, ConfigOverride, FirmDecision, FirmId, FirmRoundResult, FirmState, Lean, ModulesConfig, RoundResult, SegmentId, WorldState } from "drinkwars-engine";

export type Difficulty = "relaxed" | "competitive" | "cutthroat";

// Rival rosters by difficulty: how many bots contest the premium (quality/brand)
// space, and how hard they push investment. More premium contenders = the human
// can't own Craft Premium uncontested.
const ROSTERS: Record<Difficulty, { leans: string[]; investScale: number }> = {
  relaxed: { leans: ["ad_generalist", "ad_quality", "ad_cost", "ad_brand", "ad_stakeholder", "ad_aggressive", "ad_lean_ops"], investScale: 0.85 },
  competitive: { leans: ["ad_quality", "ad_brand", "ad_quality", "ad_aggressive", "ad_generalist", "ad_brand", "ad_cost"], investScale: 1.0 },
  cutthroat: { leans: ["ad_quality", "ad_brand", "ad_aggressive", "ad_quality", "ad_brand", "ad_aggressive", "ad_quality"], investScale: 1.3 },
};

const leanById = new Map(ADAPTIVE_LEANS.map((l) => [l.id, l]));

export interface Standing {
  firm_id: FirmId;
  name: string;
  score: number;
  status: string;
  isYou: boolean;
}

export interface OwnTrend {
  round: number;
  cash: number;
  score: number;
  rank: number;
  share: number;
  Q: number;
  B: number;
  netIncome: number;
  equity: number;
}
export interface FieldTrend {
  round: number;
  topScore: number;
  medianScore: number;
  totalQ: number;
  activeFirms: number;
}
export interface FirmSnapshot {
  firm_id: FirmId;
  name: string;
  status: string;
  isYou: boolean;
  score: number;
  share: number;
  Q: number;
  B: number;
  cap: number;
  unitCost: number;
  T_emp: number;
  T_inv: number;
  T_gov: number;
  leverage: number;
  netIncome: number;
  priceBySeg: Record<SegmentId, number>;
  shareBySeg: Record<SegmentId, number>; // market share within each segment (0–1)
  focus: SegmentId[];
  cash: number;
  debt: number;
  valuation: number; // engine fair value (§7.5) — what an acquirer would reference
  distressRounds: number; // consecutive rounds below solvency health (M&A target gate)
  keyHires: string[]; // MOD-B03 roles currently on staff
  verticalAssets: string[]; // MOD-B06 owned assets
}

/** A shock the player is allowed to know about: either active right now, or an
 *  upcoming one that carries a forewarning (`signaled_noisy`). Unannounced shocks
 *  are NOT surfaced before they fire — seeing them coming would break the game. */
export interface ShockSignal {
  typeId: string; // "water" | "harvest" | "co2"
  kind: string; // cost_spike | capacity_hit | …
  target: SegmentId | "all";
  round: number; // absolute firing round
  roundsAway: number; // round − currentRound (≤0 ⇒ active now)
  active: boolean; // currently in effect
  signaled: boolean; // had a forewarning
}

export interface GameView {
  round: number;
  nRounds: number;
  lifecycle: string;
  complete: boolean;
  difficulty: Difficulty;
  segments: { id: SegmentId; active: boolean; D: number }[];
  own: FirmState;
  ownActive: boolean;
  unitCostEst: number;
  ownResult: FirmRoundResult | null;
  result: RoundResult | null;
  standings: Standing[];
  events: string[];
  history: { own: OwnTrend; field: FieldTrend }[];
  firms: FirmSnapshot[]; // all firms' latest snapshot (incl. you) — for benchmarks/strategy map
  infoActive: boolean; // did you buy market research for the most recent decision?
  names: Record<string, string>; // firm_id → display name (events/briefings arrive pre-renamed)
  inventoryEnabled: boolean; // production/inventory mode on for this game?
  modules?: ModulesConfig; // resolved expansion-module config (gates the module decision controls)
  briefings: RoleBriefing[]; // MOD-B05 role intel (empty when off)
  fx: Record<string, number>; // MOD-B02 export exchange rates (empty when off)
  agreements: AllianceSummary[]; // MOD-A05/A06 active pacts you're party to (empty when off)
  lobbyInitiatives: LobbySummary[]; // MOD-A09 regulation initiatives + progress (empty when off)
  shocks: ShockSignal[]; // active + foreseeable upcoming shocks, for the map/header
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export class SinglePlayerGame {
  private store = new InMemoryAdapter();
  private orch = new GameOrchestrator(this.store);
  config!: Config;
  gameId!: string;
  difficulty: Difficulty = "competitive";
  readonly humanFirmId: FirmId = "firm_1";
  private humanTeamId!: string;
  private nameByFirm = new Map<FirmId, string>();
  private npc: { teamId: string; firmId: FirmId; lean: Lean }[] = [];
  private investScale = 1;
  private lastHuman: FirmDecision | null = null;
  private lastInfoBought = false;

  async start(opts: { breweryName?: string; difficulty?: Difficulty; override?: ConfigOverride } = {}): Promise<void> {
    this.config = resolveConfig(opts.override);
    this.difficulty = opts.difficulty ?? "competitive";
    const roster = ROSTERS[this.difficulty];
    this.investScale = roster.investScale;
    const N = this.config.game.n_firms;
    const npcNames = randomBreweryNames(N - 1);
    const teams: { name: string; memberUserIds: string[] }[] = [];
    for (let i = 0; i < N; i++) {
      const uid = `u_${i + 1}`;
      await this.store.createUser({ id: uid, role: "student", email: null, consent: true, deid_code: `s${i + 1}` });
      const name = i === 0 ? opts.breweryName?.trim() || "Your Brewery" : npcNames[i - 1];
      teams.push({ name, memberUserIds: [uid] });
    }
    this.gameId = await this.orch.createGame({ config: this.config, teams });
    const teamRecords = await this.store.getTeams(this.gameId);
    for (const t of teamRecords) this.nameByFirm.set(t.firm_id, t.name);
    this.humanTeamId = teamRecords.find((t) => t.firm_id === this.humanFirmId)!.id;
    this.npc = teamRecords
      .filter((t) => t.firm_id !== this.humanFirmId)
      .map((t, idx) => ({ teamId: t.id, firmId: t.firm_id, lean: leanById.get(roster.leans[idx % roster.leans.length]) ?? ADAPTIVE_LEANS[0] }));
  }

  private async world(): Promise<WorldState> {
    return (await this.store.getLatestWorldState(this.gameId))!.state;
  }
  nameOf(firmId: FirmId): string {
    return this.nameByFirm.get(firmId) ?? firmId;
  }

  async view(): Promise<GameView> {
    const game = (await this.store.getGame(this.gameId))!;
    const world = await this.world();
    const own = world.firms.find((f) => f.id === this.humanFirmId)!;
    const results = await this.store.getRoundResults(this.gameId);
    const last = results.at(-1) ?? null;
    const ownResult = last?.result.firm_results.find((f) => f.firm_id === this.humanFirmId) ?? null;

    const standings: Standing[] = (last?.result.firm_results ?? [])
      .map((f) => ({ firm_id: f.firm_id, name: this.nameOf(f.firm_id), score: f.scorecard_cumulative, status: f.status, isYou: f.firm_id === this.humanFirmId }))
      .sort((a, b) => b.score - a.score);

    // History series across all resolved rounds.
    const history = results.map((rr) => {
      const ranked = [...rr.result.firm_results].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
      const ownFr = rr.result.firm_results.find((f) => f.firm_id === this.humanFirmId);
      const scores = rr.result.firm_results.map((f) => f.scorecard_cumulative);
      const ownTrend: OwnTrend = {
        round: rr.round,
        cash: ownFr?.balance_sheet.cash ?? 0,
        score: ownFr?.scorecard_cumulative ?? 0,
        rank: ranked.findIndex((f) => f.firm_id === this.humanFirmId) + 1,
        share: ownFr ? Object.values(ownFr.segments).reduce((a, s) => a + s.share, 0) : 0,
        Q: ownFr?.state.Q ?? 0,
        B: ownFr?.state.B ?? 0,
        netIncome: ownFr?.pnl.net_income ?? 0,
        equity: ownFr?.balance_sheet.equity ?? 0,
      };
      const fieldTrend: FieldTrend = {
        round: rr.round,
        topScore: Math.max(...scores, 0),
        medianScore: median(scores),
        totalQ: rr.result.market.reduce((a, m) => a + m.total_q, 0),
        activeFirms: rr.result.firm_results.filter((f) => f.status === "active").length,
      };
      return { own: ownTrend, field: fieldTrend };
    });

    // Latest snapshot of every firm (for benchmarks + strategy map).
    const lastByFirm = new Map((last?.result.firm_results ?? []).map((f) => [f.firm_id, f]));
    const firms: FirmSnapshot[] = world.firms.map((f) => {
      const fr = lastByFirm.get(f.id);
      const priceBySeg: Record<SegmentId, number> = {};
      const shareBySeg: Record<SegmentId, number> = {};
      const focus: SegmentId[] = [];
      if (fr) {
        for (const [seg, r] of Object.entries(fr.segments)) {
          priceBySeg[seg] = r.price;
          shareBySeg[seg] = r.share;
          if (r.share > 0.01) focus.push(seg);
        }
      }
      return {
        firm_id: f.id, name: this.nameOf(f.id), status: f.status, isYou: f.id === this.humanFirmId,
        score: fr?.scorecard_cumulative ?? 0,
        share: fr ? Object.values(fr.segments).reduce((a, s) => a + s.share, 0) : 0,
        Q: f.Q, B: f.B, cap: f.cap, unitCost: f.unit_cost,
        T_emp: f.T_emp, T_inv: f.T_inv, T_gov: f.T_gov,
        leverage: f.debt / Math.max(f.paid_in_capital + f.retained_earnings, 1e-6),
        netIncome: fr?.pnl.net_income ?? 0,
        priceBySeg, shareBySeg, focus,
        cash: f.cash, debt: f.debt,
        valuation: firmValuation(f, this.config),
        distressRounds: f.rounds_below_health ?? 0,
        keyHires: (f.key_hires ?? []).map((h) => h.role),
        verticalAssets: (f.vertical_assets ?? []).map((a) => a.id),
      };
    });

    // Display names everywhere: engine event/briefing strings carry raw firm
    // ids; substitute brewery names before anything reaches a component.
    const names = Object.fromEntries(this.nameByFirm);
    const briefings = roleBriefings(world, this.config, this.humanFirmId)
      .map((b) => ({ ...b, lines: b.lines.map((l) => renameFirms(l, names)) }));

    // Shock visibility: reveal what's currently in effect, plus upcoming shocks that
    // carry a forewarning (signaled_noisy, e.g. water). Unannounced shocks stay hidden
    // until they fire. The timeline is pre-rolled at init, so the warning is honest.
    const cur = game.current_round;
    const shocks: ShockSignal[] = [];
    for (const s of world.shock_timeline) {
      const active = s.fired && s.round <= cur && cur < s.round + s.duration;
      const upcomingSignaled = !s.fired && s.signaling === "signaled_noisy" && s.round >= cur && s.round <= cur + 3;
      if (!active && !upcomingSignaled) continue;
      shocks.push({ typeId: s.type_id, kind: s.kind, target: s.target, round: s.round, roundsAway: s.round - cur, active, signaled: s.signaling === "signaled_noisy" });
    }
    shocks.sort((a, b) => Number(b.active) - Number(a.active) || a.roundsAway - b.roundsAway);

    return {
      round: game.current_round,
      nRounds: game.n_rounds,
      lifecycle: game.lifecycle,
      complete: game.lifecycle === "complete",
      difficulty: this.difficulty,
      segments: world.segments.map((s) => ({ id: s.id, active: s.active, D: s.D })),
      own,
      ownActive: own.status === "active",
      unitCostEst: own.unit_cost > 0 ? own.unit_cost : this.config.costs.c_base * 0.85,
      ownResult,
      result: last?.result ?? null,
      standings,
      events: (last?.result.events ?? []).map((e) => renameFirms(e, names)),
      history,
      firms,
      infoActive: this.lastInfoBought,
      names,
      inventoryEnabled: inventoryEnabled(this.config),
      modules: this.config.modules,
      briefings,
      fx: world.fx_rates ?? {},
      agreements: summarizeAgreementsFor(world, this.humanFirmId, (id) => this.nameOf(id)),
      lobbyInitiatives: summarizeLobbying(this.config, world),
      shocks,
    };
  }

  infoCost(): number {
    return this.config.information.cost;
  }

  /**
   * Default decision for the current round: carry the last submitted decision
   * forward (prices, allocation, investments persist — tweak from there), reset
   * the per-round fields (research, beliefs, reflection). Round 0 starts fresh.
   */
  async defaultDecision(): Promise<FirmDecision> {
    const world = await this.world();
    const own = world.firms.find((f) => f.id === this.humanFirmId)!;
    const unit = own.unit_cost > 0 ? own.unit_cost : this.config.costs.c_base * 0.85;
    const active = world.segments.filter((s) => s.active).map((s) => s.id);
    const allSegs = world.segments.map((s) => s.id);

    if (this.lastHuman) {
      const price: Record<SegmentId, number> = {};
      const presence: Record<SegmentId, number> = {};
      for (const s of allSegs) {
        price[s] = this.lastHuman.price[s] ?? 0;
        presence[s] = this.lastHuman.presence[s] ?? 0;
      }
      // Seed a sensible price for a newly-active category (e.g. frontier emerging).
      for (const s of active) if (!price[s]) price[s] = Math.round(unit * 1.8 * 100) / 100;
      // Carry standing levers (prices, allocation, investment) forward; RESET one-shot
      // transactions (financing, research, beliefs, reflection) so they don't auto-repeat.
      // agreement_actions/exit_action MUST reset too — otherwise a "form alliance" action
      // re-fires every round, silently re-forming (and re-charging) a duplicate pact.
      return {
        ...this.lastHuman, firm_id: this.humanFirmId, price, presence,
        debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
        buy_info: false, agreement_actions: [], exit_action: null, beliefs: {}, reflection: "",
      };
    }

    const price: Record<SegmentId, number> = {};
    const presence: Record<SegmentId, number> = {};
    for (const s of allSegs) {
      price[s] = 0;
      presence[s] = 0;
    }
    for (const s of active) {
      price[s] = Math.round(unit * 1.8 * 100) / 100;
      presence[s] = 1;
    }
    const budget = Math.max(0, own.cash) * 0.25;
    return {
      firm_id: this.humanFirmId, price, presence,
      invest_cap: Math.round((this.config.capacity.depreciation * own.cap) / this.config.capacity.gain),
      invest_process: Math.round(budget * 0.2), invest_Q: Math.round(budget * 0.3), invest_B: Math.round(budget * 0.3), invest_T_emp: Math.round(budget * 0.2),
      invest_T_inv: 0, invest_T_gov: 0,
      debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0,
      buy_info: false, agreement_actions: [], exit_action: null, beliefs: {}, reflection: "",
    };
  }

  /** Adaptive NPC decision, scaled by difficulty (more aggressive investment). */
  private scaleNpc(d: FirmDecision, firm: FirmState): FirmDecision {
    if (this.investScale === 1) return d;
    const keys = ["invest_cap", "invest_process", "invest_Q", "invest_B", "invest_T_emp", "invest_T_inv", "invest_T_gov"] as const;
    const scaled: FirmDecision = { ...d };
    let total = 0;
    for (const k of keys) {
      scaled[k] = d[k] * this.investScale;
      total += scaled[k];
    }
    const cap = Math.max(0, firm.cash) * 0.7;
    if (total > cap && total > 0) {
      const s = cap / total;
      for (const k of keys) scaled[k] = scaled[k] * s;
    }
    return scaled;
  }

  /** Submit the human decision, auto-play the adaptive NPCs, resolve, advance. */
  async play(humanDecision: FirmDecision): Promise<void> {
    const game = (await this.store.getGame(this.gameId))!;
    if (game.lifecycle !== "open") return;
    const world = await this.world();
    const ownActive = world.firms.find((f) => f.id === this.humanFirmId)?.status === "active";
    if (ownActive) {
      const d = { ...humanDecision, firm_id: this.humanFirmId };
      this.lastHuman = d;
      this.lastInfoBought = !!d.buy_info;
      await this.orch.submitDecision(this.gameId, this.humanTeamId, d);
    }
    for (const n of this.npc) {
      const firm = world.firms.find((f) => f.id === n.firmId);
      if (!firm || firm.status !== "active") continue;
      await this.orch.submitDecision(this.gameId, n.teamId, this.scaleNpc(decideAdaptive(n.lean, firm, world, this.config), firm));
    }
    await this.orch.lockRound(this.gameId);
    const { lifecycle } = await this.orch.resolveRound(this.gameId);
    if (lifecycle === "published") await this.orch.advanceRound(this.gameId);
  }
}
