/**
 * Coopetition layer (§11). A fixed menu of templates (joint-marketing pact,
 * capacity-coordination pact, supply/infrastructure share) held under three
 * governance forms (relational, formal, collective). The pedagogically
 * interesting variation is the governance form, not the terms (§11).
 *
 * MUTUAL CONSENT (supersedes the §11.3 v1 "counterparties are bound" simplification,
 * per live playtest feedback): a `form` action now creates a PENDING PROPOSAL. Every
 * named counterparty must `accept_proposal` (usually the following round) before the
 * pact binds; any `decline_proposal` kills it; unanswered proposals expire after
 * PROPOSAL_TTL_ROUNDS. The proposer pays the formation cost at ACTIVATION, not at
 * proposal — declined or expired overtures cost nothing. An identical proposal or an
 * identical active pact (same template + segment + signatory set) dedupes, so a client
 * that re-sends a form action can never stack duplicate pacts.
 *
 * Each template resolves as a modifier on the demand and/or cost engine plus a
 * trust effect; capacity-coordination and collective forms feed the antitrust
 * coordination signal (§9.3, §11.4).
 */
import type { AgreementState, AgreementTerms, ClauseCondition, Config, FirmDecision, FirmId, PendingAgreement, SegmentId, TemplateId, WorldState } from "../types.js";

/** Rounds a proposal stays open awaiting acceptance before it lapses. */
export const PROPOSAL_TTL_ROUNDS = 2;

/** Negotiable range of each template's economic dial (DW-037). The config default sits
 *  inside these; the UI offers the same range so engine and client agree on bounds. */
export const TERM_BOUNDS: Record<TemplateId, { min: number; max: number }> = {
  joint_marketing: { min: 0.05, max: 0.6 }, // brand_pool_fraction
  capacity_coordination: { min: 0.05, max: 0.4 }, // capacity_restraint
  supply_share: { min: 0.02, max: 0.2 }, // unit_cost_reduction
};

/** Sanitize proposed terms: clamp the dial to its template range, durations to 2..24
 *  rounds, cost split to 0..1. Returns undefined when nothing meaningful was proposed. */
export function clampTerms(template: TemplateId, terms: AgreementTerms | undefined): AgreementTerms | undefined {
  if (!terms) return undefined;
  const out: AgreementTerms = {};
  if (typeof terms.magnitude === "number" && Number.isFinite(terms.magnitude)) {
    const b = TERM_BOUNDS[template];
    out.magnitude = Math.min(b.max, Math.max(b.min, terms.magnitude));
  }
  if (terms.duration_rounds === null) out.duration_rounds = null;
  else if (typeof terms.duration_rounds === "number" && Number.isFinite(terms.duration_rounds)) out.duration_rounds = Math.min(24, Math.max(2, Math.round(terms.duration_rounds)));
  if (typeof terms.cost_split === "number" && Number.isFinite(terms.cost_split)) out.cost_split = Math.min(1, Math.max(0, terms.cost_split));
  return Object.keys(out).length ? out : undefined;
}

/** Identity key for dedupe: a pact/proposal is "the same deal" if template, segment,
 *  and the full signatory set match (governance form intentionally excluded — the same
 *  deal under a different form is still the same deal on the table). */
const dealKey = (template: string, segment: string | null, signatories: FirmId[]): string =>
  `${template}::${segment ?? ""}::${[...signatories].sort().join("+")}`;

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

/** Process form/accept/decline/defect actions in firm order; mutate the agreements
 *  registry + the pending-proposal list. */
