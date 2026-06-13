/**
 * MOD-B06 · Vertical integration + MOD-B03 · Labor market.
 *
 * Vertical assets: a firm buys upstream (supplier → unit-cost reduction) or
 * downstream (distributor → regulatory-burden relief, antitrust exposure) assets.
 * The purchase is CAPITALIZED — cash swaps into PP&E via the capex channel — so
 * the §7.2 invariants hold; benefits come online after an integration lag and the
 * asset's book value depreciates with the rest of PP&E.
 *
 * Key hires: a firm hires named roles (head brewer, sales director, ops manager)
 * for a signing bonus + per-round salary; the role's stock bonus lands on hire and
 * is REMOVED if the person leaves. Departure risk each round falls with employee
 * trust (T_emp as retention). Deterministic RNG keeps replays clean.
 */
import type { Config, FirmDecision, FirmId, FirmState, WorldState } from "../types.js";
import { RNG, deriveSeed } from "../rng.js";

export interface AssetsOutcome {
  capexByFirm: Map<FirmId, number>; // vertical purchases (capitalized)
  opexByFirm: Map<FirmId, number>; // salaries + signing bonuses (expensed)
  antitrustUnits: number; // extra visible-coordination units from downstream assets
  events: string[];
}

/** Unit-cost reduction from integrated upstream assets (0 when off / not integrated). */
export function verticalCostReduction(f: FirmState, c: Config, round: number): number {
  const v = c.modules?.verticalIntegration;
  if (!v?.enabled) return 0;
  let r = 0;
  for (const a of f.vertical_assets ?? []) {
    const cfg = v.assets.find((x) => x.id === a.id);
    if (cfg && round >= a.acquired_round + cfg.integration_lag) r += cfg.unit_cost_reduction;
  }
  return Math.min(0.4, r);
}

/** Regulatory-burden relief from integrated downstream assets (0 when off). */
export function verticalRegRelief(f: FirmState, c: Config, round: number): number {
  const v = c.modules?.verticalIntegration;
  if (!v?.enabled) return 0;
  let r = 0;
  for (const a of f.vertical_assets ?? []) {
    const cfg = v.assets.find((x) => x.id === a.id);
    if (cfg && round >= a.acquired_round + cfg.integration_lag) r += cfg.reg_relief;
  }
  return Math.min(0.8, r);
}

export function resolveAssets(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): AssetsOutcome {
  const out: AssetsOutcome = { capexByFirm: new Map(), opexByFirm: new Map(), antitrustUnits: 0, events: [] };
  const v = c.modules?.verticalIntegration;
  const lab = c.modules?.laborMarket;
  const rng = new RNG(deriveSeed(world.seed, round, 167));

  for (const f of world.firms) {
    if (f.status !== "active") continue;
    f.vertical_assets ??= [];
    f.key_hires ??= [];
    const d = decisions.get(f.id);
    let opex = 0;

    // ---- Vertical purchases (MOD-B06) ----
    if (v?.enabled) {
      for (const id of d?.buy_vertical ?? []) {
        const cfg = v.assets.find((x) => x.id === id);
        const owned = f.vertical_assets.some((x) => x.id === id);
        if (!cfg || owned || f.vertical_assets.length >= v.max_assets) continue;
        if (f.cash < cfg.cost) continue; // can't finance the purchase this round
        f.vertical_assets.push({ id, acquired_round: round });
        out.capexByFirm.set(f.id, (out.capexByFirm.get(f.id) ?? 0) + cfg.cost);
        out.events.push(`ACQUISITION: ${f.id} buys ${cfg.label.toLowerCase()} (online in ${cfg.integration_lag} rounds)`);
      }
      // Downstream assets are visible vertical control — they feed antitrust exposure.
      for (const a of f.vertical_assets) {
        const cfg = v.assets.find((x) => x.id === a.id);
        if (cfg && round >= a.acquired_round + cfg.integration_lag) out.antitrustUnits += cfg.antitrust_units;
      }
    }

    // ---- Key hires (MOD-B03) ----
    if (lab?.enabled) {
      // Voluntary departures the firm initiates (lose the bonus, stop the salary).
      for (const roleId of d?.fire_roles ?? []) {
        const i = f.key_hires.findIndex((h) => h.role === roleId);
        if (i < 0) continue;
        const cfg = lab.roles.find((r) => r.id === roleId);
        f.key_hires.splice(i, 1);
        if (cfg) removeBonus(f, cfg.bonus);
      }
      // New hires: signing bonus now, salary every round, stock bonus lands now.
      for (const roleId of d?.hire_roles ?? []) {
        const cfg = lab.roles.find((r) => r.id === roleId);
        const already = f.key_hires.some((h) => h.role === roleId);
        if (!cfg || already) continue;
        if (f.cash < cfg.signing_bonus + cfg.salary) continue;
        f.key_hires.push({ role: roleId, hired_round: round });
        addBonus(f, cfg.bonus);
        opex += cfg.signing_bonus;
        out.events.push(`HIRE: ${f.id} brings on a ${cfg.label.toLowerCase()}`);
      }
      // Salaries + retention risk. T_emp blunts the chance your people get poached.
      const mit = lab.t_emp_mitigation * (f.T_emp / (f.T_emp + lab.t_emp_halfsat));
      const pLeave = lab.departure_prob * (1 - mit);
      for (let i = f.key_hires.length - 1; i >= 0; i--) {
        const h = f.key_hires[i];
        const cfg = lab.roles.find((r) => r.id === h.role);
        if (!cfg) continue;
        if (h.hired_round < round && rng.bool(pLeave)) {
          f.key_hires.splice(i, 1);
          removeBonus(f, cfg.bonus);
          out.events.push(`POACHED: ${f.id} loses its ${cfg.label.toLowerCase()} to a rival offer`);
          continue;
        }
        opex += cfg.salary;
      }
    }

    if (opex > 0) out.opexByFirm.set(f.id, opex);
  }
  return out;
}

function addBonus(f: FirmState, b: Partial<Record<"Q" | "B" | "process" | "T_emp", number>>): void {
  for (const [k, v] of Object.entries(b)) f[k as "Q"] += v ?? 0;
}
function removeBonus(f: FirmState, b: Partial<Record<"Q" | "B" | "process" | "T_emp", number>>): void {
  for (const [k, v] of Object.entries(b)) f[k as "Q"] = Math.max(0, f[k as "Q"] - (v ?? 0));
}
