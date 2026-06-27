/**
 * Presentation summaries for the coopetition (MOD-A05/A06) and lobbying (MOD-A09)
 * subsystems. These shape raw world/agreement state into the flat, serializable
 * objects the UI renders — kept here (one tested place) so the single-player
 * controller, the multiplayer transport, and the edge function all produce an
 * identical shape rather than each re-deriving it. Naming is injected (`nameOf`)
 * so the engine stays free of presentation strings.
 */
import type {
  ClauseAction, ClauseCondition, Config, FirmId, FirmRoundResult, FirmState, GovernanceForm, MarketKind, RegulationType, SegmentId, TemplateId, WorldState,
} from "../types.js";
import { activeMarkets } from "./geography.js";

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

// ───────────────────────── per-market ("city") view ─────────────────────────
export interface MarketSiteView { id: string; firmId: FirmId; name: string; type: string; location_id?: string; lot_id?: string; active: boolean }
export interface MarketSegStanding { id: SegmentId; size: number; leader: FirmId | null; leaderShare: number; yourShare: number }
export interface MarketLotView { id: string; x: number; y: number; district: string; unlocked: boolean; occupant: "you" | "rival" | null }
export interface MarketCityView {
  id: string; label: string; kind: MarketKind; entered: boolean; entryCost: number; fx: number;
  yourShare: number; segments: MarketSegStanding[]; yourSites: MarketSiteView[]; rivalSites: MarketSiteView[]; lots: MarketLotView[];
}

/**
 * The City View's per-market data for one firm — sites, rivals' public pins, lease lots,
 * and who leads each segment here. Gated identically to the engine via `activeMarkets`
 * (home + domestic always; exports only with international on + past the unlock round).
 * Includes only PUBLIC rival data (facility positions/types — what you'd see on a shared
 * map), never rivals' private stocks, so it's safe for the multiplayer per-team slice.
 * Used by BOTH the single-player controller and the multiplayer transport so solo and
 * multiplayer render the same City View. `lastFirmResults` (the last resolved round) drives
 * the per-segment standings + your market share; empty before round 1.
 */
export function projectMarkets(
  world: WorldState,
  c: Config,
  firmId: FirmId,
  round: number,
  lastFirmResults: FirmRoundResult[],
  nameOf: (id: FirmId) => string,
): MarketCityView[] {
  const geoMarkets = activeMarkets(c, round);
  const own = world.firms.find((f) => f.id === firmId);
  const ownEntered = new Set(own?.markets_entered ?? ["home"]);
  const homeMarketId = geoMarkets.find((m) => m.kind === "home")?.id ?? "home";
  return geoMarkets.map((m) => {
    const segments: MarketSegStanding[] = world.segments
      .filter((s) => s.active)
      .map((s) => {
        let leader: FirmId | null = null, leaderShare = 0, yourShare = 0;
        for (const fr of lastFirmResults) {
          const bs = fr.markets?.[m.id]?.bySeg?.[s.id];
          if (!bs) continue;
          if (fr.firm_id === firmId) yourShare = bs.share;
          if (bs.share > leaderShare) { leaderShare = bs.share; leader = fr.firm_id; }
        }
        return { id: s.id, size: Math.round(s.D * m.demand_mult), leader, leaderShare, yourShare };
      });
    let totalQ = 0, yourQ = 0;
    for (const fr of lastFirmResults) {
      const q = fr.markets?.[m.id]?.q_sold ?? 0;
      totalQ += q;
      if (fr.firm_id === firmId) yourQ = q;
    }
    const sitesOf = (f: FirmState): MarketSiteView[] =>
      (f.facilities ?? [])
        .filter((x) => (x.market_id ?? homeMarketId) === m.id)
        .map((x) => ({ id: x.id, firmId: f.id, name: nameOf(f.id), type: x.type, location_id: x.location_id, lot_id: x.lot_id, active: x.active }));
    const occByLot = new Map<string, "you" | "rival">();
    for (const f of world.firms) {
      if (f.status !== "active") continue;
      for (const fac of f.facilities ?? []) {
        if ((fac.market_id ?? homeMarketId) === m.id && fac.lot_id) occByLot.set(fac.lot_id, f.id === firmId ? "you" : "rival");
      }
    }
    const lots: MarketLotView[] = (m.lots ?? []).map((L) => ({
      id: L.id, x: L.x, y: L.y, district: L.district,
      unlocked: round >= (L.unlock_round ?? 0),
      occupant: occByLot.get(L.id) ?? null,
    }));
    return {
      id: m.id, label: m.label, kind: m.kind,
      entered: m.kind === "home" || ownEntered.has(m.id),
      entryCost: m.entry_cost, fx: world.fx_rates?.[m.id] ?? 1,
      yourShare: totalQ > 1e-9 ? yourQ / totalQ : 0,
      segments,
      yourSites: own ? sitesOf(own) : [],
      rivalSites: world.firms.filter((f) => f.id !== firmId && f.status === "active").flatMap(sitesOf),
      lots,
    };
  });
}
