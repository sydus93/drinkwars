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
  /** Floor under the endogenous credit spread, after every discount. Nobody lends to a small
   *  unrated brewery at the risk-free rate; without this the investor-trust and reputation
   *  discounts (each individually larger than base_spread) drove r_debt to exactly r_f. */
  min_spread?: number;
  spread_leverage_k: number;
  leverage_ref: number;
  spread_tinv_k: number;
  tinv_ref: number; // T_inv level treated as "neutral" for spread
  coverage_threshold: number; // below this ⇒ punitive reprice + credit rationing
  coverage_penalty_spread: number;
  /** How the covenant penalty is priced once coverage falls under the threshold.
   *  "step" (default, the v1 behaviour): the full spread the moment the threshold is crossed —
   *  a real default-rate provision, and a hard cliff.
   *  "graduated": the same spread phased in from the threshold down to zero coverage, so a firm
   *  that just misses pays a little and only a firm earning nothing pays it all. */
  coverage_penalty_mode?: "step" | "graduated";
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
  regional?: boolean; // Phase 3: strike a RANDOMLY-chosen market (exposure-weighted by where each firm produces) instead of all firms equally — e.g. a drought hitting one region's water supply
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
  | "verticalIntegration" | "ma" | "financialInstruments" | "inventory" | "reputation" | "facilities" | "employees"
  | "marketConduct";

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
  lots?: Lot[]; // MOD-B11 spatial siting: the fixed buildable parcels in this market (Phase 2)
  geo?: [number, number]; // [lon, lat] — drives shipping distance between markets (Phase 3)
  demand_growth?: number; // per-round compounding change to this market's demand size (Phase 3 heterogeneity)
  population?: number; // informational: addressable metro population the demand pool derives from (~4.3 craft drinks/resident/qtr, DW-029)
}

/** One buildable parcel within a market (Phase 2 spatial siting). A facility occupies a
 *  specific lot at grid coords (x,y); proximity to other facilities (own + rival) drives the
 *  catchment cannibalization term. Each lot belongs to a district (rent/zoning/capacity/brand).
 *  Some lots unlock only after a round (the city develops) — `unlock_round` (0/undefined = open). */
export interface Lot {
  id: string;
  x: number; // grid coords, 0..(catchment.grid-1); matches the City View isometric grid
  y: number;
  district: string; // DistrictConfig.id
  unlock_round?: number; // round this lot becomes available to lease (default 0 = from the start)
}

/** MOD-B01 · Geographic expansion. The home market is always active; domestic
 *  regions open up entry/allocation decisions. Export markets activate only when
 *  MOD-B02 international is also on. */
export interface GeographyConfig {
  enabled: boolean;
  markets: MarketConfig[]; // includes the always-on home market
  // Phase 3 trade: selling units far from where you PRODUCE them (your facilities' markets) costs
  // shipping — per unit, per unit of geo-distance. Local production (a facility in the market) ships
  // free; home→overseas is steep. Absent ⇒ no shipping cost (parity). Tariffs/FX are separate.
  shipping?: { rate_per_unit_distance: number };
}

/** MOD-B02 · International markets. Gates the export-kind markets and drives the
 *  mean-reverting FX process. Requires geography. */
