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
  /** Premium recipes cost more to brew: unit cost ×(1 + κ·Q/(Q+h)). The
   *  counterweight to quality's demand pull — without it, raising Q lifts appeal
   *  with no production penalty and quality dominates. Omit ⇒ no premium (legacy). */
  quality_premium?: { kappa: number; halfsat: number };
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

/** Demand-side: carried finished-goods inventory + spoilage. Config-gated — when
 *  `c.inventory` is absent (e.g. games created before this feature) the engine runs
 *  the legacy WC=0 path (produce-to-sell, nothing carried). See invCfg() in
 *  engine/inventory.ts. */
export interface InventoryConfig {
  enabled: boolean;
  spoilage_rate: number; // fraction of carried units lost each round (perishability)
  max_run_rate: number; // cap on the production run-rate; 1 = no surge above capacity
  holding_cost_per_unit: number; // opex per carried unit (storage); 0 = off
}

// ----------------------------------------------------------------------------
// Expansion modules (04_expansion_module_spec). Every module lives behind an
// `enabled` flag in `Config.modules`; an engine with all flags off produces
// output identical to the v1 base game (the Step-0 acceptance invariant). The
// canonical registry, defaults, presets, and accessors are in config/modules.ts.
// ----------------------------------------------------------------------------

/** Stable module identifiers (config keys under `Config.modules`). Tier C
 *  ("phase 3") is intentionally absent — those are not yet scaffolded. */
export type ModuleId =
  // Tier A — low lift
  | "publicGoods" | "sustainability" | "prEvents" | "contingentContracts"
  | "renegotiation" | "asymmetricStarts" | "consumerDrift" | "lobbying"
  // Tier B — medium lift
  | "geography" | "international" | "laborMarket" | "rndRace" | "teamRoles"
  | "verticalIntegration" | "ma" | "financialInstruments" | "inventory" | "reputation";

/** Minimal module config: a plain on/off flag. Modules whose engine logic isn't
 *  wired yet use this shape; they appear in the instructor selector as "planned"
 *  and resolve as a no-op until implemented. */
export interface ModuleToggle {
  enabled: boolean;
}

/** One purchasable vertical asset (MOD-B06). Upstream cuts unit cost; downstream
 *  relieves regulatory burden but adds antitrust exposure. Purchases are
 *  capitalized into PP&E (cash → asset swap), so the §7.2 invariants hold. */
export interface VerticalAssetConfig {
  id: string;
  label: string;
  type: "upstream" | "downstream";
  cost: number; // purchase price (capitalized into PP&E)
  unit_cost_reduction: number; // upstream: fraction off unit cost once integrated
  reg_relief: number; // downstream: fraction off the regulatory-burden opex
  integration_lag: number; // rounds before the benefit comes online
  antitrust_units: number; // downstream: adds to visible-coordination antitrust exposure
}

/** MOD-B06 · Vertical integration. */
export interface VerticalConfig {
  enabled: boolean;
  max_assets: number; // per firm
  assets: VerticalAssetConfig[];
}

/** One hirable key employee role (MOD-B03). The bonus lands on hire and is lost
 *  if the person leaves (departure risk falls with employee trust). */
export interface KeyRoleConfig {
  id: string;
  label: string;
  bonus: Partial<Record<"Q" | "B" | "process" | "T_emp", number>>;
  salary: number; // per-round opex while employed
  signing_bonus: number; // one-time opex on hire
}

/** MOD-B03 · Labor market & human capital. */
export interface LaborConfig {
  enabled: boolean;
  roles: KeyRoleConfig[];
  departure_prob: number; // per-hire per-round chance of leaving
  t_emp_mitigation: number; // max fraction of that risk employee trust removes
  t_emp_halfsat: number;
}

/** MOD-B08 · Financial instruments (convertible note + revenue-based financing).
 *  Trade credit is spec'd but deferred (inventory's invariants hold without it). */
export interface FinInstrumentsConfig {
  enabled: boolean;
  convertible: { rate: number; term: number; max_equity_fraction: number };
  rbf: { payment_rate: number; multiple: number; max_revenue_fraction: number };
}

