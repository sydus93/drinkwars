/**
 * Scripted strategy archetypes for the balance harness (§16 validation workflow).
 * Each is a deterministic decision rule — distinct, internally coherent strategies
 * that exercise different corners of the model so pathologies surface. They are
 * intentionally simple (no foresight, no belief updating); the point is to stress
 * the engine, not to play optimally.
 */
import type { Config, FirmDecision, FirmState, SegmentId, WorldState } from "../src/types.js";
import { invCfg } from "../src/engine/inventory.js";

export type ArchetypeId =
  | "balanced"
  | "cost_leader"
  | "differentiator"
  | "brand_builder"
  | "stakeholder"
  | "aggressive"
  | "conservative"
  | "niche_specialist"
  | "cartel_member"
  | "defector";

interface Profile {
  focus: Partial<Record<SegmentId, number>>; // presence weights by segment
  markup: number | Partial<Record<SegmentId, number>>;
  invest: { cap?: number; process?: number; Q?: number; B?: number; T_emp?: number; T_inv?: number; T_gov?: number };
  debt_draw?: number;
  debt_repay?: number;
  cash_guard?: number; // max fraction of cash to commit to discretionary spend
  run_rate?: number; // production as a fraction of capacity (inventory mode); default 0.9
  // Expansion-module postures (each only acts when its module is enabled).
  modules?: {
    pr?: "festival" | "collab" | "viral";
    water?: number; // per-round water-efficiency spend
    goods?: Record<string, number>; // public-good contributions
    rnd?: number; // R&D spend while the frontier is closed
    region?: string; // market to expand into (weight 0.3 once affordable)
    vertical?: "upstream" | "downstream";
    hire?: string; // key role to staff
  };
}

function estUnitCost(f: FirmState, c: Config): number {
  return f.unit_cost > 0 ? f.unit_cost : c.costs.c_base * 0.85;
}
function maintenanceCapex(f: FirmState, c: Config): number {
  return (c.capacity.depreciation * f.cap) / Math.max(c.capacity.gain, 1e-6);
}

function mkDecision(f: FirmState, world: WorldState, c: Config, p: Profile): FirmDecision {
  const activeSegs = world.segments.filter((s) => s.active).map((s) => s.id);
  const allSegs = world.segments.map((s) => s.id);
  const unit = estUnitCost(f, c);

  // Presence: restrict the profile's focus to active segments; fall back to even.
  const focusActive = activeSegs.filter((s) => (p.focus[s] ?? 0) > 0);
  const presence: Record<SegmentId, number> = {};
  const price: Record<SegmentId, number> = {};
  for (const s of allSegs) {
    presence[s] = 0;
    price[s] = 0;
  }
  const targets = focusActive.length ? focusActive : activeSegs;
  for (const s of targets) {
    presence[s] = focusActive.length ? (p.focus[s] ?? 0) : 1;
    const mk = typeof p.markup === "number" ? p.markup : p.markup[s] ?? 1.5;
    price[s] = unit * mk;
  }

  // Discretionary spend with a solvency guard so archetypes don't insta-bankrupt.
  const capInvest = (p.invest.cap ?? 0) + maintenanceCapex(f, c);
  let spend = {
    cap: capInvest,
    process: p.invest.process ?? 0,
    Q: p.invest.Q ?? 0,
    B: p.invest.B ?? 0,
    T_emp: p.invest.T_emp ?? 0,
    T_inv: p.invest.T_inv ?? 0,
    T_gov: p.invest.T_gov ?? 0,
  };
  // Expansion-module plays from the profile's posture. Each is gated on its module,
  // an absolute cash check, AND a shared per-round module budget (~⅓ of cash) so a
  // posture with many plays staggers them over rounds instead of stacking them all
  // into one round and bleeding out.
  const mods = c.modules;
  const mp = p.modules ?? {};
  let moduleCash = 0;
  let moduleBudget = 0.35 * Math.max(0, f.cash);
  const commit = (cost: number): boolean => {
    if (cost > moduleBudget) return false;
    moduleBudget -= cost;
    moduleCash += cost;
    return true;
  };
  // Cheap recurring plays first; big one-time purchases compete for what's left.
  const rndInvest = mods?.rndRace?.enabled && mp.rnd && world.segments.some((s) => !s.active) && f.cash > 300 && commit(mp.rnd) ? mp.rnd : 0;
  const waterInvest = mods?.sustainability?.enabled && mp.water && f.cash > 500 && commit(mp.water) ? mp.water : 0;
  const goodsTotal = Object.values(mp.goods ?? {}).reduce((a, b) => a + b, 0);
  const contributions = mods?.publicGoods?.enabled && mp.goods && f.cash > 600 && commit(goodsTotal) ? mp.goods : {};
  let prAction: "festival" | "collab" | "viral" | null = null;
  if (mods?.prEvents?.enabled && mp.pr && (f.pr_cooldown_until == null || world.round >= f.pr_cooldown_until) && f.cash > mods.prEvents.cost * 3 && commit(mods.prEvents.cost)) {
    prAction = mp.pr;
  }
  const hireRoles: string[] = [];
  if (mods?.laborMarket?.enabled && mp.hire && f.cash > 700 && !(f.key_hires ?? []).some((h) => h.role === mp.hire)) {
    const role = mods.laborMarket.roles.find((r) => r.id === mp.hire);
    if (role && commit(role.signing_bonus + role.salary)) hireRoles.push(role.id);
  }
  let marketPresence: Record<string, number> | undefined;
  if (mods?.geography?.enabled && mp.region && world.round >= 2) {
    const target = mods.geography.markets.find((m) => m.id === mp.region && (m.kind !== "export" || mods.international?.enabled));
    if (target && f.cash > target.entry_cost + 900) {
      const entered = (f.markets_entered ?? ["home"]).includes(target.id);
      if (entered || commit(target.entry_cost)) marketPresence = { home: 0.7, [target.id]: 0.3 };
    }
  }
  const buyVertical: string[] = [];
  if (mods?.verticalIntegration?.enabled && mp.vertical && (f.vertical_assets ?? []).length < mods.verticalIntegration.max_assets) {
    const ownedIds = new Set((f.vertical_assets ?? []).map((a) => a.id));
    const asset = mods.verticalIntegration.assets.find((a) => a.type === mp.vertical && !ownedIds.has(a.id));
    if (asset && f.cash > asset.cost + 800 && commit(asset.cost)) buyVertical.push(asset.id);
  }

  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  // Reserve the up-front brewing bill (inventory mode) before discretionary spend.
  const runRate = p.run_rate ?? 0.9;
  const prodReserve = (invCfg(c).enabled ? runRate * Math.max(0, f.cap) * unit : 0);
  const budget = Math.max(0, Math.max(0, f.cash) * (p.cash_guard ?? 0.35) - prodReserve - moduleCash) + (p.debt_draw ?? 0);
  if (total > budget && total > 0) {
    const scale = budget / total;
    spend = Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, v * scale])) as typeof spend;
  }

  return {
    firm_id: f.id,
    price,
    presence,
    run_rate: p.run_rate ?? 0.9,
    pr_action: prAction,
    invest_water_efficiency: waterInvest,
    public_good_contributions: contributions,
    invest_rnd: rndInvest,
    market_presence: marketPresence,
    buy_vertical: buyVertical,
    hire_roles: hireRoles,
    invest_cap: spend.cap,
    invest_process: spend.process,
    invest_Q: spend.Q,
    invest_B: spend.B,
    invest_T_emp: spend.T_emp,
    invest_T_inv: spend.T_inv,
    invest_T_gov: spend.T_gov,
    debt_draw: p.debt_draw ?? 0,
    debt_repay: p.debt_repay ?? 0,
    equity_raise: 0,
    dividend: 0,
    buy_info: false,
    agreement_actions: [],
    exit_action: null,
  };
}

