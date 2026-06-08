/**
 * Drink Wars — engine type definitions.
 *
 * The authoritative model is `../../01_model_engine_spec.md`. Section references
 * (§N) below point there. Engine variable names stay generic per the spec's
 * "Context — Drink Wars" note; beverage vocabulary lives only at the config-label
 * and presentation layers.
 */

export type SegmentId = string;
export type FirmId = string;
export type StockKey = "cap" | "Q" | "B" | "T_emp" | "T_inv" | "T_gov" | "process";
export type ConversionKind = "linear" | "sqrt" | "log";
export type GovernanceForm = "relational" | "formal" | "collective";
export type TemplateId = "joint_marketing" | "capacity_coordination" | "supply_share";

// ----------------------------------------------------------------------------
// Config (§14). A single object; the canonical baseline lives in config/defaults.ts.
// ----------------------------------------------------------------------------

export interface GameConfig {
  n_rounds: number;
  n_firms: number;
  seed: number;
}

/** Starting balance sheet is forced to balance: paid_in_capital is DERIVED in
 *  init as (cash + cap*book_value - debt) so Assets ≡ Liabilities + Equity at t0. */
export interface InitConfig {
  starting_cash: number;
  starting_cap: number;
  starting_debt: number;
  starting_Q: number;
  starting_B: number;
  starting_T_emp: number;
  starting_T_inv: number;
  starting_T_gov: number;
  starting_process: number;
}

export interface SegmentConfig {
  id: SegmentId;
  alpha: number; // α_s base utility
  beta_p: number; // βp price sensitivity
  beta_q: number; // βq quality sensitivity
  beta_b: number; // βb brand sensitivity
  beta_fit: number; // βfit presence/fit sensitivity
  D0: number; // base demand size (at activation)
  growth: number; // per-round multiplicative growth of D_s
  U0: number; // outside-option utility
  active_at_start: boolean;
  // Frontier emergence (§10.3): timed and/or capability-threshold triggered.
  emerge_round: number | null;
  emerge_capability_threshold: number | null;
}

export interface DemandConfig {
  unmet_demand_lost_fraction: number; // §5.2
  cross_segment_substitution: number; // §5.3 thin-segment guard
}

export interface StockParams {
  depreciation: number; // δ
  gain: number; // g
  lag: number; // rounds before invested $ converts
  conversion: ConversionKind; // concavity of $→stock
}

export interface ProcessParams extends StockParams {
  effect_max: number; // ceiling on (1 - process_effect)
  halfsat: number; // half-saturation of the process_effect curve
}

export interface CapacityParams extends StockParams {
  fixed_cost_per_unit: number; // per-unit maintenance opex on installed cap
  book_value_per_unit: number; // $ PP&E carried per capacity unit
}

export interface CostConfig {
  c_base: number;
  learning_rate: number; // Wright's-law fraction per doubling (<1 ⇒ cost falls)
  learning_q0: number; // reference cumulative output
  learning_floor: number; // floor on learning multiplier
  location_factor_mean: number;
  location_factor_sd: number;
  productivity_kappa: number; // κ in productivity(T_emp)
  productivity_halfsat: number; // h
  process: ProcessParams;
}

export interface ValuationParams {
  multiple: number;
  normalization_window: number;
  premium_weights: Record<StockKey, number>;
}

export interface FinanceConfig {
  r_f: number;
  base_spread: number;
  spread_leverage_k: number;
  leverage_ref: number;
  spread_tinv_k: number;
  tinv_ref: number; // T_inv level treated as "neutral" for spread
  coverage_threshold: number; // below this ⇒ punitive reprice + credit rationing
  coverage_penalty_spread: number;
  max_leverage: number; // debt capacity cap (debt / equity)
  equity_issue_cost_base: number;
  equity_issue_cost_tinv_k: number;
  fixed_overhead: number;
  regulatory_burden_base: number; // opex; falls with T_gov
  regulatory_burden_halfsat: number;
  dividend_max_fraction: number; // cap dividend as fraction of cash
  solvency_runway_rounds: number; // covenant: sustained breach forces exit
  valuation: ValuationParams;
}

export interface ExitConfig {
  base_recovery: number; // fraction of assets recovered on clean voluntary exit
  liquidation_decay: number; // per-round-below-health decay of recovery
  bankruptcy_recovery: number; // fraction recovered on forced exit
  reentry_cost: number;
  reentry_cost_escalation: number; // multiplier per prior re-entry
  reentry_cooldown_rounds: number;
}

export type ShockKind = "cost_spike" | "capacity_hit" | "demand_drop" | "demand_boost" | "cash_hit";

export interface ShockTypeConfig {
  id: string;
  kind: ShockKind;
  target: SegmentId | "all";
  magnitude_mean: number;
  magnitude_sd: number;
  prob_per_round: number; // chance of scheduling in each eligible round
  earliest_round: number;
  latest_round: number;
  signaling: "unannounced" | "signaled_noisy";
  resilience_mitigated: boolean;
  duration: number; // rounds the effect persists
}

