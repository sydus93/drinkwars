/**
 * Expansion-module registry, defaults, instructor presets, and accessors
 * (04_expansion_module_spec). This is the single source of truth the engine,
 * server, and instructor dashboard all read — adding a module is one registry
 * entry plus its resolution logic, nothing more.
 *
 * Design invariants (spec §1):
 *  1. Flag-gated, not forked. One codebase; a "mode" is just a set of flags.
 *  2. Additive. With every flag off, the engine reproduces v1 exactly.
 *  3. UI complexity is a presentation problem — the registry drives which panels
 *     and toggles appear; disabled/planned modules simply don't render (or render
 *     locked).
 */
import type { Config, ConfigOverride, ModuleId, ModulesConfig } from "../types.js";

/** Canonical all-off module block merged into the baseline config. */
export const defaultModules: ModulesConfig = {
  // ---- Tier A — low lift ----
  publicGoods: {
    enabled: false,
    decay: 0.1,
    goods: [
      { id: "regional_marketing", benefit: "demand", threshold: 0, max_effect: 0.15, halfsat: 150 },
      { id: "water_commons", benefit: "water_resilience", threshold: 100, max_effect: 0.4, halfsat: 200 },
      { id: "quality_certification", benefit: "quality", threshold: 150, max_effect: 0.06, halfsat: 150 },
    ],
  },
  sustainability: {
    enabled: false,
    gain: 0.6,
    depreciation: 0.08,
    resilience_k: 0.4, // up to +40% mitigation on water shocks at full efficiency
    resilience_halfsat: 15,
    t_gov_gain_per_invest: 0.4,
  },
  prEvents: {
    enabled: false,
    cooldown_rounds: 3,
    spike_magnitude: 7, // brand-equivalent; meaningful next to a ~10 starting brand
    spike_decay_rate: 0.4, // burns off in 1–2 rounds (vs ~0.18 brand depreciation)
    cost: 90,
    type_bonus: { festival: 1.0, collab: 1.15, viral: 1.3 },
    negative_pr_enabled: true,
    negative_pr_probability: 0.06,
    negative_pr_t_emp_mitigation: 0.6,
    negative_pr_brand_damage: 9,
  },
  contingentContracts: { enabled: false },
  renegotiation: { enabled: false },
  asymmetricStarts: {
    enabled: false,
    incumbent_count: 2, // first N firms start as incumbents; the rest as entrants
    incumbent: { cap: 1.8, B: 1.8, Q: 1.5, cash: 0.9, unit_cost: 0.85 },
    entrant: { cap: 0.7, B: 0.6, Q: 0.8, cash: 1.2, unit_cost: 1.08 },
  },
  consumerDrift: {
    enabled: false,
    // Mass turns quality-sensitive and a touch less price-driven; niche keeps
    // climbing on quality. Bounds are absolute coefficient values.
    tracks: [
      { segment: "mass", variable: "beta_q", delta_per_round: 0.006, ceiling: 0.16 },
      { segment: "mass", variable: "beta_p", delta_per_round: -0.004, floor: 0.28 },
      { segment: "niche", variable: "beta_q", delta_per_round: 0.004, ceiling: 0.26 },
    ],
  },
  lobbying: { enabled: false },
  // ---- Tier B — medium lift ----
  geography: {
    enabled: false,
    // Capacity is SPLIT across markets, not multiplied — entering a region trades
    // home presence for reach. Regions reshape tastes; brand carries at a discount.
    markets: [
      { id: "home", label: "Home region", kind: "home", demand_mult: 1.0, beta_p_mult: 1.0, beta_q_mult: 1.0, beta_b_mult: 1.0, brand_transfer: 1.0, entry_cost: 0, distribution_cost_per_unit: 0, tariff_rate: 0, fx_volatility: 0 },
      { id: "heartland", label: "Heartland", kind: "domestic", demand_mult: 1.3, beta_p_mult: 1.3, beta_q_mult: 0.7, beta_b_mult: 0.8, brand_transfer: 0.7, entry_cost: 200, distribution_cost_per_unit: 0.4, tariff_rate: 0, fx_volatility: 0 },
      { id: "coastal", label: "Coastal cities", kind: "domestic", demand_mult: 0.75, beta_p_mult: 0.7, beta_q_mult: 1.3, beta_b_mult: 1.15, brand_transfer: 0.7, entry_cost: 300, distribution_cost_per_unit: 0.5, tariff_rate: 0, fx_volatility: 0 },
      { id: "export_eu", label: "European export", kind: "export", demand_mult: 0.9, beta_p_mult: 0.8, beta_q_mult: 1.2, beta_b_mult: 1.1, brand_transfer: 0.4, entry_cost: 400, distribution_cost_per_unit: 0.6, tariff_rate: 0.12, fx_volatility: 0.05 },
      { id: "export_asia", label: "Asia-Pacific export", kind: "export", demand_mult: 1.2, beta_p_mult: 1.1, beta_q_mult: 1.0, beta_b_mult: 1.2, brand_transfer: 0.4, entry_cost: 450, distribution_cost_per_unit: 0.7, tariff_rate: 0.08, fx_volatility: 0.08 },
    ],
  },
  international: { enabled: false, fx_mean: 1.0, fx_speed: 0.2 },
  laborMarket: {
    enabled: false,
    roles: [
      { id: "head_brewer", label: "Head brewer", bonus: { Q: 5 }, salary: 18, signing_bonus: 36 },
      { id: "sales_director", label: "Sales director", bonus: { B: 4, T_emp: 1 }, salary: 16, signing_bonus: 32 },
      { id: "ops_manager", label: "Operations manager", bonus: { process: 4 }, salary: 15, signing_bonus: 30 },
    ],
    departure_prob: 0.07,
    t_emp_mitigation: 0.6,
    t_emp_halfsat: 20,
  },
  rndRace: { enabled: false, gain: 1.0, threshold: 60, first_mover_brand_bonus: 8, first_mover_duration: 3 },
  teamRoles: { enabled: false, noise: { cfo: 0.08, cmo: 0.1, coo: 0.05, ceo: 0.15 } },
  verticalIntegration: {
    enabled: false,
    max_assets: 2,
    assets: [
      { id: "hop_supplier", label: "Hop & grain supplier", type: "upstream", cost: 280, unit_cost_reduction: 0.1, reg_relief: 0, integration_lag: 2, antitrust_units: 0 },
      { id: "distributor", label: "Regional distributor", type: "downstream", cost: 380, unit_cost_reduction: 0, reg_relief: 0.5, integration_lag: 2, antitrust_units: 1 },
    ],
  },
  // Conquest guards (tuned on the all-modules sweep): a target must be deeply
  // distressed, the floor price is near fair value, and one firm can't roll up
  // the whole industry.
  ma: { enabled: false, integration_discount: 0.6, min_price_fraction: 0.75, min_distress_rounds: 2, max_acquisitions: 2 },
  financialInstruments: {
    enabled: false,
    convertible: { rate: 0.04, term: 4, max_equity_fraction: 1.0 },
    rbf: { payment_rate: 0.07, multiple: 1.3, max_revenue_fraction: 1.0 },
  },
  // MOD-B09 — fully implemented. OFF by default: enabling it reopens the strategic
  // balance (inventory cash + spoilage penalize high-volume play), to be re-tuned
  // with play-test data, not guessed. Pre-modules games (no block) run the legacy
  // working-capital-zero path. See engine/inventory.ts.
  inventory: { enabled: false, spoilage_rate: 0.1, max_run_rate: 1.0, holding_cost_per_unit: 0 },
  reputation: { enabled: false, gain_honor: 0.6, loss_defect: 4, depreciation: 0.05, halfsat: 6, spread_reduction_max: 0.02 },
};

