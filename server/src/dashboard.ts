/**
 * Instructor analytics dashboard — a read-only aggregator (application-spec §5,
 * §15). It assembles one structured payload from the append-only history the
 * orchestrator already persists: no new computation, no new tables. Both
 * transports (local node:http + the Supabase Edge Function) call this identically,
 * so the dashboard stays in parity; it is re-exported from `edge-core.ts` so it
 * bundles into the function.
 *
 * Privacy: this is instructor-only (passcode-gated at the transport). Free-text
 * reflections + belief predictions surface only in the per-team drill-down on the
 * client. Players are anonymous in v1; revisit consent gating with the NetID
 * identified-student upgrade.
 */
import type { FirmId, FirmStatus, GovernanceForm, SegmentId, TemplateId } from "drinkwars-engine";
import type { Lifecycle, StorageAdapter } from "./types.js";

type Scorecard = { financial: number; market: number; intangible: number; stakeholder: number };

export interface DashTeam {
  teamId: string;
  firmId: FirmId;
  name: string;
  joined: boolean; // false ⇒ open slot played by an adaptive NPC (when bot-fill is on)
}

export interface DashSegmentResult {
  price: number;
  share: number;
  q_sold: number;
  revenue: number;
}

/** One firm's resolved-round outcome, trimmed to the fields the dashboard charts.
 *  (The full FirmRoundResult lives in round_results / firm_round for export.) */
export interface DashPanelRow {
  round: number;
  firmId: FirmId;
  status: FirmStatus;
  rank: number; // within-round rank by cumulative scorecard (1 = leader)
  // Financials
  cash: number;
  revenue: number;
  netIncome: number;
  equity: number;
  debt: number;
  // Capability + stakeholder stocks
  cap: number;
  Q: number;
  B: number;
  T_emp: number;
  T_inv: number;
  T_gov: number;
  process: number;
  cumOutput: number;
  // Cost
  unitCost: number;
  // Inventory (production mode; 0 when disabled)
  inventoryUnits: number;
  inventorySpoiled: number;
  inventoryTurnover: number;
  // Module stocks (0 when the module is off)
  reputation: number;
  waterEfficiency: number;
  rndProgress: number;
  // Finance health
  coverage: number;
  leverage: number;
  creditRationed: boolean;
  rDebt: number;
  // Scoring
  scoreCumulative: number;
  scoreRaw: Scorecard;
  scoreNorm: Scorecard;
  // Strategy
  distinctiveness: { mahalanobis: number; nearest_neighbor: number } | null;
  valuation: number;
  // Market position
  totalQSold: number;
  share: number; // firm volume ÷ whole-market volume this round
  meanPrice: number; // mean price across served segments
  infoPurchased: boolean;
  segments: Record<SegmentId, DashSegmentResult>;
}

export interface DashMarketRow {
  round: number;
  segment: SegmentId;
  D: number;
  total_q: number;
  active: boolean;
}

export interface DashEventRound {
  round: number;
  events: string[];
}

export interface DashEngagementRow {
  round: number;
  firmId: FirmId;
  teamId: string;
  submitted: boolean;
  revisionCount: number;
  timeToDecideS: number | null;
  infoPurchased: boolean;
  predictedRank: number | null;
  realizedRank: number | null;
  beliefScore: number | null; // 1 = perfect rank call, 0 = worst; null if no prediction
  reflection: string; // instructor-only; surfaced in the drill-down
}

export interface DashAgreement {
  id: string;
  form: GovernanceForm;
  template: TemplateId;
  signatories: FirmId[];
  segment: SegmentId | null;
  formationRound: number;
  active: boolean;
  dissolutionRound: number | null;
  dissolutionType: string | null;
}

export interface DashMeta {
  gameId: string;
  joinCode: string | null;
  nRounds: number;
  currentRound: number;
  resolvedRounds: number;
  lifecycle: Lifecycle;
  weights: Scorecard;
  accumulation: string;
  segments: { id: SegmentId }[];
}

export interface InstructorDashboard {
  meta: DashMeta;
  teams: DashTeam[];
  panel: DashPanelRow[]; // firm × resolved-round
  market: DashMarketRow[]; // segment × resolved-round
  events: DashEventRound[]; // per resolved-round
  engagement: DashEngagementRow[]; // firm × resolved-round (rows with a decision)
  agreements: DashAgreement[];
}

/** Order firms by the trailing number in their id (firm_1, firm_2…), then by id. */
function byFirmId(a: { firm_id: FirmId }, b: { firm_id: FirmId }): number {
  const na = Number((a.firm_id.match(/\d+/) ?? [])[0]);
  const nb = Number((b.firm_id.match(/\d+/) ?? [])[0]);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.firm_id.localeCompare(b.firm_id);
}

