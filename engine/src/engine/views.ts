/**
 * Presentation summaries for the coopetition (MOD-A05/A06) and lobbying (MOD-A09)
 * subsystems. These shape raw world/agreement state into the flat, serializable
 * objects the UI renders — kept here (one tested place) so the single-player
 * controller, the multiplayer transport, and the edge function all produce an
 * identical shape rather than each re-deriving it. Naming is injected (`nameOf`)
 * so the engine stays free of presentation strings.
 */
import type {
  ClauseAction, ClauseCondition, Config, FirmId, GovernanceForm, RegulationType, SegmentId, TemplateId, WorldState,
} from "../types.js";

export interface AllianceClauseSummary {
  condition: ClauseCondition;
  action: ClauseAction;
  fired: boolean;
}

export interface AllianceSummary {
  id: string;
  form: GovernanceForm;
  template: TemplateId;
  segment: SegmentId | null;
  signatories: { firm_id: FirmId; name: string; isYou: boolean }[];
  partnerNames: string[];
  active: boolean;
  suspendedUntil: number | null; // round the contingent/antitrust suspension lifts (null ⇒ not suspended)
  clauses: AllianceClauseSummary[];
  // An open renegotiation call awaiting this team's (or a partner's) response.
  reneg: { open: boolean; callerName: string; callerIsYou: boolean; proposedTemplate: TemplateId | null; proposedSegment: SegmentId | null } | null;
  renegUsed: boolean; // the one renegotiation per agreement lifetime has been spent
}

/** Active agreements this firm is party to, shaped for the Alliances panel. */
export function summarizeAgreementsFor(world: WorldState, youId: FirmId, nameOf: (id: FirmId) => string): AllianceSummary[] {
  return world.agreements
    .filter((a) => a.active && a.signatories.includes(youId))
    .map((a) => {
      const reneg = a.renegotiation;
      return {
        id: a.id,
        form: a.form,
        template: a.template,
        segment: a.segment,
        signatories: a.signatories.map((id) => ({ firm_id: id, name: nameOf(id), isYou: id === youId })),
        partnerNames: a.signatories.filter((id) => id !== youId).map((id) => nameOf(id)),
        active: a.active,
        suspendedUntil: a.constrained_until_round != null && world.round < a.constrained_until_round ? a.constrained_until_round : null,
        clauses: (a.clauses ?? []).map((cl) => ({ condition: cl.condition, action: cl.action, fired: cl.fired_round != null })),
        reneg: reneg
          ? { open: true, callerName: nameOf(reneg.caller), callerIsYou: reneg.caller === youId, proposedTemplate: reneg.proposed_template ?? null, proposedSegment: reneg.proposed_segment ?? null }
          : null,
        renegUsed: !!a.renegotiation_used,
      };
    });
}

export interface LobbySummary {
  id: string;
  label: string;
  regulation: RegulationType;
  progress: number;
  threshold: number;
  pct: number; // 0..1 progress toward firing
  fired: boolean;
}

/** Lobbying initiatives (config menu merged with live progress) for the panel. */
export function summarizeLobbying(c: Config, world: WorldState): LobbySummary[] {
  const cfg = c.modules?.lobbying;
  if (!cfg?.enabled) return [];
  const state = new Map((world.lobbying_initiatives ?? []).map((i) => [i.id, i]));
  return cfg.initiatives.map((ci) => {
    const st = state.get(ci.id);
    const progress = st?.progress ?? 0;
    return {
      id: ci.id, label: ci.label, regulation: ci.regulation,
      progress, threshold: ci.threshold,
      pct: ci.threshold > 0 ? Math.min(1, progress / ci.threshold) : 1,
      fired: !!st?.fired,
    };
  });
}