export interface AntitrustConfig {
  base_prob: number;
  tgov_k: number; // T_gov scales investigation probability down
  penalty_cash: number;
  penalty_constrain_rounds: number;
}

export interface DistressDumpingConfig {
  min_share_to_trigger: number;
  price_depression: number; // additive hit to segment α next round
  duration: number;
}

export interface ShockConfig {
  types: ShockTypeConfig[];
  resilience_process_k: number;
  resilience_temp_k: number;
  resilience_halfsat: number;
  max_mitigation: number;
  endogenous: {
    antitrust: AntitrustConfig;
    distress_dumping: DistressDumpingConfig;
  };
}

export interface CoopConfig {
  forms: {
    relational: { formation_cost: number; defect_trust_cost_emp: number; defect_trust_cost_inv: number };
    formal: { formation_cost: number; breach_penalty: number };
    collective: { formation_cost: number; min_size: number; freerider_decay: number };
  };
  templates: {
    joint_marketing: { brand_pool_fraction: number };
    capacity_coordination: { capacity_restraint: number };
    supply_share: { unit_cost_reduction: number };
  };
  antitrust_coordination_threshold: number; // # coordination units that trips antitrust
}

export interface ScoringConfig {
  weights: { financial: number; market: number; intangible: number; stakeholder: number };
  accumulation: "round_average" | "auc";
  normalization: "zscore_within_round" | "percentile_within_round";
  financial_blend: { profitability: number; soundness: number; cash_resilience: number };
  cash_safety_threshold: number;
  healthy_coverage: number;
  healthy_leverage: number;
}

export interface Config {
  game: GameConfig;
  init: InitConfig;
  segments: SegmentConfig[];
  demand: DemandConfig;
  costs: CostConfig;
  capacity: CapacityParams;
  stocks: { Q: StockParams; B: StockParams; T_emp: StockParams; T_inv: StockParams; T_gov: StockParams };
  finance: FinanceConfig;
  exit: ExitConfig;
  shocks: ShockConfig;
  coopetition: CoopConfig;
  scoring: ScoringConfig;
  information: { cost: number }; // §15.7 market-research action: costed, no state effect
}

/** A deep-partial of Config for overrides / treatment conditions. */
export type ConfigOverride = DeepPartial<Config>;
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

// ----------------------------------------------------------------------------
// State (§3)
// ----------------------------------------------------------------------------

export type FirmStatus = "active" | "bankrupt" | "exited_banked" | "exited_invested" | "exited_rebuilt";

export interface Holding {
  firm_id: FirmId;
  stake_fraction: number;
  basis: number; // amount paid (cost basis)
}

export interface CapTableEntry {
  holder_id: string; // forward-compat for v3 within-team equity; single holder in v1
  shares: number;
}

export interface FirmState {
  id: FirmId;
  status: FirmStatus;
  // Five fundamentals (§3.1)
  cash: number;
  cap: number; // capacity units (a stock)
  unit_cost: number; // last computed (diagnostic)
  Q: number;
  B: number;
  // Stakeholder sub-stocks (§3.2)
  T_emp: number;
  T_inv: number;
  T_gov: number;
  // Operations/process capability (path-dependent; cost engine + resilience)
  process: number;
  // Lagged-investment pipelines (one per investable stock); index 0 matures next.
  pipelines: Record<StockKey, number[]>;
  // Finance / balance sheet
  debt: number;
  paid_in_capital: number;
  retained_earnings: number;
  ppe_book: number; // net PP&E book value ($)
  // Experience
  cum_output: number;
  // Fixed firm attributes
  location_factor: number;
  primary_segment: SegmentId | null; // for reposition-required check on re-entry
  // History
  ni_history: number[]; // net income per round (for valuation normalization)
  // Running scorecard accumulators (§12.1)
  score_accum: { financial: number; market: number; intangible: number; stakeholder: number; rounds: number };
  // Health / solvency tracking
  rounds_below_health: number;
  // Exit / re-entry
  reentry_count: number;
  cooldown_until_round: number | null;
  // Investor path
  holdings: Holding[];
  cap_table: CapTableEntry[];
  banked_cash: number; // earns r_f when on the banked path
  // Terminal-wealth metric anchor (§8.4)
  initial_capital: number;
}

export interface AgreementState {
  id: string;
  form: GovernanceForm;
  template: TemplateId;
  signatories: FirmId[];
  segment: SegmentId | null; // for joint_marketing
  formation_round: number;
  active: boolean;
  dissolution_round: number | null;
  dissolution_type: "defection" | "mutual" | "antitrust" | null;
  constrained_until_round: number | null; // antitrust constraint
}

