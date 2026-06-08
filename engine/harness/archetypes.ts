/**
 * Scripted strategy archetypes for the balance harness (§16 validation workflow).
 * Each is a deterministic decision rule — distinct, internally coherent strategies
 * that exercise different corners of the model so pathologies surface. They are
 * intentionally simple (no foresight, no belief updating); the point is to stress
 * the engine, not to play optimally.
 */
import type { Config, FirmDecision, FirmState, SegmentId, WorldState } from "../src/types.js";

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
  const total = Object.values(spend).reduce((a, b) => a + b, 0);
  const budget = Math.max(0, f.cash) * (p.cash_guard ?? 0.35) + (p.debt_draw ?? 0);
  if (total > budget && total > 0) {
    const scale = budget / total;
    spend = Object.fromEntries(Object.entries(spend).map(([k, v]) => [k, v * scale])) as typeof spend;
  }

  return {
    firm_id: f.id,
    price,
    presence,
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
  balanced: { focus: { mass: 1, niche: 1, frontier: 1 }, markup: { mass: 1.8, niche: 2.1, frontier: 2.0 }, invest: { Q: 30, B: 30, process: 25, T_emp: 15, T_inv: 10, T_gov: 10 } },
  cost_leader: { focus: { mass: 1 }, markup: 1.5, invest: { cap: 40, process: 70, T_emp: 20 }, cash_guard: 0.5 },
  differentiator: { focus: { niche: 1, frontier: 1 }, markup: 2.2, invest: { Q: 70, B: 40, T_emp: 10 } },
  brand_builder: { focus: { mass: 1, niche: 1, frontier: 1 }, markup: 1.9, invest: { B: 80, Q: 20, T_emp: 10 } },
  stakeholder: { focus: { mass: 1, niche: 1 }, markup: 1.8, invest: { T_emp: 40, T_inv: 30, T_gov: 30, process: 30 } },
  aggressive: { focus: { mass: 1, niche: 1 }, markup: 1.6, invest: { cap: 90, Q: 25, B: 25 }, debt_draw: 150, cash_guard: 0.6 },
  conservative: { focus: { mass: 1 }, markup: 1.9, invest: { Q: 15, B: 15 }, debt_repay: 30, cash_guard: 0.2 },
  niche_specialist: { focus: { niche: 1, frontier: 1 }, markup: 2.4, invest: { Q: 90, B: 40 } },
  cartel_member: { focus: { mass: 1, niche: 1 }, markup: 2.0, invest: { Q: 40, B: 40, T_gov: 60 } },
  defector: { focus: { mass: 1, niche: 1 }, markup: 1.7, invest: { Q: 50, B: 50 } },
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