/** Catalog metadata for the instructor selector. `implemented` gates whether the
 *  toggle does anything yet (planned modules render locked). `code` is the spec id. */
export type ModuleCategory = "markets" | "global" | "operations" | "finance" | "people" | "society";

/** Thematic groupings for the instructor selector — how a course catalog would
 *  shelve them, not how heavy they are to build. Order here is display order. */
export const MODULE_CATEGORIES: { id: ModuleCategory; label: string; blurb: string }[] = [
  { id: "markets", label: "Markets & Customers", blurb: "How demand behaves and how firms fight for it — brand plays, shifting tastes, innovation races, uneven starting positions." },
  { id: "global", label: "Geography & Trade", blurb: "Where you compete — regional markets with different tastes, plus exports with tariffs and currency swings." },
  { id: "operations", label: "Operations & Supply", blurb: "How the product gets made and moved — production runs, inventory, and owning your supply chain." },
  { id: "finance", label: "Finance & Deals", blurb: "How firms are funded and bought — alternative financing, acquisitions, and richer contracting." },
  { id: "people", label: "People & Teams", blurb: "The human side — key talent, poaching, and within-team decision roles." },
  { id: "society", label: "Society & Governance", blurb: "The industry around the firms — shared resources, sustainability, reputation, and regulators." },
];