/** MOD-B07 · M&A. Distressed rivals can be acquired instead of bleeding out. */
export interface MaConfig {
  enabled: boolean;
  integration_discount: number; // fraction of target stocks/capacity the acquirer keeps
  min_price_fraction: number; // bid floor as a fraction of target valuation
  min_distress_rounds: number; // target must be this many rounds below solvency health
  max_acquisitions: number; // per-acquirer cap (keeps conquest from snowballing)
}

/** MOD-B05 · Within-team roles: role-tagged private intel briefings each round. */
export interface TeamRolesConfig {
  enabled: boolean;
  noise: { cfo: number; cmo: number; coo: number; ceo: number }; // briefing noise SDs
}

/** MOD-B10 · Reputation. A credibility stock (distinct from brand) that grows by
 *  honoring agreements and decays on defection; it lowers the cost of capital. */
export interface ReputationConfig {
  enabled: boolean;
  gain_honor: number; // R gained per round as a signatory that didn't defect
  loss_defect: number; // R lost on a defection
  depreciation: number; // per-round decay
  halfsat: number; // half-saturation of the spread-reduction curve
  spread_reduction_max: number; // max reduction to the debt spread at full reputation
}

/** MOD-B04 · R&D & innovation races. Investment toward the frontier category
 *  accumulates; the leader crossing a threshold pulls emergence forward and earns a
 *  temporary first-mover brand head start in that category. */
export interface RndRaceConfig {
  enabled: boolean;
  gain: number; // sqrt-conversion of R&D spend into progress
  threshold: number; // leading progress that triggers early emergence
  first_mover_brand_bonus: number; // brand-equivalent head start in the new category
  first_mover_duration: number; // rounds the head start lasts
}

export type MarketKind = "home" | "domestic" | "export";

/** One market/region (MOD-B01 geography, MOD-B02 international). Coefficient
 *  multipliers reshape local tastes; `brand_transfer` is how much of your brand
 *  carries there. Export markets add a tariff and FX exposure. */
export interface MarketConfig {
  id: string;
  label: string;
  kind: MarketKind;
  demand_mult: number; // ×base segment demand size (market scale)
  beta_p_mult: number; // local price sensitivity
  beta_q_mult: number; // local quality sensitivity
  beta_b_mult: number; // local brand sensitivity
  brand_transfer: number; // fraction of brand that carries here (home = 1)
  entry_cost: number; // one-time cost to begin operating here (home = 0)
  distribution_cost_per_unit: number; // per-unit opex selling here
  tariff_rate: number; // export only: import tariff as a fraction of revenue
  fx_volatility: number; // export only: per-round FX move size
}

/** MOD-B01 · Geographic expansion. The home market is always active; domestic
 *  regions open up entry/allocation decisions. Export markets activate only when
 *  MOD-B02 international is also on. */
export interface GeographyConfig {
  enabled: boolean;
  markets: MarketConfig[]; // includes the always-on home market
}

/** MOD-B02 · International markets. Gates the export-kind markets and drives the
 *  mean-reverting FX process. Requires geography. */
export interface InternationalConfig {
  enabled: boolean;
  fx_mean: number; // long-run FX level (home$ per unit local revenue)
  fx_speed: number; // mean-reversion speed per round
}

export type PublicGoodBenefit = "demand" | "water_resilience" | "quality";

/** One industry public good (MOD-A02). Contributions accumulate into a decaying
 *  pool; once the pool clears `threshold`, the shared benefit scales with it. */
export interface PublicGoodConfig {
  id: string;
  benefit: PublicGoodBenefit; // demand boost · water-shock resilience · quality (βq) lift
  segments?: SegmentId[]; // target segments for demand/quality (default: all active)
  threshold: number; // pool size before the benefit activates (0 = continuous)
  max_effect: number; // ceiling on the benefit magnitude
  halfsat: number; // pool size at which the benefit reaches half of max_effect
}

/** MOD-A02 · Industry public goods / collective action. */
export interface PublicGoodsConfig {
  enabled: boolean;
  decay: number; // per-round decay on every good's accumulated pool
  goods: PublicGoodConfig[];
}

/** MOD-A03 · Sustainability. A water-efficiency capability stock that blunts the
 *  water shock and earns a little regulator goodwill. Engine touches a stock-update
 *  step + the water-shock resilience term. */
