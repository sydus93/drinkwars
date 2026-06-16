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
import type { AgreementState, ClauseCondition, Config, FirmDecision, FirmId, SegmentId, WorldState } from "../types.js";

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
        // MOD-A05: attach contingent clauses (formal/collective contracts only).
        const ccfg = c.modules?.contingentContracts;
        if (ccfg?.enabled && a.clauses?.length && (a.form === "formal" || a.form === "collective")) {
          agreement.clauses = a.clauses
            .slice(0, ccfg.max_clauses_per_agreement)
            .map((cl) => ({ condition: cl.condition, action: cl.action, fired_round: null }));
        }
        world.agreements.push(agreement);
        res.events.push(`${signatories.join("+")} formed ${a.form} ${a.template}${agreement.clauses?.length ? ` with ${agreement.clauses.length} contingent clause(s)` : ""}`);
      } else if (a.type === "renegotiate" && a.agreement_id) {
        // MOD-A06: call to renegotiate — pay the call cost, open the call, propose terms.
        const rcfg = c.modules?.renegotiation;
        if (!rcfg?.enabled) continue;
        const ag = world.agreements.find((x) => x.id === a.agreement_id && x.active);
        if (!ag || !ag.signatories.includes(f.id)) continue;
        if (ag.renegotiation || ag.renegotiation_used) continue; // one open call, once per lifetime
        ag.renegotiation = { caller: f.id, called_round: round, proposed_template: a.proposed_template, proposed_segment: a.proposed_segment };
        ag.renegotiation_used = true;
        addOpex(res.extraOpex, f.id, rcfg.call_cost);
        res.events.push(`${f.id} calls to renegotiate ${ag.form} ${ag.template} (${ag.id})`);
      } else if (a.type === "renegotiate_response" && a.agreement_id) {
        // MOD-A06: a counterparty answers an open call — accept / reject / exit.
        const rcfg = c.modules?.renegotiation;
        if (!rcfg?.enabled) continue;
        const ag = world.agreements.find((x) => x.id === a.agreement_id && x.active);
        if (!ag || !ag.renegotiation) continue;
        if (!ag.signatories.includes(f.id) || f.id === ag.renegotiation.caller) continue; // counterparty only
        const resp = a.response ?? "reject";
        if (resp === "accept") {
          if (ag.renegotiation.proposed_template) ag.template = ag.renegotiation.proposed_template;
          if (ag.renegotiation.proposed_segment !== undefined) ag.segment = ag.template === "joint_marketing" ? ag.renegotiation.proposed_segment ?? ag.segment : null;
          res.events.push(`${f.id} accepts new terms on ${ag.form} ${ag.template} (${ag.id})`);
        } else if (resp === "exit") {
          ag.active = false;
          ag.dissolution_round = round;
          ag.dissolution_type = "renegotiated";
          if (ag.form === "formal") addOpex(res.extraOpex, f.id, c.coopetition.forms.formal.breach_penalty * rcfg.exit_breach_fraction);
          res.events.push(`${f.id} exits ${ag.form} ${ag.template} via renegotiation (${ag.id})`);
        } else {
          res.events.push(`${f.id} rejects renegotiation of ${ag.form} ${ag.template} (${ag.id})`);
        }
        ag.renegotiation = null;
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

export interface ClauseResolution {
  events: string[];
}

/**
 * MOD-A05 · Evaluate contingent clauses on active agreements (§spec A05). Runs
 * after shocks resolve and before scoring, so a clause can react to this round's
 * shock / emergence / partner-distress. Each clause fires at most once. Because
 * this runs after `computeAgreementEffects`, a fired clause's effect (suspend /
 * terminate / open renegotiation) takes hold from the FOLLOWING round — the clause
 * triggers when the condition hits; the adaptation lands next round.
 */
export function resolveContingentClauses(
  world: WorldState,
  c: Config,
  round: number,
  activeShockTypes: Set<string>,
  emergedThisRound: Set<SegmentId>,
): ClauseResolution {
  const res: ClauseResolution = { events: [] };
  const ccfg = c.modules?.contingentContracts;
  if (!ccfg?.enabled) return res;
  const fById = new Map(world.firms.map((f) => [f.id, f]));

  const conditionMet = (cond: ClauseCondition, ag: AgreementState): boolean => {
    switch (cond) {
      case "water_shock": return activeShockTypes.has("water");
      case "harvest_shock": return activeShockTypes.has("harvest");
      case "capacity_shock": return activeShockTypes.has("co2");
      case "segment_emerges": return emergedThisRound.size > 0;
      case "partner_distress":
        return ag.signatories.some((id) => {
          const f = fById.get(id);
          return !!f && (f.status !== "active" || (f.rounds_below_health ?? 0) >= ccfg.distress_rounds);
        });
      default: return false;
    }
  };

  for (const ag of world.agreements) {
    if (!ag.active || !ag.clauses?.length) continue;
    for (const cl of ag.clauses) {
      if (cl.fired_round != null) continue; // each clause fires once
      if (!conditionMet(cl.condition, ag)) continue;
      cl.fired_round = round;
      const rcfg = c.modules?.renegotiation;
      if (cl.action === "suspend") {
        ag.constrained_until_round = Math.max(ag.constrained_until_round ?? 0, round + ccfg.suspend_rounds);
        res.events.push(`CLAUSE: ${ag.form} ${ag.template} (${ag.id}) auto-suspends — a contingent clause fired (${cl.condition})`);
      } else if (cl.action === "renegotiate" && rcfg?.enabled && !ag.renegotiation && !ag.renegotiation_used) {
        ag.renegotiation = { caller: ag.signatories[0], called_round: round, proposed_template: undefined, proposed_segment: undefined };
        ag.renegotiation_used = true;
        res.events.push(`CLAUSE: ${ag.form} ${ag.template} (${ag.id}) opens for renegotiation — a contingent clause fired (${cl.condition})`);
      } else {
        // "terminate" (and the renegotiate fallback when MOD-A06 is off): clean dissolution.
        ag.active = false;
        ag.dissolution_round = round;
        ag.dissolution_type = "clause";
        res.events.push(`CLAUSE: ${ag.form} ${ag.template} (${ag.id}) auto-terminates — a contingent clause fired (${cl.condition})`);
      }
    }
  }
  return res;
}