export interface ModuleMeta {
  id: ModuleId;
  code: string; // spec identifier, e.g. "MOD-A07"
  tier: "A" | "B";
  category: ModuleCategory; // thematic shelf in the instructor selector
  name: string;
  blurb: string; // one sentence shown under the toggle
  pedagogy: string; // the concept it teaches (shown in the "?" info box)
  deps: ModuleId[]; // modules that must also be enabled
  requiresMultiplayer?: boolean;
  implemented: boolean; // engine logic wired? if false, toggle is shown locked
}

/** The full Tier-A + Tier-B catalog (Tier C / deferred A01·A10 are out of scope). */
export const MODULE_REGISTRY: ModuleMeta[] = [
  // ---- Tier A ----
  {
    id: "publicGoods", code: "MOD-A02", tier: "A", category: "society", name: "Industry public goods",
    blurb: "Voluntary industry funds (marketing, water commons, certification) with shared, non-excludable benefits.",
    pedagogy: "Collective action, tragedy of the commons, Olson vs Ostrom, free-rider dynamics.",
    deps: [], implemented: true,
  },
  {
    id: "sustainability", code: "MOD-A03", tier: "A", category: "society", name: "Sustainability as resilience",
    blurb: "Water-efficiency investment that blunts the water shock and earns regulator goodwill.",
    pedagogy: "Resilience investment, sustainability as strategy (not values), resource commons.",
    deps: [], implemented: true,
  },
  {
    id: "prEvents", code: "MOD-A04", tier: "A", category: "markets", name: "PR events / tactical brand",
    blurb: "One-shot brand actions (festival, collab, viral label) that spike brand then decay fast; negative PR can fire.",
    pedagogy: "Tactical vs strategic brand, reputation fragility, employee trust as brand insurance.",
    deps: [], implemented: true,
  },
  {
    id: "contingentContracts", code: "MOD-A05", tier: "A", category: "finance", name: "Contingent contracts",
    blurb: "Automatic clauses on formal agreements that fire on named conditions (a shock hits, cash falls, etc.).",
    pedagogy: "Incomplete contracting, adaptation vs commitment, hold-up, contingent governance.",
    deps: [], implemented: false,
  },
  {
    id: "renegotiation", code: "MOD-A06", tier: "A", category: "finance", name: "Renegotiation",
    blurb: "A middle path between honor and defect: call to renegotiate an agreement once per lifetime.",
    pedagogy: "TCE adaptation, relational vs formal governance, flexibility vs stability.",
    deps: [], implemented: false,
  },
  {
    id: "asymmetricStarts", code: "MOD-A07", tier: "A", category: "markets", name: "Asymmetric starts",
    blurb: "Some firms begin as incumbents (bigger, stronger brand, lower cost), others as scrappy entrants.",
    pedagogy: "Incumbent vs disruptor dynamics, market entry, competitive response, niche-finding.",
    deps: [], implemented: true,
  },
  {
    id: "consumerDrift", code: "MOD-A08", tier: "A", category: "markets", name: "Consumer drift",
    blurb: "Segment tastes drift over time (mass turns quality-sensitive); read it early and reposition to win.",
    pedagogy: "Dynamic capabilities, market sensing, innovator's dilemma, repositioning under drift.",
    deps: [], implemented: true,
  },
  {
    id: "lobbying", code: "MOD-A09", tier: "A", category: "society", name: "Regulatory capture / lobbying",
    blurb: "Direct government-relations spend offensively to win a favorable regulation; rivals can counter-lobby.",
    pedagogy: "Non-market strategy, regulatory capture, political CSR, competitive lobbying.",
    deps: [], implemented: false,
  },
  // ---- Tier B ----
  {
    id: "geography", code: "MOD-B01", tier: "B", category: "global", name: "Geographic expansion",
    blurb: "Multiple regional markets with different tastes; choose where to operate and split capacity.",
    pedagogy: "Geographic strategy, market selection, Blue Ocean, local vs global brand, distribution.",
    deps: [], implemented: true,
  },
  {
    id: "international", code: "MOD-B02", tier: "B", category: "global", name: "International markets",
    blurb: "Export markets with FX exposure, tariffs, and regulatory heterogeneity.",
    pedagogy: "International strategy, exchange-rate risk, institutional distance, global vs local brand.",
    deps: ["geography"], implemented: true,
  },
  {
    id: "laborMarket", code: "MOD-B03", tier: "B", category: "people", name: "Labor market & human capital",
    blurb: "Hire key employees (head brewer, sales director…) for stock bonuses; rivals can poach them.",
    pedagogy: "Human capital as resource, talent-market competition, retention vs acquisition, RBV.",
    deps: [], implemented: true,
  },
  {
    id: "rndRace", code: "MOD-B04", tier: "B", category: "markets", name: "R&D & innovation races",
    blurb: "Invest in R&D toward the new category; first past the threshold gets a first-mover advantage.",
    pedagogy: "Innovation races, first-mover advantage, R&D as option, technology emergence.",
    deps: [], implemented: true,
  },
  {
    id: "teamRoles", code: "MOD-B05", tier: "B", category: "people", name: "Within-team roles",
    blurb: "Each member gets a role (CEO/CFO/CMO/COO) with a private signal; integrate conflicting reads.",
    pedagogy: "Organizational information processing, intra-team conflict, role-based authority.",
    deps: [], requiresMultiplayer: true, implemented: true,
  },
  {
    id: "verticalIntegration", code: "MOD-B06", tier: "B", category: "operations", name: "Vertical integration",
    blurb: "Acquire upstream (suppliers) or downstream (distribution) assets; make-vs-buy with antitrust exposure.",
    pedagogy: "Vertical integration, make-vs-buy, TCE, three-tier dynamics, asset specificity.",
    deps: [], implemented: true,
  },
  {
    id: "ma", code: "MOD-B07", tier: "B", category: "finance", name: "M&A / firm acquisition",
    blurb: "Bid for distressed rivals instead of letting them exit; absorb brand, capacity, and debt.",
    pedagogy: "Market for corporate control, M&A valuation, integration costs, distressed pricing.",
    deps: [], implemented: true,
  },
  {
    id: "financialInstruments", code: "MOD-B08", tier: "B", category: "finance", name: "Financial instruments",
    blurb: "Convertible notes, revenue-based financing, and trade credit beyond plain debt/equity.",
    pedagogy: "Capital structure, financing-instrument selection, dilution, working capital.",
    deps: [], implemented: true,
  },
  {
    id: "inventory", code: "MOD-B09", tier: "B", category: "operations", name: "Production & inventory",
    blurb: "Choose a brew run-rate; unsold finished goods carry over at weighted-average cost and spoil.",
    pedagogy: "Inventory turnover, demand uncertainty, spoilage & perishability, working capital.",
    deps: [], implemented: true,
  },
  {
    id: "reputation", code: "MOD-B10", tier: "B", category: "society", name: "Reputation & credibility",
    blurb: "A credibility stock (distinct from brand) that grows by honoring deals and lowers cost of capital.",
    pedagogy: "Relational governance, reputation as strategic asset, trust in repeated games.",
    deps: [], implemented: true,
  },
];