export function resolveAgreementActions(world: WorldState, decisions: Map<FirmId, FirmDecision>, c: Config, round: number): AgreementResolution {
  const res: AgreementResolution = { events: [], trustHits: new Map(), extraOpex: new Map() };
  let seq = world.agreements.length;
  const activeIds = new Set(world.firms.filter((f) => f.status === "active").map((f) => f.id));
  const pendings = (world.pending_agreements ??= []);
  let pseq = pendings.length;

  // The same deal can't be proposed or formed twice (client re-sends are harmless).
  const activeKeys = new Set(world.agreements.filter((x) => x.active).map((x) => dealKey(x.template, x.segment, x.signatories)));
  const pendingKeys = new Set(pendings.map((p) => dealKey(p.template, p.segment, [p.proposer, ...p.counterparties])));

  /** All counterparties in — bind the pact. The formation cost lands NOW, split by the
   *  negotiated cost_split (absent ⇒ the proposer pays it all, the pre-terms behavior). */
  const activate = (p: PendingAgreement): void => {
    const agreement: AgreementState = {
      id: `a_${round}_${seq++}`,
      form: p.form,
      template: p.template,
      signatories: [p.proposer, ...p.counterparties],
      segment: p.segment,
      terms: p.terms,
      formation_round: round,
      active: true,
      dissolution_round: null,
      dissolution_type: null,
      constrained_until_round: null,
    };
    const ccfg = c.modules?.contingentContracts;
    if (ccfg?.enabled && p.clauses?.length && (p.form === "formal" || p.form === "collective")) {
      agreement.clauses = p.clauses.slice(0, ccfg.max_clauses_per_agreement).map((cl) => ({ condition: cl.condition, action: cl.action, fired_round: null }));
    }
    world.agreements.push(agreement);
    activeKeys.add(dealKey(agreement.template, agreement.segment, agreement.signatories));
    const cost = c.coopetition.forms[p.form].formation_cost;
    const split = p.terms?.cost_split ?? 1;
    addOpex(res.extraOpex, p.proposer, cost * split);
    for (const id of p.counterparties) addOpex(res.extraOpex, id, (cost * (1 - split)) / p.counterparties.length);
    res.events.push(`${agreement.signatories.join("+")} formed ${p.form} ${p.template}${agreement.clauses?.length ? ` with ${agreement.clauses.length} contingent clause(s)` : ""}${p.terms?.duration_rounds ? ` (${p.terms.duration_rounds}-round term)` : ""}`);
  };

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
        // Dedupe: the same deal already in force or already on the table ⇒ no new proposal.
        const key = dealKey(a.template, a.template === "joint_marketing" ? a.segment ?? null : null, signatories);
        if (activeKeys.has(key) || pendingKeys.has(key)) continue;
        pendingKeys.add(key);
        const proposal: PendingAgreement = {
          id: `p_${round}_${pseq++}`,
          form: a.form,
          template: a.template,
          proposer: f.id,
          counterparties,
          segment: a.template === "joint_marketing" ? a.segment ?? null : null,
          clauses: a.clauses,
          terms: clampTerms(a.template, a.terms),
          proposed_round: round,
          accepted: [],
        };
        pendings.push(proposal);
        res.events.push(`${f.id} proposes a ${a.form} ${a.template} to ${counterparties.join("+")} — awaiting their agreement`);
      } else if (a.type === "counter_proposal" && a.proposal_id) {
        // A counterparty answers with revised terms instead of yes/no: roles swap — they
        // become the proposer and the original proposer must now accept. Two-party only
        // (a multiparty counter would need everyone to re-consent to a moving target).
        const p = pendings.find((x) => x.id === a.proposal_id);
        if (!p || !p.counterparties.includes(f.id) || p.counterparties.length > 1) continue;
        const original = p.proposer;
        p.proposer = f.id;
        p.counterparties = [original];
        p.accepted = [];
        p.terms = clampTerms(p.template, a.terms) ?? p.terms;
        if (p.template === "joint_marketing" && a.segment) p.segment = a.segment;
        p.proposed_round = round; // the counter restarts the response window
        p.counters = (p.counters ?? 0) + 1;
        res.events.push(`${f.id} counters ${original}'s ${p.form} ${p.template} proposal with revised terms — now in ${original}'s court`);
      } else if ((a.type === "accept_proposal" || a.type === "decline_proposal") && a.proposal_id) {
        const p = pendings.find((x) => x.id === a.proposal_id);
        if (!p || !p.counterparties.includes(f.id)) continue; // only a named counterparty answers
        if (a.type === "decline_proposal") {
          pendings.splice(pendings.indexOf(p), 1);
          pendingKeys.delete(dealKey(p.template, p.segment, [p.proposer, ...p.counterparties]));
          res.events.push(`${f.id} declines ${p.proposer}'s ${p.form} ${p.template} proposal`);
        } else if (!p.accepted.includes(f.id)) {
          p.accepted.push(f.id);
          if (p.counterparties.every((id) => p.accepted.includes(id))) {
            pendings.splice(pendings.indexOf(p), 1);
            activate(p);
          } else {
            res.events.push(`${f.id} accepts ${p.proposer}'s ${p.form} ${p.template} proposal — awaiting the remaining partner(s)`);
          }
        }
      } else if (a.type === "renegotiate" && a.agreement_id) {
        // MOD-A06: call to renegotiate — pay the call cost, open the call, propose terms.
        const rcfg = c.modules?.renegotiation;
        if (!rcfg?.enabled) continue;
        const ag = world.agreements.find((x) => x.id === a.agreement_id && x.active);
        if (!ag || !ag.signatories.includes(f.id)) continue;
        if (ag.renegotiation || ag.renegotiation_used) continue; // one open call, once per lifetime
        ag.renegotiation = { caller: f.id, called_round: round, proposed_template: a.proposed_template, proposed_segment: a.proposed_segment, proposed_terms: clampTerms(a.proposed_template ?? ag.template, a.proposed_terms) };
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
          if (ag.renegotiation.proposed_terms) ag.terms = { ...ag.terms, ...ag.renegotiation.proposed_terms };
          // Switching TO joint_marketing needs a category to pool brand in — if none was
          // proposed and the pact never had one, default to the first active segment
          // (a null segment would silently make the pact do nothing).
          if (ag.template === "joint_marketing" && !ag.segment) ag.segment = world.segments.find((s) => s.active)?.id ?? null;
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

  // Negotiated sunsets: a pact with a duration term winds down cleanly once it runs out
  // (formed round r with an n-round term ⇒ effective rounds r .. r+n-1).
  for (const ag of world.agreements) {
    const dur = ag.terms?.duration_rounds;
    if (!ag.active || dur == null) continue;
    if (round - ag.formation_round >= dur) {
      ag.active = false;
      ag.dissolution_round = round;
      ag.dissolution_type = "mutual";
      res.events.push(`${ag.form} ${ag.template} (${ag.id}) reached its negotiated ${dur}-round term and wound down`);
    }
  }

  // Sweep the proposal list AFTER responses: overtures lapse once their response window
  // (PROPOSAL_TTL_ROUNDS) passes, and any proposal touching an exited firm is void.
  for (let i = pendings.length - 1; i >= 0; i--) {
    const p = pendings[i];
    const dead = !activeIds.has(p.proposer) || p.counterparties.some((id) => !activeIds.has(id));
    const lapsed = round - p.proposed_round >= PROPOSAL_TTL_ROUNDS;
    if (dead || lapsed) {
      pendings.splice(i, 1);
      if (lapsed && !dead) res.events.push(`${p.proposer}'s ${p.form} ${p.template} proposal to ${p.counterparties.join("+")} lapsed unanswered`);
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

    // Negotiated magnitude wins; absent terms fall back to the config template constant.
    if (ag.template === "joint_marketing" && ag.segment) {
      const seg = ag.segment;
      const frac = ag.terms?.magnitude ?? c.coopetition.templates.joint_marketing.brand_pool_fraction;
      for (const i of live) {
        const others = live.filter((j) => j !== i).reduce((acc, j) => acc + (bById.get(j)?.B ?? 0), 0);
        const m = eff.extraBrand.get(i) ?? new Map<SegmentId, number>();
        m.set(seg, (m.get(seg) ?? 0) + frac * others);
        eff.extraBrand.set(i, m);
      }
    } else if (ag.template === "supply_share") {
      const r = ag.terms?.magnitude ?? c.coopetition.templates.supply_share.unit_cost_reduction;
      for (const i of live) eff.unitCostReduction.set(i, (eff.unitCostReduction.get(i) ?? 0) + r);
    } else if (ag.template === "capacity_coordination") {
      const restraint = ag.terms?.magnitude ?? c.coopetition.templates.capacity_coordination.capacity_restraint;
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