/**
 * Assemble the instructor dashboard from persisted history. Pure read aggregation
 * over the existing StorageAdapter — safe to call any time after a game exists
 * (returns empty per-round arrays until the first round resolves).
 */
export async function buildInstructorDashboard(store: StorageAdapter, gameId: string): Promise<InstructorDashboard> {
  const game = await store.getGame(gameId);
  if (!game) throw new Error(`no game ${gameId}`);

  const teamsRaw = await store.getTeams(gameId);
  const teams: DashTeam[] = [...teamsRaw]
    .sort(byFirmId)
    .map((t) => ({ teamId: t.id, firmId: t.firm_id, name: t.name, joined: t.member_user_ids.length > 0 }));

  const results = await store.getRoundResults(gameId); // ordered by round

  const panel: DashPanelRow[] = [];
  const market: DashMarketRow[] = [];
  const events: DashEventRound[] = [];
  const engagement: DashEngagementRow[] = [];

  for (const rr of results) {
    const r = rr.round;
    const firms = rr.result.firm_results;
    const marketTotalQ = rr.result.market.reduce((a, m) => a + m.total_q, 0) || 1;

    // Within-round rank by cumulative scorecard (1 = leader).
    const ranked = [...firms].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
    const rankOf = new Map(ranked.map((f, i) => [f.firm_id, i + 1]));
    const nFirms = firms.length || 1;

    for (const fr of firms) {
      const segIds = Object.keys(fr.segments);
      const served = segIds.filter((s) => fr.segments[s].price > 0 || fr.segments[s].q_sold > 0);
      const totalQSold = segIds.reduce((a, s) => a + fr.segments[s].q_sold, 0);
      const meanPrice = served.length ? served.reduce((a, s) => a + fr.segments[s].price, 0) / served.length : 0;
      const segments: Record<SegmentId, DashSegmentResult> = {};
      for (const s of segIds) {
        const sr = fr.segments[s];
        segments[s] = { price: sr.price, share: sr.share, q_sold: sr.q_sold, revenue: sr.revenue };
      }
      panel.push({
        round: r,
        firmId: fr.firm_id,
        status: fr.status,
        rank: rankOf.get(fr.firm_id) ?? nFirms,
        cash: fr.state.cash,
        revenue: fr.pnl.revenue,
        netIncome: fr.pnl.net_income,
        equity: fr.state.equity,
        debt: fr.state.debt,
        cap: fr.state.cap,
        Q: fr.state.Q,
        B: fr.state.B,
        T_emp: fr.state.T_emp,
        T_inv: fr.state.T_inv,
        T_gov: fr.state.T_gov,
        process: fr.state.process,
        cumOutput: fr.state.cum_output,
        unitCost: fr.unit_cost,
        inventoryUnits: fr.state.inventory_units ?? 0,
        inventorySpoiled: fr.inventory?.spoiled ?? 0,
        inventoryTurnover: fr.inventory?.turnover ?? 0,
        reputation: fr.state.reputation ?? 0,
        waterEfficiency: fr.state.water_efficiency ?? 0,
        rndProgress: fr.state.rnd_progress ?? 0,
        coverage: fr.cost_of_capital.coverage,
        leverage: fr.cost_of_capital.leverage,
        creditRationed: fr.cost_of_capital.credit_rationed,
        rDebt: fr.cost_of_capital.r_debt,
        scoreCumulative: fr.scorecard_cumulative,
        scoreRaw: fr.scorecard_raw,
        scoreNorm: fr.scorecard_norm,
        distinctiveness: fr.distinctiveness,
        valuation: fr.valuation,
        totalQSold,
        share: totalQSold / marketTotalQ,
        meanPrice,
        infoPurchased: fr.info_purchased,
        segments,
      });
    }

    for (const m of rr.result.market) market.push({ round: r, segment: m.segment, D: m.D, total_q: m.total_q, active: m.active });
    events.push({ round: r, events: rr.result.events });

    // Engagement + belief accuracy (mirrors the orchestrator's research rows).
    const decisions = await store.getDecisions(gameId, r);
    for (const d of decisions) {
      const dec = d.decision;
      const predicted = dec.beliefs?.own_rank ?? null;
      const realized = rankOf.get(d.firm_id) ?? null;
      const beliefScore = predicted != null && realized != null ? Math.max(0, 1 - Math.abs(predicted - realized) / nFirms) : null;
      engagement.push({
        round: r,
        firmId: d.firm_id,
        teamId: d.team_id,
        submitted: d.submitted,
        revisionCount: d.revision_count,
        timeToDecideS: d.submitted_at != null && d.first_opened_at != null ? (d.submitted_at - d.first_opened_at) / 1000 : null,
        infoPurchased: !!dec.buy_info,
        predictedRank: predicted,
        realizedRank: realized,
        beliefScore,
        reflection: dec.reflection ?? "",
      });
    }
  }

  // Coopetition registry: latest world state carries the richest record (segment + active).
  const ws = await store.getLatestWorldState(gameId);
  const agreements: DashAgreement[] = (ws?.state.agreements ?? []).map((a) => ({
    id: a.id,
    form: a.form,
    template: a.template,
    signatories: a.signatories,
    segment: a.segment,
    formationRound: a.formation_round,
    active: a.active,
    dissolutionRound: a.dissolution_round,
    dissolutionType: a.dissolution_type,
  }));

  return {
    meta: {
      gameId,
      joinCode: game.join_code,
      nRounds: game.n_rounds,
      currentRound: game.current_round,
      resolvedRounds: results.length,
      lifecycle: game.lifecycle,
      weights: game.config.scoring.weights,
      accumulation: game.config.scoring.accumulation,
      segments: game.config.segments.map((s) => ({ id: s.id })),
    },
    teams,
    panel,
    market,
    events,
    engagement,
    agreements,
  };
}