const PROFILES: Record<ArchetypeId, Profile> = {
  balanced: { focus: { mass: 1, niche: 1, frontier: 1 }, markup: { mass: 1.8, niche: 2.1, frontier: 2.0 }, invest: { Q: 30, B: 30, process: 25, T_emp: 15, T_inv: 10, T_gov: 10 }, modules: { goods: { regional_marketing: 10 }, hire: "head_brewer" } },
  cost_leader: { focus: { mass: 1 }, markup: 1.5, invest: { cap: 40, process: 70, T_emp: 20 }, cash_guard: 0.5, run_rate: 1.0, modules: { vertical: "upstream", region: "heartland", hire: "ops_manager" } },
  differentiator: { focus: { niche: 1, frontier: 1 }, markup: 2.2, invest: { Q: 70, B: 40, T_emp: 10 }, run_rate: 0.8, modules: { rnd: 50, pr: "collab", region: "coastal", hire: "head_brewer" } },
  brand_builder: { focus: { mass: 1, niche: 1, frontier: 1 }, markup: 1.9, invest: { B: 80, Q: 20, T_emp: 10 }, modules: { pr: "viral", hire: "sales_director" } },
  stakeholder: { focus: { mass: 1, niche: 1 }, markup: 1.8, invest: { T_emp: 40, T_inv: 30, T_gov: 30, process: 30 }, modules: { water: 30, goods: { regional_marketing: 10, water_commons: 15 }, vertical: "downstream" } },
  aggressive: { focus: { mass: 1, niche: 1 }, markup: 1.6, invest: { cap: 90, Q: 25, B: 25 }, debt_draw: 150, cash_guard: 0.6, run_rate: 1.0, modules: { region: "export_asia", vertical: "upstream" } },
  conservative: { focus: { mass: 1 }, markup: 1.9, invest: { Q: 15, B: 15 }, debt_repay: 30, cash_guard: 0.2, run_rate: 0.75, modules: { water: 30 } },
  niche_specialist: { focus: { niche: 1, frontier: 1 }, markup: 2.4, invest: { Q: 90, B: 40 }, run_rate: 0.75, modules: { rnd: 60, region: "coastal" } },
  cartel_member: { focus: { mass: 1, niche: 1 }, markup: 2.0, invest: { Q: 40, B: 40, T_gov: 60 }, modules: { goods: { regional_marketing: 20 }, vertical: "downstream" } },
  defector: { focus: { mass: 1, niche: 1 }, markup: 1.7, invest: { Q: 50, B: 50 }, modules: { pr: "festival" } },
};

export function decideFor(archetype: ArchetypeId, f: FirmState, world: WorldState, c: Config): FirmDecision {
  return mkDecision(f, world, c, PROFILES[archetype]);
}

/** The default 8-firm baseline assignment used by the balance run. */
export const BASELINE_ASSIGNMENT: ArchetypeId[] = [
  "balanced",
  "cost_leader",
  "differentiator",
  "brand_builder",
  "stakeholder",
  "aggressive",
  "conservative",
  "niche_specialist",
];

/** Build a decision provider mapping firm index → archetype. */
export function makeProvider(assignment: ArchetypeId[]) {
  return (world: WorldState, c: Config): FirmDecision[] => {
    const out: FirmDecision[] = [];
    world.firms.forEach((f, i) => {
      if (f.status !== "active") return;
      const arch = assignment[i % assignment.length];
      out.push(decideFor(arch, f, world, c));
    });
    return out;
  };
}
