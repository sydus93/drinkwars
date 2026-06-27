/**
 * Presentation summaries for the coopetition (MOD-A05/A06) and lobbying (MOD-A09)
 * subsystems. These shape raw world/agreement state into the flat, serializable
 * objects the UI renders — kept here (one tested place) so the single-player
 * controller, the multiplayer transport, and the edge function all produce an
 * identical shape rather than each re-deriving it. Naming is injected (`nameOf`)
 * so the engine stays free of presentation strings.
 */
import type {
  ClauseAction, ClauseCondition, Config, FirmId, FirmRoundResult, FirmState, GovernanceForm, MarketKind, RegulationType, RoundResult, SegmentId, TemplateId, WorldState,
} from "../types.js";
import { activeMarkets } from "./geography.js";
import { firmValuation } from "./finance.js";

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

// ───────────────────────── shocks the viewer may know about ─────────────────────────
export interface ShockSignalView { typeId: string; kind: string; target: SegmentId | "all"; round: number; roundsAway: number; active: boolean; signaled: boolean }
/** Shocks currently in effect + any explicitly-telegraphed upcoming ones (within 3 rounds).
 *  Unannounced shocks stay hidden until they fire — seeing them coming would break the game. */
export function projectShocks(world: WorldState, round: number): ShockSignalView[] {
  const out: ShockSignalView[] = [];
  for (const s of world.shock_timeline ?? []) {
    const active = s.fired && s.round <= round && round < s.round + s.duration;
    const upcomingSignaled = !s.fired && s.signaling === "signaled_noisy" && s.round >= round && s.round <= round + 3;
    if (!active && !upcomingSignaled) continue;
    out.push({ typeId: s.type_id, kind: s.kind, target: s.target, round: s.round, roundsAway: s.round - round, active, signaled: s.signaling === "signaled_noisy" });
  }
  out.sort((a, b) => Number(b.active) - Number(a.active) || a.roundsAway - b.roundsAway);
  return out;
}

// ───────────────────────── per-round history (own trend + public field aggregate) ─────────────────────────
export interface OwnTrendView { round: number; cash: number; score: number; rank: number; share: number; Q: number; B: number; netIncome: number; equity: number }
export interface FieldTrendView { round: number; topScore: number; medianScore: number; totalQ: number; activeFirms: number }
const median = (xs: number[]): number => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** The viewer's own trajectory + the public field aggregate, per resolved round. All public
 *  (own = the viewer's; field = league-wide aggregates already visible in standings). */
export function projectHistory(records: { round: number; result: RoundResult }[], viewerId: FirmId): { own: OwnTrendView; field: FieldTrendView }[] {
  return records.map((rr) => {
    const ranked = [...rr.result.firm_results].sort((a, b) => b.scorecard_cumulative - a.scorecard_cumulative);
    const ownFr = rr.result.firm_results.find((f) => f.firm_id === viewerId);
    const scores = rr.result.firm_results.map((f) => f.scorecard_cumulative);
    return {
      own: { round: rr.round, cash: ownFr?.balance_sheet.cash ?? 0, score: ownFr?.scorecard_cumulative ?? 0, rank: ranked.findIndex((f) => f.firm_id === viewerId) + 1, share: ownFr ? Object.values(ownFr.segments).reduce((a, s) => a + s.share, 0) : 0, Q: ownFr?.state.Q ?? 0, B: ownFr?.state.B ?? 0, netIncome: ownFr?.pnl.net_income ?? 0, equity: ownFr?.balance_sheet.equity ?? 0 },
      field: { round: rr.round, topScore: Math.max(...scores, 0), medianScore: median(scores), totalQ: rr.result.market.reduce((a, m) => a + m.total_q, 0), activeFirms: rr.result.firm_results.filter((f) => f.status === "active").length },
    };
  });
}

// ───────────────────────── per-firm snapshots (research-gated for rivals) ─────────────────────────
export interface FirmSnapshotView {
  firm_id: FirmId; name: string; status: string; isYou: boolean; score: number; share: number;
  Q: number; B: number; cap: number; unitCost: number; T_emp: number; T_inv: number; T_gov: number;
  leverage: number; netIncome: number; priceBySeg: Record<SegmentId, number>; shareBySeg: Record<SegmentId, number>;
  focus: SegmentId[]; cash: number; debt: number; valuation: number; distressRounds: number;
  keyHires: string[]; verticalAssets: string[];
  employees: { id: string; name: string; role: string; skill: number; satisfaction: number; salary: number }[];
  facilities: { type: string; location_id?: string; market_id?: string; active: boolean }[];
}
/** Latest snapshot of every firm. PUBLIC fields (id/name/status/score/share/focus/facilities/
 *  distress) are always included; PRIVATE fields (stocks, cash, prices, employees, hires,
 *  valuation) only for the viewer's own firm or when `reveal` (market research purchased) is
 *  true — so rivals' private state never leaks to a student who hasn't paid for it. Solo passes
 *  reveal=true (single human; the UI blurs cosmetically); multiplayer gates on the purchase. */
export function projectFirms(world: WorldState, c: Config, viewerId: FirmId, lastFirmResults: FirmRoundResult[], reveal: boolean, nameOf: (id: FirmId) => string): FirmSnapshotView[] {
  const lastByFirm = new Map(lastFirmResults.map((f) => [f.firm_id, f]));
  return world.firms.map((f) => {
    const isYou = f.id === viewerId;
    const show = isYou || reveal;
    const fr = lastByFirm.get(f.id);
    const priceBySeg: Record<SegmentId, number> = {};
    const shareBySeg: Record<SegmentId, number> = {};
    const focus: SegmentId[] = [];
    if (fr) for (const [seg, r] of Object.entries(fr.segments)) { if (r.share > 0.01) focus.push(seg as SegmentId); if (show) { priceBySeg[seg as SegmentId] = r.price; shareBySeg[seg as SegmentId] = r.share; } }
    return {
      firm_id: f.id, name: nameOf(f.id), status: f.status, isYou,
      score: fr?.scorecard_cumulative ?? 0,
      share: fr ? Object.values(fr.segments).reduce((a, s) => a + s.share, 0) : 0,
      Q: show ? f.Q : 0, B: show ? f.B : 0, cap: show ? f.cap : 0, unitCost: show ? f.unit_cost : 0,
      T_emp: show ? f.T_emp : 0, T_inv: show ? f.T_inv : 0, T_gov: show ? f.T_gov : 0,
      leverage: show ? f.debt / Math.max(f.paid_in_capital + f.retained_earnings, 1e-6) : 0,
      netIncome: show ? (fr?.pnl.net_income ?? 0) : 0,
      priceBySeg, shareBySeg, focus,
      cash: show ? f.cash : 0, debt: show ? f.debt : 0,
      valuation: show ? firmValuation(f, c) : 0,
      distressRounds: f.rounds_below_health ?? 0,
      keyHires: show ? (f.key_hires ?? []).map((h) => h.role) : [],
      verticalAssets: show ? (f.vertical_assets ?? []).map((a) => a.id) : [],
      employees: show ? (f.employees ?? []).map((e) => ({ id: e.id, name: e.name, role: e.role, skill: e.skill, satisfaction: e.satisfaction, salary: e.salary })) : [],
      facilities: (f.facilities ?? []).map((x) => ({ type: x.type, location_id: x.location_id, market_id: x.market_id, active: x.active })),
    };
  });
}