export const moduleMeta = (id: ModuleId): ModuleMeta | undefined => MODULE_REGISTRY.find((m) => m.id === id);

/** A named instructor preset: a one-line description plus the module set it turns on. */
export interface Preset {
  id: string;
  name: string;
  description: string;
  audience: string;
  modules: ModuleId[];
}

/** Preset library (spec §3). Deferred modules (A01 communication, A10 scenario
 *  planning) and Tier C are excluded; presets list only Tier A/B ids. */
export const PRESETS: Preset[] = [
  { id: "base", name: "Strategy core", description: "The v1 base game — fundamentals only, nothing added.", audience: "Any capstone", modules: [] },
  { id: "org", name: "Org & stakeholders", description: "Collective action, resilience, asymmetric starts, talent, team roles, reputation.", audience: "OB / HR / stakeholder management", modules: ["publicGoods", "sustainability", "asymmetricStarts", "laborMarket", "teamRoles", "reputation"] },
  { id: "finance", name: "Financial strategy", description: "Contracting flexibility, M&A, financing instruments, inventory, reputation.", audience: "Finance / corporate finance", modules: ["contingentContracts", "renegotiation", "ma", "financialInstruments", "inventory", "reputation"] },
  { id: "marketing", name: "Market dynamics", description: "PR events, asymmetric starts, consumer drift, R&D races.", audience: "Marketing strategy", modules: ["prEvents", "asymmetricStarts", "consumerDrift", "rndRace"] },
  { id: "global", name: "International strategy", description: "Sustainability, asymmetric starts, geographic + international expansion.", audience: "International business", modules: ["sustainability", "asymmetricStarts", "geography", "international"] },
  { id: "industrial-org", name: "Industry dynamics", description: "Public goods, drift, lobbying, R&D, vertical integration, M&A, reputation.", audience: "Industrial organization / strategy research", modules: ["publicGoods", "asymmetricStarts", "consumerDrift", "lobbying", "rndRace", "verticalIntegration", "ma", "reputation"] },
  { id: "full", name: "Everything (Pro)", description: "Every Tier A + Tier B module enabled — advanced multi-week tournament.", audience: "Advanced capstone", modules: MODULE_REGISTRY.map((m) => m.id) },
];

export const presetById = (id: string): Preset | undefined => PRESETS.find((p) => p.id === id);

/** Is a module turned on for this config? Safe on legacy configs (no `modules`). */
export function moduleEnabled(c: Config, id: ModuleId): boolean {
  return !!c.modules?.[id]?.enabled;
}

/** Inventory (MOD-B09) is on. Falls back to the pre-relocation top-level
 *  `inventory` block so an in-flight local game still reads correctly. */
export function inventoryEnabled(c: Config): boolean {
  return !!(c.modules?.inventory?.enabled ?? (c as { inventory?: { enabled?: boolean } }).inventory?.enabled);
}

/** Build a config override that enables a set of modules by id (for a preset or a
 *  custom selection). Only `enabled: true` is set; per-module params keep their
 *  defaults. Enabling a not-yet-implemented module is a harmless no-op flag. */
export function modulesOverride(ids: ModuleId[]): ConfigOverride {
  const modules: Record<string, { enabled: boolean }> = {};
  for (const id of ids) modules[id] = { enabled: true };
  return { modules } as unknown as ConfigOverride;
}