export interface SustainabilityConfig {
  enabled: boolean;
  gain: number; // sqrt-conversion gain on water-efficiency investment
  depreciation: number; // per-round decay of the efficiency stock
  resilience_k: number; // max extra mitigation on water shocks
  resilience_halfsat: number; // half-saturation of that mitigation curve
  t_gov_gain_per_invest: number; // T_gov bump per round of positive investment
}

export type PrPlayType = "festival" | "collab" | "viral";

/** MOD-A04 · PR events. A tactical brand play (cooldown-gated) spikes brand with a
 *  fast-decaying transient boost; negative PR can fire as a variant shock, blunted
 *  by employee trust. Engine touches a pre-demand PR step + the brand utility term. */
export interface PrEventsConfig {
  enabled: boolean;
  cooldown_rounds: number; // rounds between plays for one firm
  spike_magnitude: number; // brand-equivalent boost from a play (before the type bonus)
  spike_decay_rate: number; // per-round decay of the transient spike (faster than B depreciation)
  cost: number; // cash cost of a play
  type_bonus: Record<PrPlayType, number>; // multiplier on the spike by play type
  negative_pr_enabled: boolean;
  negative_pr_probability: number; // per-firm per-round chance of a controversy
  negative_pr_t_emp_mitigation: number; // fraction of the brand damage T_emp can blunt
  negative_pr_brand_damage: number; // brand-equivalent hit on a controversy
}

/** One drift track for MOD-A08: a segment coefficient that moves a fixed amount
 *  each round, bounded by an optional floor/ceiling (absolute, not relative). */
export interface DriftTrack {
  segment: SegmentId;
  variable: "beta_q" | "beta_p" | "beta_b";
  delta_per_round: number; // signed change applied per round elapsed
  floor?: number; // lower bound on the resulting coefficient
  ceiling?: number; // upper bound on the resulting coefficient
}

/** MOD-A08 · Consumer drift. Segment tastes evolve deterministically over the
 *  season; read the drift early and reposition. Engine touches demand only. */
export interface ConsumerDriftConfig {
  enabled: boolean;
  tracks: DriftTrack[];
}

/** Per-role starting-state multipliers for MOD-A07 (asymmetric starts). */
export interface StartProfile {
  cap: number; // ×starting capacity
  B: number; // ×starting brand
  Q: number; // ×starting quality
  cash: number; // ×starting cash
  unit_cost: number; // ×location_factor (directly scales unit cost; <1 = cheaper)
}

/** MOD-A07 · Asymmetric starts. Incumbents (first `incumbent_count` firms) and
 *  entrants start from scaled state vectors. Engine touches init only. */
export interface AsymmetricStartsConfig {
  enabled: boolean;
  incumbent_count: number; // first N firms are incumbents; the rest are entrants
  incumbent: StartProfile;
  entrant: StartProfile;
}

/** The module registry as it appears in a resolved Config. All keys are always
 *  present after `resolveConfig` (defaults fill them); a persisted pre-modules
 *  game has `modules` absent entirely, which every accessor treats as all-off. */
export interface ModulesConfig {
  // Tier A
  publicGoods: PublicGoodsConfig;
  sustainability: SustainabilityConfig;
  prEvents: PrEventsConfig;
  contingentContracts: ModuleToggle;
  renegotiation: ModuleToggle;
  asymmetricStarts: AsymmetricStartsConfig;
  consumerDrift: ConsumerDriftConfig;
  lobbying: ModuleToggle;
  // Tier B
  geography: GeographyConfig;
  international: InternationalConfig;
  laborMarket: LaborConfig;
  rndRace: RndRaceConfig;
  teamRoles: TeamRolesConfig;
  verticalIntegration: VerticalConfig;
  ma: MaConfig;
  financialInstruments: FinInstrumentsConfig;
  inventory: InventoryConfig; // MOD-B09 — fully implemented (see engine/inventory.ts)
  reputation: ReputationConfig;
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
  modules?: ModulesConfig; // expansion modules; absent ⇒ all-off (pre-modules / legacy games)
}

/** A deep-partial of Config for overrides / treatment conditions. */
export type ConfigOverride = DeepPartial<Config>;
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