// ---- CSV export (§15) --------------------------------------------------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "1" : "0";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Tidy long-format export — one row per firm per resolved round, joining the
 * outcome panel with engagement + beliefs/reflection. Per-segment columns are
 * emitted for every configured segment (price/share/qsold). Ready for Stata/Excel/R.
 */
export function dashboardToCsv(d: InstructorDashboard): string {
  const segIds = d.meta.segments.map((s) => s.id);
  const nameByFirm = new Map(d.teams.map((t) => [t.firmId, t.name]));
  const joinedByFirm = new Map(d.teams.map((t) => [t.firmId, t.joined]));
  const engByKey = new Map(d.engagement.map((e) => [`${e.round}::${e.firmId}`, e]));

  const baseCols = [
    "game_id", "round", "firm_id", "team_name", "joined", "status", "rank",
    "cash", "revenue", "net_income", "equity", "debt",
    "cap", "Q", "B", "T_emp", "T_inv", "T_gov", "process", "cum_output",
    "unit_cost", "inventory_units", "inventory_spoiled", "inventory_turnover", "reputation", "water_efficiency", "rnd_progress", "coverage", "leverage", "credit_rationed", "r_debt",
    "score_cumulative",
    "score_fin_raw", "score_mkt_raw", "score_int_raw", "score_stk_raw",
    "score_fin_norm", "score_mkt_norm", "score_int_norm", "score_stk_norm",
    "distinct_mahalanobis", "distinct_nearest_neighbor", "valuation",
    "total_q_sold", "share", "mean_price", "info_purchased",
  ];
  const segCols = segIds.flatMap((s) => [`price_${s}`, `share_${s}`, `qsold_${s}`]);
  const engCols = ["submitted", "revision_count", "time_to_decide_s", "predicted_rank", "realized_rank", "belief_score", "reflection"];
  const header = [...baseCols, ...segCols, ...engCols];

  const lines = [header.join(",")];
  for (const p of d.panel) {
    const eng = engByKey.get(`${p.round}::${p.firmId}`);
    const row: unknown[] = [
      d.meta.gameId, p.round, p.firmId, nameByFirm.get(p.firmId) ?? "", joinedByFirm.get(p.firmId) ?? false, p.status, p.rank,
      p.cash, p.revenue, p.netIncome, p.equity, p.debt,
      p.cap, p.Q, p.B, p.T_emp, p.T_inv, p.T_gov, p.process, p.cumOutput,
      p.unitCost, p.inventoryUnits, p.inventorySpoiled, p.inventoryTurnover, p.reputation, p.waterEfficiency, p.rndProgress, p.coverage, p.leverage, p.creditRationed, p.rDebt,
      p.scoreCumulative,
      p.scoreRaw.financial, p.scoreRaw.market, p.scoreRaw.intangible, p.scoreRaw.stakeholder,
      p.scoreNorm.financial, p.scoreNorm.market, p.scoreNorm.intangible, p.scoreNorm.stakeholder,
      p.distinctiveness?.mahalanobis ?? "", p.distinctiveness?.nearest_neighbor ?? "", p.valuation,
      p.totalQSold, p.share, p.meanPrice, p.infoPurchased,
    ];
    for (const s of segIds) {
      const sr = p.segments[s];
      row.push(sr?.price ?? "", sr?.share ?? "", sr?.q_sold ?? "");
    }
    row.push(
      eng?.submitted ?? "", eng?.revisionCount ?? "", eng?.timeToDecideS ?? "",
      eng?.predictedRank ?? "", eng?.realizedRank ?? "", eng?.beliefScore ?? "", eng?.reflection ?? "",
    );
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n");
}