export interface ScheduledShock {
  id: string;
  type_id: string;
  kind: ShockKind;
  target: SegmentId | "all";
  round: number;
  magnitude: number;
  signaling: "unannounced" | "signaled_noisy";
  resilience_mitigated: boolean;
  duration: number;
  locked: boolean; // instructor lock (engine never auto-edits a locked shock)
  fired: boolean;
}

export interface SegmentWorld {
  id: SegmentId;
  D: number; // current demand size
  active: boolean;
}

export interface SegmentPriceMod {
  segment: SegmentId;
  alpha_delta: number; // additive change to α_s while active (distress dumping)
  until_round: number;
}

export interface WorldState {
  round: number; // current round index (0-based; round being resolved)
  n_rounds: number;
  segments: SegmentWorld[];
  firms: FirmState[];
  agreements: AgreementState[];
  shock_timeline: ScheduledShock[];
  pending_segment_mods: SegmentPriceMod[];
  live_triggers: string[]; // shock type_ids the instructor fires this round
  seed: number;
}

// ----------------------------------------------------------------------------
// Decisions (§4)
// ----------------------------------------------------------------------------

export interface AgreementAction {
  type: "form" | "defect";
  // form:
  form?: GovernanceForm;
  template?: TemplateId;
  counterparties?: FirmId[];
  segment?: SegmentId;
  // defect:
  agreement_id?: string;
}

export type ExitAction =
  | { type: "voluntary"; path: "bank" | "invest" | "rebuild"; target_firm?: FirmId; reposition_segment?: SegmentId }
  | null;

export interface FirmDecision {
  firm_id: FirmId;
  price: Record<SegmentId, number>;
  presence: Record<SegmentId, number>; // capacity-allocation weight per segment, clamped ≥0
  invest_cap: number;
  invest_process: number;
  invest_Q: number;
  invest_B: number;
  invest_T_emp: number;
  invest_T_inv: number;
  invest_T_gov: number;
  // Financing (§7.3)
  debt_draw: number;
  debt_repay: number;
  equity_raise: number;
  dividend: number;
  // Information purchase (§15) — no state effect; logged
  buy_info: boolean;
  // Coopetition (§11)
  agreement_actions: AgreementAction[];
  // Exit (§8)
  exit_action: ExitAction;
  // App-layer passthrough data instruments (§15.2, §15.5)
  beliefs?: { own_rank?: number; market_size?: number; rival_move?: string };
  reflection?: string;
}

// ----------------------------------------------------------------------------
// Results (§15.1)
// ----------------------------------------------------------------------------

export interface SegmentResult {
  price: number;
  share: number;
  q_desired: number;
  q_sold: number;
  revenue: number;
  utility: number;
  attraction: { alpha: number; price: number; quality: number; brand: number; fit: number; agreement: number };
}

export interface PnL {
  revenue: number;
  cogs: number;
  gross: number;
  opex: number;
  depreciation: number;
  ebit: number;
  interest: number;
  net_income: number;
}

export interface BalanceSheet {
  cash: number;
  ppe: number;
  assets: number;
  debt: number;
  paid_in: number;
  retained: number;
  equity: number;
}

export interface CashFlow {
  operating: number;
  investing: number;
  financing: number;
  delta_cash: number;
}

export interface CostBuildup {
  c_base: number;
  learning: number;
  process: number;
  location: number;
  productivity: number;
  supply_share: number;
  shock: number;
}

export interface FirmRoundResult {
  firm_id: FirmId;
  round: number;
  status: FirmStatus;
  segments: Record<SegmentId, SegmentResult>;
  unit_cost: number;
  cost_buildup: CostBuildup;
  pnl: PnL;
  balance_sheet: BalanceSheet;
  cash_flow: CashFlow;
  cost_of_capital: { r_debt: number; coverage: number; leverage: number; credit_rationed: boolean };
  state: {
    cash: number; cap: number; Q: number; B: number; T_emp: number; T_inv: number; T_gov: number;
    process: number; cum_output: number; debt: number; equity: number;
  };
  scorecard_raw: { financial: number; market: number; intangible: number; stakeholder: number };
  scorecard_norm: { financial: number; market: number; intangible: number; stakeholder: number };
  scorecard_cumulative: number;
  distinctiveness: { mahalanobis: number; nearest_neighbor: number } | null;
  valuation: number;
  info_purchased: boolean;
  events: string[];
}

export interface RoundResult {
  round: number;
  firm_results: FirmRoundResult[];
  events: string[];
  market: { segment: SegmentId; D: number; total_q: number; active: boolean }[];
}

/** Per-round transient effects computed in the resolution pipeline and threaded
 *  through the §13 steps (kept out of WorldState because they don't persist). */
export interface ShockEffect {
  firm_id: FirmId;
  cost_multiplier: number; // ×unit_cost
  capacity_multiplier: number; // ×effective cap
  cash_hit: number; // direct $ damage (applied step 9)
}