// ----------------------------------------------------------------------------
// State (§3)
// ----------------------------------------------------------------------------

export type FirmStatus = "active" | "bankrupt" | "exited_banked" | "exited_invested" | "exited_rebuilt" | "acquired";

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
  // Carried finished-goods inventory (config-gated; 0 in legacy / disabled mode)
  inventory_units: number;
  inventory_value: number; // $ cost basis, weighted-average
  // MOD-A04 PR events (0 / null when the module is off)
  pr_spike: number; // transient brand boost from PR plays, decays each round
  pr_cooldown_until: number | null; // earliest round a new PR play is allowed
  // MOD-A03 sustainability (0 when the module is off)
  water_efficiency: number; // water-efficiency capability stock (water-shock resilience)
  // MOD-B01 geography (["home"] when the module is off / pre-modules games)
  markets_entered: string[]; // market ids this firm operates in (home is implicit)
  // MOD-B10 reputation (0 when the module is off)
  reputation: number; // credibility stock; grows by honoring agreements, lowers cost of capital
  // MOD-B04 R&D race (0 when the module is off)
  rnd_progress: number; // cumulative R&D progress toward the frontier category
  // MOD-B06 vertical integration (empty when off)
  vertical_assets: { id: string; acquired_round: number }[];
  // MOD-B03 labor market (empty when off)
  key_hires: { role: string; hired_round: number }[];
  // MOD-B08 financial instruments (null/0 when off)
  convertible_note: { principal: number; drawn_round: number } | null;
  rbf_outstanding: number; // remaining total obligation (principal + fee)
  rbf_principal: number; // remaining principal portion (a debt-like liability)
  acquisitions_made?: number; // MOD-B07: completed acquisitions (capped per firm)
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
  public_good_pools?: Record<string, number>; // MOD-A02 accumulators (absent ⇒ none)
  fx_rates?: Record<string, number>; // MOD-B02 per-export-market exchange rate (absent ⇒ none)
  frontier_first_mover?: { firm_id: string; segment: string; until_round: number } | null; // MOD-B04
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
  run_rate?: number; // production as a fraction of effective capacity (inventory mode); undefined ⇒ default (produce-to-capacity)
  pr_action?: PrPlayType | null; // MOD-A04: run a tactical PR play this round (null/undefined ⇒ none)
  invest_water_efficiency?: number; // MOD-A03: spend on water efficiency (expensed; builds the stock)
  public_good_contributions?: Record<string, number>; // MOD-A02: per-good voluntary contributions
  market_presence?: Record<string, number>; // MOD-B01: capacity split across markets (≥0 weights)
  invest_rnd?: number; // MOD-B04: R&D spend toward the frontier category (expensed)
  buy_vertical?: string[]; // MOD-B06: vertical asset ids to purchase this round
  hire_roles?: string[]; // MOD-B03: key roles to hire this round
  fire_roles?: string[]; // MOD-B03: key roles to let go this round
  draw_convertible?: number; // MOD-B08: convertible-note draw (cash in)
  draw_rbf?: number; // MOD-B08: revenue-based-financing draw (cash in)
  acquisition_bid?: { target: FirmId; price: number } | null; // MOD-B07: bid on a distressed rival
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
  spoilage: number; // inventory write-off (0 in legacy / disabled mode)
  depreciation: number;
  ebit: number;
  interest: number;
  net_income: number;
}

export interface BalanceSheet {
  cash: number;
  ppe: number;
  inventory: number; // finished-goods at cost (0 in legacy / disabled mode)
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
  quality_premium: number; // ×(1+…) markup for premium recipes (1 = none)
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
    process: number; cum_output: number; debt: number; equity: number; inventory_units: number;
    // Module stocks (0 when the module is off) — for dashboards & diagnostics.
    reputation: number; water_efficiency: number; rnd_progress: number;
  };
  // Inventory flow this round (null in legacy / disabled mode). turnover = sold / avg-on-hand.
  inventory: { begin: number; produced: number; sold: number; spoiled: number; end: number; turnover: number } | null;
  // Per-market performance (null unless geography is on). Drives the world-map UI.
  markets: Record<string, { revenue: number; q_sold: number; entered: boolean }> | null;
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
