/**
 * Coopetition layer (§11). A fixed menu of templates (joint-marketing pact,
 * capacity-coordination pact, supply/infrastructure share) held under three
 * governance forms (relational, formal, collective). The pedagogically
 * interesting variation is the governance form, not the terms (§11). v1 has no
 * negotiation: the firm taking the `form` action pays the formation cost and the
 * named counterparties are bound (§11.3 simplification).
 *
 * Each template resolves as a modifier on the demand and/or cost engine plus a
 * trust effect; capacity-coordination and collective forms feed the antitrust
 * coordination signal (§9.3, §11.4).
 */
import type { AgreementState, Config, FirmDecision, FirmId, SegmentId, WorldState } from "../types.js";

export interface AgreementResolution {
  events: string[];
  trustHits: Map<FirmId, { emp: number; inv: number }>; // direct stock reductions from defection
  extraOpex: Map<FirmId, number>; // formation + breach costs hitting this round's P&L
}

function addTrustHit(m: Map<FirmId, { emp: number; inv: number }>, id: FirmId, emp: number, inv: number): void {
  const cur = m.get(id) ?? { emp: 0, inv: 0 };
  cur.emp += emp;
  cur.inv += inv;
  m.set(id, cur);
}
function addOpex(m: Map<FirmId, number>, id: FirmId, amt: number): void {
  m.set(id, (m.get(id) ?? 0) + amt);
}

/** Process form/defect actions in firm order; mutate the agreements registry. */
export function resolveAgreementActions(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): AgreementResolution {
  const res: AgreementResolution = { events: [], trustHits: new Map(), extraOpex: new Map() };
  let seq = world.agreements.length;
  const activeIds = new Set(world.firms.filter((f) => f.status === "active").map((f) => f.id));

  for (const f of world.firms) {
    if (f.status !== "active") continue;
    const d = decisions.get(f.id);
    if (!d?.agreement_actions?.length) continue;

    for (const a of d.agreement_actions) {
      if (a.type === "form" && a.form && a.template) {
        const counterparties = (a.counterparties ?? []).filter((id) => activeIds.has(id) && id !== f.id);
        const signatories = [f.id, ...counterparties];
        if (a.form === "collective" && signatories.length < c.coopetition.forms.collective.min_size) {
          res.events.push(`${f.id} collective pact rejected (needs ≥${c.coopetition.forms.collective.min_size} firms)`);
          continue;
        }
        if (signatories.length < 2) continue;
        const formationCost = c.coopetition.forms[a.form].formation_cost;
        addOpex(res.extraOpex, f.id, formationCost);
        const agreement: AgreementState = {
          id: `a_${round}_${seq++}`,
          form: a.form,
          template: a.template,
          signatories,
          segment: a.template === "joint_marketing" ? a.segment ?? null : null,
          formation_round: round,
          active: true,
          dissolution_round: null,
          dissolution_type: null,
          constrained_until_round: null,
        };
        world.agreements.push(agreement);
        res.events.push(`${signatories.join("+")} formed ${a.form} ${a.template}`);
      } else if (a.type === "defect" && a.agreement_id) {
        const ag = world.agreements.find((x) => x.id === a.agreement_id && x.active);
        if (!ag || !ag.signatories.includes(f.id)) continue;
        ag.active = false;
        ag.dissolution_round = round;
        ag.dissolution_type = "defection";
        if (ag.form === "formal") {
          addOpex(res.extraOpex, f.id, c.coopetition.forms.formal.breach_penalty);
        } else {
          // Relational and collective defection burns trust (and counterparties' goodwill).
          addTrustHit(res.trustHits, f.id, c.coopetition.forms.relational.defect_trust_cost_emp, c.coopetition.forms.relational.defect_trust_cost_inv);
        }
        res.events.push(`${f.id} defected from ${ag.form} ${ag.template} (${ag.id})`);
      }
    }
  }
  return res;
}

export interface AgreementEffects {
  extraBrand: Map<FirmId, Map<SegmentId, number>>;
  unitCostReduction: Map<FirmId, number>;
  capacityRestraint: Map<FirmId, number>;
  coordinationUnits: number; // capacity-coordination pacts + collective arrangements
}

/** Compute this round's demand/cost effects from active, unconstrained agreements. */
export function computeAgreementEffects(world: WorldState, c: Config, round: number): AgreementEffects {
  const eff: AgreementEffects = { extraBrand: new Map(), unitCostReduction: new Map(), capacityRestraint: new Map(), coordinationUnits: 0 };
  const bById = new Map(world.firms.map((f) => [f.id, f]));

  for (const ag of world.agreements) {
    if (!ag.active) continue;
    const suspended = ag.constrained_until_round !== null && round < ag.constrained_until_round;
    const live = ag.signatories.filter((id) => bById.get(id)?.status === "active");
    if (live.length < 2) continue;

    // Coordination signal counts even while constrained (it's the visible behavior).
    if (ag.template === "capacity_coordination" || ag.form === "collective") eff.coordinationUnits += 1;
    if (suspended) continue;

    if (ag.template === "joint_marketing" && ag.segment) {
      const seg = ag.segment;
      const frac = c.coopetition.templates.joint_marketing.brand_pool_fraction;
      for (const i of live) {
        const others = live.filter((j) => j !== i).reduce((acc, j) => acc + (bById.get(j)?.B ?? 0), 0);
        const m = eff.extraBrand.get(i) ?? new Map<SegmentId, number>();
        m.set(seg, (m.get(seg) ?? 0) + frac * others);
        eff.extraBrand.set(i, m);
      }
    } else if (ag.template === "supply_share") {
      const r = c.coopetition.templates.supply_share.unit_cost_reduction;
      for (const i of live) eff.unitCostReduction.set(i, (eff.unitCostReduction.get(i) ?? 0) + r);
    } else if (ag.template === "capacity_coordination") {
      const restraint = c.coopetition.templates.capacity_coordination.capacity_restraint;
      for (const i of live) eff.capacityRestraint.set(i, Math.max(eff.capacityRestraint.get(i) ?? 0, restraint));
    }
  }
  return eff;
}