export interface InternationalConfig {
  enabled: boolean;
  fx_mean: number; // long-run FX level (home$ per unit local revenue)
  fx_speed: number; // mean-reversion speed per round
  export_unlock_round?: number; // export markets stay hidden until this round (default 0 = open as soon as international is on). Gates the "go global" phase.
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

/** One contingent clause on a formal/collective agreement (MOD-A05): if `condition`
 *  occurs this round, `action` fires automatically. Conditions and actions are
 *  drawn from fixed menus so clause resolution stays deterministic (no free-form
 *  triggers). No new state variable — clauses live on the agreement itself. */
export type ClauseCondition = "water_shock" | "harvest_shock" | "capacity_shock" | "partner_distress" | "segment_emerges";
export type ClauseAction = "suspend" | "terminate" | "renegotiate";
export interface ContingentClause {
  condition: ClauseCondition;
  action: ClauseAction;
  fired_round?: number | null; // set the round the clause fires (diagnostic; null/absent ⇒ dormant)
}

/** MOD-A05 · Contingent contracts. Adds optional auto-firing clauses to formal /
 *  collective agreements; evaluated after shocks resolve, before scoring. */
export interface ContingentContractsConfig {
  enabled: boolean;
  max_clauses_per_agreement: number;
  suspend_rounds: number; // how many rounds a "suspend" clause pauses the pact's effects
  distress_rounds: number; // rounds-below-health that counts as a partner in "distress"
}

/** MOD-A06 · Renegotiation. A middle path between honoring and defecting: a party
 *  pays to call a renegotiation and propose new terms; a counterparty accepts
 *  (terms update), rejects (continues on original terms), or exits (dissolves at a
 *  reduced breach penalty vs. a flat defection). Once per agreement lifetime. */
export interface RenegotiationConfig {
  enabled: boolean;
  call_cost: number; // cash cost to call a renegotiation (expensed)
  exit_breach_fraction: number; // exit pays this fraction of the formal breach penalty
}

export type RegulationType = "quality_standards" | "ad_restrictions" | "craft_promotion";

/** One lobbyable regulation (MOD-A09). When cumulative net lobbying clears
 *  `threshold` the regulation fires as an industry event for `duration` rounds via
 *  the existing segment-mod channel; the effect favors whoever's positioned for it
 *  (quality standards reward quality, ad limits hurt brand-heavy firms, craft
 *  promotion grows the segment). `effect` is a positive magnitude; its sign by
 *  regulation is applied in the resolver. */
export interface LobbyInitiativeConfig {
  id: string;
  regulation: RegulationType;
  label: string;
  threshold: number; // cumulative net lobbying spend that fires the regulation
  segments?: SegmentId[]; // segments the effect lands on (default: all active)
  effect: number; // βq lift · βb cut · α lift magnitude (sign applied per regulation)
}

/** MOD-A09 · Regulatory capture / lobbying. A dedicated offensive government-relations
 *  lever (kept separate from `invest_T_gov` so the defensive T_gov stock is untouched).
 *  Heavy offensive lobbying risks a scrutiny fine, scaled down by T_gov. */
export interface LobbyingConfig {
  enabled: boolean;
  initiatives: LobbyInitiativeConfig[];
  duration: number; // rounds a fired regulation stays in effect
  decay: number; // per-round decay on un-fired lobbying progress
  counter_effectiveness: number; // $1 of counter-lobbying cancels this much progress
  scrutiny_base_prob: number; // base chance a heavy offensive lobbyist is investigated
  scrutiny_spend_halfsat: number; // offensive spend at which exposure reaches half
  scrutiny_tgov_k: number; // T_gov scales the scrutiny probability down
  scrutiny_fine: number; // cash fine (expensed) on an investigation
}

/** The module registry as it appears in a resolved Config. All keys are always
 *  present after `resolveConfig` (defaults fill them); a persisted pre-modules
 *  game has `modules` absent entirely, which every accessor treats as all-off. */
/** MOD-B11 · Facilities (named physical capacity assets). Additive + gated: a built
 *  facility CAPITALIZES into PP&E (cash→capex through the existing channel, so the
 *  §7.2 invariants hold), ADDS its capacity_contribution to effective cap (scaled by
 *  condition), and carries a fixed cost + optional maintenance (opex). With the module
 *  off, no facilities exist and the engine is identical to the pre-module game. The
 *  capacity contribution is delivered explicitly (NOT through the cap stock pipeline),
 *  so there is no double-count with the capex capitalization. See engine/facilities.ts. */
export interface FacilityTypeConfig {
  id: string;
  label: string;
  // Producer/retail SPECTRUM (not a binary role). A type can produce, sell, both, or neither:
  //  - production_capacity: tank capacity it adds — the PRODUCER role (a shipping origin; bears
  //    regional production shocks; feeds effective capacity). 0 ⇒ doesn't brew (e.g. a bottle shop).
  //  - retail_draw: its local demand/brand pull and the weight it carries in catchment crowding —
  //    the RETAIL role (foot traffic). 0 ⇒ back-of-house (e.g. a pure production brewery).
  // A production brewery is pure producer; a bottle shop pure retail; nano/brewpub/taproom mix.
  production_capacity: number; // tank capacity this type adds at full condition (producer role)
  retail_draw: number; // local demand/brand pull + catchment crowding weight (retail role)
  capacity_contribution?: number; // DEPRECATED — legacy single-scalar alias, read as a production_capacity fallback
  base_cost: number; // build cost, capitalized into PP&E
  fixed_cost: number; // rent + baseline upkeep per round (opex)
  build_rounds: number; // rounds until operational (0 = immediate)
  condition_decay: number; // per-round condition loss at zero maintenance
  maintenance_effect: number; // condition restored per $ of maintenance spend
}
/** A geographic district facilities can be sited in — a real siting tradeoff, not just
 *  flavor. Three legible levers: rent scales fixed cost (cheap industrial vs. pricey
 *  downtown); capacity_mult scales the output a facility here delivers (roomy industrial
 *  yards run hot, cramped downtown space less so); brand_boost is a per-round Brand lift
 *  per active facility here (foot traffic + visibility downtown/riverside; none in an
 *  industrial park). capacity_mult/brand_boost are optional (absent ⇒ 1 / 0). */
export interface DistrictConfig {
  id: string;
  label: string;
  kind: "downtown" | "industrial" | "riverside" | "suburban";
  rent_mult: number; // multiplier on facility fixed cost sited here
  capacity_mult?: number; // multiplier on delivered capacity for facilities here (default 1)
  brand_boost?: number; // Brand (B) added per round per active, online facility here (default 0)
  blurb: string;
}
/** Phase 2 spatial catchment: a facility's demand pull is cut by competing facilities nearby.
 *  For each of a firm's online facilities, crowding = Σ over other online facilities within
 *  `radius` of kernel(dist)·weight (weight 1 for rivals, `self_weight` for the firm's own —
 *  self-cannibalization is real but softer). A facility's local score = 1/(1+lambda·crowding);
 *  the firm's market location score is its capacity-weighted average, mapped to a utility term
 *  `beta_loc·(2·score−1)` (blue-ocean → +beta_loc, fully crowded → −beta_loc). All-zero/absent
 *  ⇒ no spatial effect (parity). */
export interface CatchmentConfig {
  grid: number; // coordinate space size (lots use 0..grid-1); also the City View grid
  radius: number; // catchment reach in grid units
  lambda: number; // crowding → score falloff strength
  self_weight: number; // own-facility cannibalization weight vs. 1 for rivals
  beta_loc: number; // utility scale of the location term (noticeable; tune with play data)
}
export interface FacilitiesConfig {
  enabled: boolean;
  max_facilities: number; // cap on owned facilities per firm
  salvage_fraction?: number; // divest: cash recovered = this × base_cost × condition (default 0.5). Frees the lot.
  types: FacilityTypeConfig[];
  districts?: DistrictConfig[]; // siting options (optional)
  catchment?: CatchmentConfig; // Phase 2 spatial cannibalization (optional; absent ⇒ off)
  // District brand draw saturates as B grows: boost × halfsat/(halfsat+B) — same guard
  // as EmployeesConfig.stock_halfsat, for the same DW-041 reason (a downtown portfolio
  // otherwise pumps B linearly forever). Absent ⇒ no saturation (legacy behavior).
  brand_halfsat?: number;
}
/** One owned facility (FirmState.facilities) — named, condition-tracked. */
export interface Facility {
  id: string; // unique per firm (e.g. "fac_3_0")
  type: string; // FacilityTypeConfig.id
  name: string; // player-assigned display name
  built_round: number;
  online_round: number; // round it becomes operational
  condition: number; // 0..1
  active: boolean; // false ⇒ mothballed (no capacity, no fixed cost)
  location_id?: string; // DistrictConfig.id it's sited in (optional)
  market_id?: string; // MOD-B01 market/city this facility belongs to (optional; "home" when geography on and unset). Siting/display tag.
  lot_id?: string; // Phase 2: the specific Lot (parcel) it occupies in that market — drives catchment
}

/** MOD-B12 · Employees (named human capital). Additive + gated, like facilities:
 *  a hire adds a per-round salary (opex) and a skill-scaled per-round gain to one
 *  stock (Q/B/process/T_*), scaled by satisfaction. Satisfaction drifts with pay vs.
 *  market, tenure, and firm health; at zero the person quits (a T_emp hit). A fresh
 *  hiring market of candidates is generated deterministically each round, so the web
 *  shows exactly what the engine will accept. With the module off, no employees exist
 *  and the engine is identical to the pre-module game. Stock gains never touch the
 *  balance sheet and salaries are opex, so the §7.2 invariants are preserved. */
export type EmployeeStock = "Q" | "B" | "process" | "T_emp" | "T_inv" | "T_gov";
export interface EmployeeRoleConfig {
  id: string;
  label: string;
  primary_stock: EmployeeStock; // which stock this role raises
  gain_per_skill: number; // per-round stock gain = skill × this × satisfaction
  base_salary: number; // market salary for a skill-3 of this role
}
export interface EmployeesConfig {
  enabled: boolean;
  max_employees: number; // roster cap per firm
  market_size: number; // candidates offered each round
  roles: EmployeeRoleConfig[];
  starting_satisfaction: number; // satisfaction a new hire starts at (0..1)
  tenure_bump: number; // satisfaction lift at tenure milestones (rounds 3/6/10)
  poach_base: number; // base per-round chance a dissatisfied hire is poached
  // Employee gains saturate as the stock they feed grows: gain × halfsat/(halfsat+stock).
  // The base game's invest channels are sqrt-concave; without this, a staffed-up firm's
  // LINEAR per-round inflow compounds past anything investment can reach (Q>120 at end
  // vs ~40 in the base game) and the logit demand turns that into winner-take-all
  // (DW-041 all-modules collapse). Absent ⇒ no saturation (legacy behavior).
  stock_halfsat?: number;
}
/** A hireable candidate in the round's market (pre-hire; deterministic per round). */
export interface Candidate {
  id: string; // stable within the round (e.g. "cand_4_2")
  name: string;
  role: string; // EmployeeRoleConfig.id
  skill: number; // 1..5
  salary: number; // their ask (skill-correlated, with scouting noise)
  avatar_seed: string;
}
/** One employed person (FirmState.employees). */
export interface Employee {
  id: string; // unique per firm (e.g. "emp_4_0")
  name: string;
  role: string; // EmployeeRoleConfig.id
  skill: number; // 1..5
  salary: number; // per-round cost (opex)
  satisfaction: number; // 0..1; at 0 they quit
  tenure_rounds: number;
  hired_round: number;
  avatar_seed: string;
}

/** MOD-A10 · Market conduct & stakeholder backlash. Gives stakeholder management defensive
 *  teeth: a DOMINANT firm that GOUGES (high markup over cost) — worse if on THIN QUALITY —
 *  draws a consumer-protection fine (opex) + brand erosion. Both are mitigated by regulatory
 *  goodwill (T_gov) and reputation, so the firms that invested in stakeholder relationships
 *  ride out scrutiny that punishes the pure profit-maximizer. Off ⇒ no effect (parity). */
export interface MarketConductConfig {
  enabled: boolean;
  dominance_threshold: number; // market share above which conduct is scrutinized (e.g. 0.40)
  fair_markup: number; // realized-price/unit-cost above which markup reads as gouging
  sensitivity: number; // overall scale of the conduct score
  quality_weight: number; // how much selling below the field's average quality worsens it
  fine_scale: number; // conduct → cash fine (opex)
  fine_cap_frac: number; // fine capped at this fraction of the firm's cash
  brand_scale: number; // conduct → Brand (B) erosion
  tgov_k: number; // T_gov goodwill mitigation weight
  rep_k: number; // reputation mitigation weight
  halfsat: number; // half-saturation for the mitigation stocks
  max_mitigation: number; // cap on how much goodwill can blunt the backlash
}

export interface ModulesConfig {
  // Tier A
  publicGoods: PublicGoodsConfig;
  sustainability: SustainabilityConfig;
  prEvents: PrEventsConfig;
  contingentContracts: ContingentContractsConfig;
  renegotiation: RenegotiationConfig;
  asymmetricStarts: AsymmetricStartsConfig;
  consumerDrift: ConsumerDriftConfig;
  lobbying: LobbyingConfig;
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
  facilities: FacilitiesConfig; // MOD-B11 — named physical capacity assets (see engine/facilities.ts)
  employees: EmployeesConfig; // MOD-B12 — named human capital (see engine/employees.ts)
  marketConduct: MarketConductConfig; // MOD-A10 — stakeholder/regulatory backlash (see engine/conduct.ts)
}

export type ScorecardComponent = "financial" | "market" | "intangible" | "stakeholder";

/** Scoring-layer §4 — a named discipline penalty: a scalar in (0, 1] multiplying ONE
 *  raw sub-metric of ONE component, applied BEFORE within-round normalization (raw
 *  space), so the penalty competes on the same scale as the underlying performance.
 *  The registry ships empty and disabled; a future mechanic (e.g. the inventory
 *  decision) slots in as config, not as an engine change. */
export interface ScoringPenalty {
  id: string;
  component: ScorecardComponent;
  /** Which raw series the multiplier applies to. The three financial sub-metrics are
   *  addressable individually; the other components are single-series. */
  submetric: "profitability" | "soundness" | "cash_resilience" | "market" | "intangible" | "stakeholder";
  form: "linear_ratio"; // p = 1 − clamp(numerator/denominator, 0, max_bite)
  numerator: string; // key into the per-firm metric bag the engine already emits
  denominator: string;
  max_bite: number; // in (0, 1]; the multiplier floors at 1 − max_bite
  enabled: boolean;
}

export interface ScoringConfig {
  weights: { financial: number; market: number; intangible: number; stakeholder: number };
  accumulation: "round_average" | "auc";
  normalization: "zscore_within_round" | "percentile_within_round";
  financial_blend: { profitability: number; soundness: number; cash_resilience: number };
  cash_safety_threshold: number;
  healthy_coverage: number;
  healthy_leverage: number;
  // ── Scoring-layer additions (06_scoring_layer_spec). All optional; absent or at
  // defaults, engine output is identical to the pre-layer implementation (gate §8.1).
  /** §2 accumulation window: excluded rounds still resolve and publish — they simply
   *  don't enter the running scorecard average. drop_first and tail_only are mutually
   *  exclusive (the loader throws if both are set). */
  accumulation_window?: { drop_first?: number; tail_only?: number | null };
  /** §3 terminal-round weight λ ∈ [0, 0.5]: Score = (1−λ)·sustained + λ·final-round.
   *  0 (default) = pure sustained. λ > 0 reopens the liquidation exploit by
   *  construction — the loader warns above 0.25 and the harness gate must hold. */
  terminal_weight?: number;
  /** §4 discipline penalties. Ships empty. */
  penalties?: ScoringPenalty[];
  /** §5 absolute benchmark bands per raw sub-metric — DISPLAY ONLY, never scored.
   *  Mutating them must leave every score, rank and export unchanged (gate §8.6). */
  benchmark_bands?: Record<string, BenchmarkBand>;
  /** Round-indexed overrides for the bands above (DW-057). Three of the four scored
   *  sub-metrics are STOCKS that compound — the median firm's stakeholder mean runs 9.0 at
   *  round 0 and 34.3 at round 15 — so one flat band cannot serve a 4-round sprint and a full
   *  season at once. Keyed on the ROUND rather than the game's length, because that is what
   *  actually decides where a firm should be: round 2 of a 4-round game and round 2 of a
   *  12-round game are the same firm, so one schedule serves every length.
   *  Entries are sorted by `from_round`; the last one whose `from_round <= round` wins, and its
   *  bands merge OVER `benchmark_bands` key by key, so a metric left out of the schedule (e.g.
   *  interest_cover, whose textbook 1.5/3/6 beats any empirical cut) keeps the flat band.
   *  A degenerate triple (strong <= weak) means "no meaningful band this round" — the founding
   *  quarter, where the field has not spread yet — and the UI shows an explanation, not a tier. */
  benchmark_bands_by_round?: { from_round: number; bands: Record<string, BenchmarkBand> }[];
}

export interface BenchmarkBand { weak: number; sound: number; strong: number }

/** The bands in force for `round`, schedule merged over the flat map. Shared by the scorecard
 *  panel and the statements ratio rail so the two can never disagree. */
export function bandsForRound(
  scoring: { benchmark_bands?: Record<string, BenchmarkBand>; benchmark_bands_by_round?: { from_round: number; bands: Record<string, BenchmarkBand> }[] } | undefined,
  round: number,
): Record<string, BenchmarkBand> {
  const flat = scoring?.benchmark_bands ?? {};
  const sched = scoring?.benchmark_bands_by_round;
  if (!sched?.length) return flat;
  let pick: Record<string, BenchmarkBand> | null = null;
  let best = -Infinity;
  for (const entry of sched) {
    if (entry.from_round <= round && entry.from_round >= best) { best = entry.from_round; pick = entry.bands; }
  }
  return pick ? { ...flat, ...pick } : flat;
}

/** Does this band actually discriminate? A degenerate one is the schedule's way of saying the
 *  field has not spread yet this round — grading against it would be inventing a tier. */
export function bandIsMeaningful(b: BenchmarkBand | undefined): b is BenchmarkBand {
  return !!b && b.strong > b.weak;
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
  // MOD-B11 facilities (named physical capacity assets; empty/undefined when off)
  facilities?: Facility[];
  // MOD-B12 employees (named human capital; empty/undefined when off)
  employees?: Employee[];
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

/** Negotiated economic terms of a pact (DW-037). Every field optional — absent falls
 *  back to the config template constant / current behavior, so older saved states and
 *  terms-less proposals resolve exactly as before. */
export interface AgreementTerms {
  /** The template's economic dial: joint_marketing → brand_pool_fraction,
   *  capacity_coordination → capacity_restraint, supply_share → unit_cost_reduction.
   *  Clamped to sane per-template bounds at proposal time. */
  magnitude?: number;
  /** Auto-dissolve (mutual) this many rounds after formation. Null/absent = evergreen. */
  duration_rounds?: number | null;
  /** Proposer's share of the formation cost (0..1). Absent = 1 (proposer pays it all);
   *  the remainder is split evenly across the other signatories at activation. */
  cost_split?: number;
}

export interface AgreementState {
  id: string;
  form: GovernanceForm;
  template: TemplateId;
  signatories: FirmId[];
  segment: SegmentId | null; // for joint_marketing
  terms?: AgreementTerms; // negotiated economics (absent ⇒ config defaults)
  formation_round: number;
  active: boolean;
  dissolution_round: number | null;
  dissolution_type: "defection" | "mutual" | "antitrust" | "renegotiated" | "clause" | null;
  constrained_until_round: number | null; // antitrust / contingent-suspend constraint
  // MOD-A05 contingent clauses (auto-fire on a named condition). Absent ⇒ none.
  clauses?: ContingentClause[];
  // MOD-A06 renegotiation: an open call awaiting a counterparty response. Null/absent
  // ⇒ no open call. `renegotiation_used` enforces once-per-agreement-lifetime.
  renegotiation?: { caller: FirmId; called_round: number; proposed_template?: TemplateId; proposed_segment?: SegmentId | null; proposed_terms?: AgreementTerms } | null;
  renegotiation_used?: boolean;
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
  region?: string; // Phase 3: the market this regional shock struck (chosen randomly at roll time)
}

export interface SegmentWorld {
  id: SegmentId;
  D: number; // current demand size
  active: boolean;
}

export interface SegmentPriceMod {
  segment: SegmentId;
  alpha_delta: number; // additive change to α_s while active (distress dumping, craft-promotion lobbying)
  beta_q_delta?: number; // MOD-A09 quality-standards regulation: additive βq lift while active
  beta_b_delta?: number; // MOD-A09 ad-restrictions regulation: additive βb change (negative) while active
  until_round: number;
}

/** Live state of one lobbying initiative (MOD-A09), created lazily on first spend
 *  and carried on world state round-to-round. `progress` decays until it clears the
 *  configured threshold and the regulation `fired`. */
export interface LobbyingInitiative {
  id: string; // matches a LobbyInitiativeConfig id
  regulation: RegulationType;
  progress: number;
  fired: boolean;
  fired_round: number | null;
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
  lobbying_initiatives?: LobbyingInitiative[]; // MOD-A09 active/fired regulation pushes (absent ⇒ none)
  // Alliance proposals awaiting counterparty consent (mutual-consent formation — a pact
  // only binds once every named counterparty accepts). Absent ⇒ none (older saved states).
  pending_agreements?: PendingAgreement[];
}

/** A proposed alliance awaiting acceptance. Becomes an AgreementState (and the proposer
 *  pays the formation cost) only when EVERY counterparty has accepted; a decline kills it;
 *  unanswered proposals expire after PROPOSAL_TTL_ROUNDS. Not an agreement — it has no
 *  demand/cost effect and never enters the agreements research table. */
export interface PendingAgreement {
  id: string;
  form: GovernanceForm;
  template: TemplateId;
  proposer: FirmId;
  counterparties: FirmId[]; // everyone who must accept (proposer implicitly consents)
  segment: SegmentId | null; // for joint_marketing
  clauses?: ContingentClause[]; // MOD-A05 clauses carried into the formed agreement
  terms?: AgreementTerms; // proposed economics (absent ⇒ config defaults)
  proposed_round: number;
  accepted: FirmId[]; // counterparties who have said yes so far
  /** Set when a counterparty counter-offers: roles swap (they become the proposer) and
   *  the original proposer must now accept the revised terms. Counts ping-pong rounds. */
  counters?: number;
}

// ----------------------------------------------------------------------------
// Decisions (§4)
// ----------------------------------------------------------------------------

export interface AgreementAction {
  type: "form" | "defect" | "renegotiate" | "renegotiate_response" | "accept_proposal" | "decline_proposal" | "counter_proposal";
  // form (creates a PENDING proposal — counterparties must accept before the pact binds):
  form?: GovernanceForm;
  template?: TemplateId;
  counterparties?: FirmId[];
  segment?: SegmentId;
  clauses?: ContingentClause[]; // MOD-A05: contingent clauses attached at formation (formal/collective only)
  terms?: AgreementTerms; // form / counter_proposal: the economic terms on the table
  // accept_proposal / decline_proposal / counter_proposal: a counterparty's answer to a pending proposal.
  proposal_id?: string;
  // defect / renegotiate / renegotiate_response:
  agreement_id?: string;
  // renegotiate (MOD-A06): the new terms the caller proposes.
  proposed_template?: TemplateId;
  proposed_segment?: SegmentId | null;
  proposed_terms?: AgreementTerms; // renegotiate: revised economics on the table
  // renegotiate_response (MOD-A06): a counterparty's answer to an open call.
  response?: "accept" | "reject" | "exit";
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
  market_supply?: Record<string, number>; // Phase 3 (Stage 2): explicit units to offer per market, drawn from total sellable (overrides the presence split). Absent ⇒ presence-weighted.
  invest_rnd?: number; // MOD-B04: R&D spend toward the frontier category (expensed)
  buy_vertical?: string[]; // MOD-B06: vertical asset ids to purchase this round
  hire_roles?: string[]; // MOD-B03: key roles to hire this round
  fire_roles?: string[]; // MOD-B03: key roles to let go this round
  // MOD-B11 facilities (physical capacity assets)
  build_facilities?: { type: string; name?: string; location?: string; market?: string; lot?: string; bid?: number }[]; // facility types to build this round (location = district id; market = MOD-B01 market/city id; lot = Phase 2 parcel id; bid = lease premium for a contested parcel — highest bid wins it)
  maintain_facilities?: Record<string, number>; // facility id → maintenance $ this round
  mothball_facilities?: string[]; // facility ids to take offline (stop fixed cost + capacity)
  reactivate_facilities?: string[]; // mothballed facility ids to bring back online
  divest_facilities?: string[]; // facility ids to sell/demolish — frees the lot (back to the lease pool) and recovers partial book value
  // MOD-B12 employees
  hire_employees?: string[]; // candidate ids (from this round's market) to hire
  hire_bids?: Record<string, number>; // candidate id → optional signing-bonus premium; a candidate is one person — in a contested hire the higher bonus signs them, and only the winner pays
  fire_employees?: string[]; // employee ids to let go this round
  raise_employees?: Record<string, number>; // employee id → new salary (a raise)
  poach_employees?: { firm: string; employee: string; offer: number }[]; // lure a rival's employee with an offer
  draw_convertible?: number; // MOD-B08: convertible-note draw (cash in)
  draw_rbf?: number; // MOD-B08: revenue-based-financing draw (cash in)
  acquisition_bid?: { target: FirmId; price: number } | null; // MOD-B07: bid on a distressed rival
  // MOD-A09 lobbying (offensive government relations; separate from invest_T_gov).
  lobby_spend?: number; // cash directed at lobbying this round (expensed)
  lobby_initiative?: string | null; // a regulation initiative id to PUSH (offensive; draws scrutiny)
  lobby_counter?: string | null; // a regulation initiative id to COUNTER (defensive; no scrutiny)
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
  /** Capacity actually available to brew into this quarter: the generic `state.cap` stock PLUS
   *  online facilities, after shock and coordination-restraint multipliers. `state.cap` alone is
   *  only the generic stock, so a utilization ratio built on it reads above 100% in any game with
   *  the facilities module on. Optional so an older persisted result still parses. */
  effective_cap?: number;
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
  // Per-market performance (null unless geography is on). Drives the world-map / City View UI.
  // bySeg carries within-market per-segment standings (q_sold, within-market share, local price) for the per-city demand panel.
  // produced = producer capacity sited in the market; net = produced − q_sold; lanes = inbound
  // shipments (shortfall from the nearest base) for the trade-lane viz. (consumed == q_sold.)
  markets: Record<string, { revenue: number; q_sold: number; entered: boolean; bySeg?: Record<SegmentId, { q_sold: number; share: number; price: number }>; produced: number; net: number; lanes: { origin_market: string; units: number; cost: number }[] }> | null;
  scorecard_raw: { financial: number; market: number; intangible: number; stakeholder: number };
  scorecard_norm: { financial: number; market: number; intangible: number; stakeholder: number };
  scorecard_cumulative: number;
  /** Scoring-layer §9. scored=false ⇒ the round resolved and published but was
   *  excluded from the accumulation window (§2). The bridge decomposes this round's
   *  change in headline score into exactly-attributable per-component bars (plus the
   *  terminal-blend bar on the final round); bars sum to the delta with zero
   *  residual. penalty_multipliers records each enabled penalty's realized scalar. */
  scored?: boolean;
  scorecard_bridge?: { financial: number; market: number; intangible: number; stakeholder: number; terminal: number };
  penalty_multipliers?: Record<string, number>;
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
