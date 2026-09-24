import { useCallback, useEffect, useRef, useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_TAG, SHOCK_META, fmt } from "../labels.js";
import { Button, Card, Eyebrow, Stat, Tag } from "../components/ui.js";
import { DecisionForm, type DeskId } from "../components/DecisionForm.js";
import { OperationsAndDemand } from "../components/OperationsAndDemand.js";
import { Standings } from "../components/Standings.js";
import { Events } from "../components/Events.js";
import { FirmDetail } from "../components/FirmDetail.js";
import { parseEvents } from "../components/eventFeed.js";
import { Boardroom } from "../components/Boardroom.js";
import { DeskCockpit } from "../components/DeskCockpit.js";
import { RoundTable } from "../components/RoundTable.js";
import { StatementsAndRatios } from "../components/Statements.js";
import { Sparkline } from "../components/Sparkline.js";
import { Trends } from "../components/Trends.js";
import { Field } from "../components/Field.js";
import { MarketMap } from "../components/MarketMap.js";
import { CityView } from "../components/CityView.js";
import { ErrorBoundary } from "../components/ErrorBoundary.js";
import { TapDispatch } from "../components/TapDispatch.js";
import { Emblem } from "../components/FacilityGlyph.js";
import { firmColor, firmEmblem } from "../lib/teamColors.js";
import { DESK_LEVERS, ROLE_DESK } from "drinkwars-engine";
import { Reconcile } from "../components/Reconcile.js";
import { computeConflicts, leverText, offDeskEdits, openConflicts, same } from "../lib/reconcile.js";
import { dedupeBuilds, emptyCityActions, marketPresenceFrom, marketsTouched, type CityActions } from "../game/cityActions.js";

const SEAT_LABEL: Record<string, string> = { ceo: "CEO", cfo: "CFO", cmo: "CMO", coo: "COO", chro: "CHRO" };

/** Primary destinations (design: Review · Decide · Map). Distribution is a drawer
 *  inside Map / a panel inside Decide, NOT a destination. */
type Dest = "review" | "decide" | "map";
type RTab = "statements" | "operations" | "dispatch" | "trends" | "field";

const NAV_ICON: Record<Dest, JSX.Element> = {
  review: <path d="M4 5h13v14H5a1 1 0 0 1-1-1ZM17 8h3v9a2 2 0 0 1-2 2M7 8h7M7 11h7M7 14h4" />,
  decide: <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="7" cy="17" r="2" /></>,
  map: <><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" /><path d="M9 4v14M15 6v14" /></>,
};

/** Decide-tab desk filter (design's role lanes). "All" shows every lever; a desk focuses
 *  one area. The future role system maps a player's role → a default desk here. */
const DESKS: { id: DeskId; label: string; color: string }[] = [
  { id: "all", label: "All", color: "var(--color-inksoft)" },
  { id: "commercial", label: "Marketing", color: "var(--color-copper)" },
  { id: "operations", label: "Operations", color: "var(--color-aero)" },
  { id: "people", label: "People", color: "var(--color-gold)" },
  { id: "finance", label: "Finance", color: "var(--color-hop)" },
  { id: "strategy", label: "Strategy", color: "var(--color-plum)" },
];

/** Does the CURRENT round count toward the season score? Mirrors the engine's
 *  roundIsScored on the view's scoring config (accumulation window, §2). */
function roundCounts(view: GameView): boolean {
  const win = view.scoring?.accumulation_window;
  if (!win) return true;
  if (win.tail_only != null) return view.round >= view.nRounds - win.tail_only;
  return view.round >= (win.drop_first ?? 0);
}

export function Play({
  view,
  busy,
  infoCost,
  onPlay,
  defaultDecision,
  onReset,
  mp = false,
  seatRole,
  banner,
  submitLabel,
  footerNote,
  onExit,
  standing,
}: {
  view: GameView;
  busy: boolean;
  infoCost: number;
  onPlay: (d: FirmDecision, covers?: Set<string>) => Promise<void> | void;
  defaultDecision: () => Promise<FirmDecision>;
  onReset: () => void;
  seatRole?: string | null; // team firms: this player's C-suite seat (defaults the desk focus)
  // Multiplayer (student) mode: submit-and-wait lifecycle — adds the round banner, a submit
  // label + Leave action. The Map (CityView / MarketMap) now renders the same as solo, fed by
  // the transport's per-team projections (markets/firms/shocks). Solo leaves these undefined.
  mp?: boolean;
  banner?: string;
  submitLabel?: string;
  footerNote?: string;
  onExit?: () => void;
  standing?: FirmDecision | null; // DW-050: the firm's standing plan (team reconcile: "CEO left it alone" guard)
}) {
  const [dest, setDest] = useState<Dest>("decide");
  const [rtab, setRtab] = useState<RTab>("dispatch");
  // A team-firm seat opens focused on its own desk (CFO → finance, etc.); solo opens on All.
  const [desk, setDesk] = useState<DeskId>(seatRole ? ((ROLE_DESK[seatRole] as DeskId) ?? "all") : "all");
  const [infoPreview, setInfoPreview] = useState(false);
  // Solo play reveals the research the moment it is ticked (there is no server round-trip to
  // wait for), so an untick after reading was a free report. Once revealed, the purchase stands
  // for the round — you can't hand back a report you've read. Multiplayer is unaffected: there
  // the intel only unlocks when the submitted plan carries the purchase.
  const [infoLocked, setInfoLocked] = useState(false);
  const onInfoChange = useCallback((bought: boolean) => {
    setInfoPreview(bought);
    // The `&& !mp` that used to be here meant the lock never engaged in TEAM games — the only
    // mode a class plays — so the checkbox stayed live after the intel had been served. The
    // server now enforces the ratchet (DW-061); this is the visible half, so the box reflects a
    // purchase that has already happened instead of inviting a student to undo it.
    if (bought) setInfoLocked(true);
  }, [mp]);
  const [detailFirm, setDetailFirm] = useState<string | null>(null);
  // Talent raids are lifted here so they can be made from a rival's dossier AND the
  // decision form — both write the same list, injected into the decision at submit.
  const [poaches, setPoaches] = useState<{ firm: string; employee: string; offer: number }[]>([]);
  const queuePoach = (firm: string, employee: string, offer: number) =>
    setPoaches((prev) => {
      const rest = prev.filter((p) => p.employee !== employee);
      return offer > 0 ? [...rest, { firm, employee, offer }] : rest;
    });
  // City View actions + the decision draft are lifted here so they survive nav switches
  // (Map ↔ Decide edit ONE round decision, merged at submit). Reset each round.
  const [cityActions, setCityActions] = useState<CityActions>(() => emptyCityActions(view));
  const [decision, setDecision] = useState<FirmDecision | null>(null);
  // Per-desk rationale note (the §4.4 "your call" field) — a thinking aid this pass; the seam
  // for the team huddle. Keyed by desk so switching cockpits keeps each officer's note.
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const seenRound = useRef<string | null>(null);

  // New game (no results yet) → start on Decide.
  useEffect(() => {
    if (!view.result) setDest("decide");
  }, [view.result]);
  // Reset live intel preview + queued raids + decision draft each new round.
  useEffect(() => {
    setInfoPreview(false);
    setInfoLocked(false);
    setPoaches([]);
    setRationale({});
    setCityActions(emptyCityActions(view));
    let live = true;
    defaultDecision().then((dd) => {
      if (live) {
        setDecision(dd);
        setInfoPreview(!!dd.buy_info);
      }
    });
    return () => { live = false; };
  }, [view.round]);
  // DW-050: a specialist's form tracks the FIRM's plan on every desk that isn't theirs —
  // when the CEO submits a facility build, the CFO's cash projection shows it within a poll.
  // Their own desk is never touched; a stray off-desk edit is overwritten (it wouldn't apply).
  const firmPlan = view.teamPlan?.composed ?? standing ?? null;
  const composedKey = JSON.stringify(firmPlan);
  const prevComposed = useRef<Record<string, string> | null>(null);
  const hasDecision = decision != null;
  useEffect(() => {
    if (!mp || !seatRole || !hasDecision) return;
    const desk = ROLE_DESK[seatRole] ?? "all";
    const composed = firmPlan;
    if (!composed) return;
    if (desk === "all") {
      // CEO (DW-051): levers on EMPTY desks follow the composed plan — a teammate's cover lands
      // in this form (so a later CEO re-submit carries it), the Reconcile card names it. Only
      // keys whose composed value changed since the last poll move, so the CEO's own typing on
      // other levers is never clobbered by a teammate's unrelated submit.
      const src = composed as unknown as Record<string, unknown>;
      const seatedDesks = new Set((view.teamPlan?.seats ?? []).filter((s) => s.role && ROLE_DESK[s.role] && ROLE_DESK[s.role] !== "all").map((s) => ROLE_DESK[s.role!] as string));
      const emptyLevers = new Set<string>();
      for (const [d, fs] of Object.entries(DESK_LEVERS)) if (!seatedDesks.has(d)) for (const f of fs as string[]) emptyLevers.add(f);
      const snap: Record<string, string> = {};
      for (const k of Object.keys(src)) snap[k] = JSON.stringify(src[k]);
      const prev = prevComposed.current;
      prevComposed.current = snap;
      setDecision((d) => {
        if (!d) return d;
        const next = { ...d } as unknown as Record<string, unknown>;
        let changed = false;
        for (const k of emptyLevers) {
          if (!(k in src) || !(k in next)) continue;
          const moved = prev ? prev[k] !== snap[k] : true; // first sight = seed from the plan
          if (moved && JSON.stringify(next[k]) !== snap[k]) { next[k] = src[k]; changed = true; }
        }
        return changed ? (next as unknown as FirmDecision) : d;
      });
      return;
    }
    const own = new Set<string>(DESK_LEVERS[desk] as string[]);
    setDecision((d) => {
      if (!d) return d;
      const next = { ...d } as unknown as Record<string, unknown>;
      const src = composed as unknown as Record<string, unknown>;
      let changed = false;
      for (const k of Object.keys(src)) {
        if (own.has(k) || k === "firm_id" || !(k in next)) continue;
        if (JSON.stringify(next[k]) !== JSON.stringify(src[k])) { next[k] = src[k]; changed = true; }
      }
      return changed ? (next as unknown as FirmDecision) : d;
    });
  }, [composedKey, mp, seatRole, hasDecision]);
  // On each resolution, surface the round in Review (the Tap Dispatch) — replaces the
  // old one-popup-per-event queue. Keyed on resolved-round COUNT (the round pointer
  // stops on the final round, but history still grows by one).
  // Solo grows history each round; multiplayer advances the round / flips complete when the
  // instructor resolves (history isn't projected to students). Either change ⇒ a round resolved.
  const resolved = Math.max(view.history.length, mp ? view.round : 0);
  const resolveSig = `${view.round}:${view.complete}:${view.history.length}`;
  useEffect(() => {
    if (seenRound.current === null) { seenRound.current = resolveSig; return; }
    if (resolveSig !== seenRound.current) {
      seenRound.current = resolveSig;
      setDest("review");
      setRtab("statements"); // the sheets first; the Dispatch tab carries a count when there is news
    }
  }, [resolveSig]);

  const myRank = view.standings.findIndex((s) => s.isYou) + 1;
  const hasHistory = view.history.length > 0;
  // Map = the city view when geography is in play; otherwise the demand/supply Market map.
  const cityEnabled = !!view.modules?.geography?.enabled && view.markets.length > 0;
  // Multiplayer: research is live only once the FIRM's submitted plan buys it (server truth) —
  // a ticked box previews nothing (it showed redacted zeros as if revealed). Solo previews.
  const infoActive = mp ? view.infoActive : (view.infoActive || infoPreview);
  const infoPending = mp && infoPreview && !view.infoActive;
  const detailSnapshot = detailFirm ? view.firms.find((f) => f.firm_id === detailFirm) ?? null : null;

  // DW-050: team firms — where this seat and another disagree, given the CURRENT form.
  const conflicts = mp && seatRole && view.teamPlan ? computeConflicts(view, seatRole, decision, standing) : [];
  const offDesk = mp && seatRole && view.teamPlan ? offDeskEdits(view, seatRole, decision, standing) : [];
  const handlePlay = async (d0: FirmDecision) => {
    let d = infoLocked && !d0.buy_info ? { ...d0, buy_info: true } : d0;
    let covers: Set<string> | undefined;
    if (mp && seatRole && view.teamPlan) {
      // A specialist's slice carries the firm's values (as mirrored in the form) on every desk
      // that isn't theirs — the City View / poach merge must not rewrite those (it recomputed
      // "markets served" from this browser's map and flagged it as a stray edit).
      const myDesk = ROLE_DESK[seatRole] ?? "all";
      if (myDesk !== "all" && decision) {
        const own = new Set<string>(DESK_LEVERS[myDesk] as string[]);
        const out = { ...d } as unknown as Record<string, unknown>;
        const raw = decision as unknown as Record<string, unknown>;
        for (const k of Object.keys(out)) if (!own.has(k) && k !== "firm_id" && k in raw) out[k] = raw[k];
        // DW-052: the restore above also wiped this player's OWN City View actions (a CHRO
        // siting a facility never reached the server — it "didn't resolve or show up"). Those
        // are deliberate decisions, not mirror strays — lay them back on top, deduped against
        // whatever the mirror already carries from an earlier submit.
        if (cityActions.builds.length) out.build_facilities = dedupeBuilds([...(((raw.build_facilities as unknown) ?? []) as never[]), ...cityActions.builds as never[]]);
        if (cityActions.mothballs.length) out.mothball_facilities = Array.from(new Set([...(((raw.mothball_facilities as unknown) ?? []) as string[]), ...cityActions.mothballs]));
        if (cityActions.reactivations.length) out.reactivate_facilities = Array.from(new Set([...(((raw.reactivate_facilities as unknown) ?? []) as string[]), ...cityActions.reactivations]));
        if (cityActions.divests.length) out.divest_facilities = Array.from(new Set([...(((raw.divest_facilities as unknown) ?? []) as string[]), ...cityActions.divests]));
        if (Object.keys(cityActions.maintain).length) out.maintain_facilities = { ...(((raw.maintain_facilities as unknown) ?? {}) as Record<string, number>), ...cityActions.maintain };
        if (Object.keys(cityActions.supply).length) out.market_supply = cityActions.supply;
        if (marketsTouched(view, cityActions)) out.market_presence = marketPresenceFrom(view, cityActions.markets);
        if (poaches.length) out.poach_employees = poaches;
        d = out as unknown as FirmDecision;
        // Deliberate covers = off-desk levers this player changed away from the firm's plan AS
        // SHOWN in this form (firmPlan is what the mirror wrote). A mirror a poll stale is not a
        // decision — sending it would overrule e.g. the CEO's research purchase (later word wins).
        covers = new Set<string>();
        const shown = (firmPlan ?? {}) as unknown as Record<string, unknown>;
        for (const k of Object.keys(out)) if (!own.has(k) && k !== "firm_id" && !same(out[k], shown[k])) covers.add(k);
      }
      // Last chance before the slice lands: unacknowledged disagreements, spelled out.
      const open = openConflicts(computeConflicts(view, seatRole, d, standing));
      const off = offDeskEdits(view, seatRole, d, standing);
      if (open.length || off.length) {
        const T = (f: string, v: unknown) => leverText(f, v, view);
        const lines = [
          ...open.slice(0, 6).map((c) => c.cover
            ? `• ${c.label}: ${c.who} set ${T(String(c.field), c.theirs)} for an empty desk; you have ${T(String(c.field), c.mine)}. ${c.winner === "me" ? "Yours will be used (you're submitting after them)." : "Theirs will be used unless you submit again after them."}`
            : `• ${c.label}: ${c.who} submitted ${T(String(c.field), c.theirs)}; you have ${T(String(c.field), c.mine)}. ${c.winner === "me" ? "Yours will be used — it's your desk." : "Theirs will be used — it's their desk."}`),
          ...off.slice(0, 6).map((e) => `• ${e.label} is the ${e.deskOwner}'s desk${e.ownerName ? ` (${e.ownerName})` : e.ceoSeated ? " — empty, so the CEO covers it" : " — empty, no CEO seated"}. You set ${T(String(e.field), e.mine)}; the firm's plan has ${T(String(e.field), e.firm)}. ${e.applies ? "Yours will be used, and the CEO will see it." : `${e.ownerName ?? "The owner"} decides — yours is only a suggestion.`}`),
        ].join("\n");
        if (!window.confirm(`Before you submit:\n\n${lines}\n\nSubmit anyway? (Cancel to talk it over first — the gold card above the form lists these.)`)) return;
      }
    }
    await onPlay(d, covers); // resolution effect navigates to Review
  };

  const nav: { id: Dest; label: string }[] = [
    { id: "decide", label: view.complete ? "Season" : "Decide" },
    { id: "review", label: "Review" },
    { id: "map", label: cityEnabled ? "City & Globe" : "Map" },
  ];

  // Design: three caps pill tabs directly below the HUD (Decide · Review · City & Globe).
  // .tt-tab / .is-active carry the exact editorial pill chrome.
  const navPill = (n: { id: Dest; label: string }) => (
    <button key={n.id} onClick={() => setDest(n.id)} className={`tt-tab flex-none ${dest === n.id ? "is-active" : ""}`}>
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">{NAV_ICON[n.id]}</svg>
      {n.label}
    </button>
  );

  return (
    <div className="mx-auto max-w-[1720px] px-3 py-4 pb-10 sm:px-5">
      {detailSnapshot && (
        <FirmDetail firm={detailSnapshot} view={view} infoActive={infoActive} poaches={poaches} onPoach={queuePoach} onClose={() => setDetailFirm(null)} />
      )}

      {/* top bar */}
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line2 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="eyebrow">Drink Wars · {view.difficulty}</div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5">
              <span className="grid h-4 w-4 place-items-center rounded-[4px]" style={{ background: firmColor(view.own.id) }}>{firmEmblem(view.own.id) ? <Emblem id={firmEmblem(view.own.id)!} size={11} color="#fff" /> : <span className="text-[0.6rem] font-bold text-paper">{(view.names[view.own.id] ?? "B").charAt(0)}</span>}</span>
              <span className="font-mono text-[0.6rem] font-bold uppercase tracking-wide text-ink">{view.names[view.own.id] ?? "Your Brewery"}</span>
            </span>
          </div>
          <h1 className="display text-2xl font-semibold sm:text-3xl">
            Round <span className="text-copper">{Math.min(view.round + 1, view.nRounds)}</span>
            <span className="text-inksoft"> / {view.nRounds}</span>
            {/* Scoring-layer §2: an excluded round must be visibly marked BEFORE it's
                played — an announced exclusion teaches that experimenting is cheap. */}
            {!roundCounts(view) && (
              <span className="ml-2 inline-flex translate-y-[-3px] items-center rounded-full border border-gold bg-gold/15 px-2 py-0.5 align-middle font-mono text-[0.58rem] font-bold uppercase tracking-wide text-copperdeep" title="This round resolves and publishes normally, but does not count toward the season score.">
                practice · not scored
              </span>
            )}
          </h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {view.segments.filter((s) => s.active).map((s) => (
              <Tag key={s.id} tone="copper">{SEG_TAG[s.id] ?? s.id}</Tag>
            ))}
            {view.shocks.map((s, i) => {
              const m = SHOCK_META[s.typeId] ?? { label: s.typeId, icon: "⚠", note: "" };
              return (
                <button key={`sk${i}`} onClick={() => setDest("map")} title="See it on the map" className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold transition-colors hover:bg-panel2" style={{ borderColor: s.active ? "var(--color-brick)" : "var(--color-gold)", color: s.active ? "var(--color-brick)" : "var(--color-copperdeep)" }}>
                  {m.icon} {m.label} · {s.active ? "now" : `~${Math.max(s.roundsAway, 0)}r`}
                </button>
              );
            })}
          </div>
        </div>
        {/* flex-wrap + justify-end: on narrow widths the stats wrap onto a second line
            instead of overflowing and hard-clipping the leftmost value at the edge */}
        <div className="flex flex-wrap items-end justify-end gap-x-5 gap-y-2 sm:gap-x-6">
          <Stat label="Cash" value={fmt.money(view.own.cash)} accent={view.own.cash < 300 ? "brick" : "ink"} />
          <Stat label="Capacity" value={fmt.int(view.own.cap)} sub="drinks/rd" />
          {view.ownResult && (
            <span className="hidden sm:block">
              <Stat label="Net income" value={fmt.signed(view.ownResult.pnl.net_income)} accent={view.ownResult.pnl.net_income < 0 ? "brick" : "ink"} />
            </span>
          )}
          <Stat label="Your rank" value={myRank > 0 ? `#${myRank}` : "—"} accent="copper" sub={view.ownActive ? undefined : "exited"} />
          {onExit && <button onClick={onExit} className="self-center rounded-lg border border-line2 bg-panel2 px-3 py-2 font-mono text-[0.62rem] font-bold uppercase tracking-wide text-inksoft">Leave</button>}
        </div>
      </header>

      {banner && <div className="mb-3 rounded-lg border px-3 py-2 text-sm text-inksoft" style={{ borderColor: mp && view.ownActive && !view.complete ? "var(--color-copper)" : "var(--color-line2)" }}>{banner}</div>}
      {mp && seatRole && (
        <div className="mb-3 rounded-lg border border-line2 bg-panel/60 px-3 py-2 text-[0.8rem] text-inksoft">
          You're the <b className="text-copperdeep">{SEAT_LABEL[seatRole] ?? seatRole}</b> — your <b className="text-ink">{(ROLE_DESK[seatRole] ?? "all") === "all" ? "whole-firm" : ROLE_DESK[seatRole]}</b> levers compose this firm's decision with your teammates'. Other desks are theirs to set.
        </div>
      )}

      {/* tab row — three pills directly below the HUD (design: Decide · Review · City & Globe) */}
      <nav className="sticky top-0 z-20 -mx-3 mb-4 flex gap-1.5 overflow-x-auto border-b border-line2 bg-paper/85 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5">
        {nav.map((n) => navPill(n))}
      </nav>

      {/* destination */}
      <main className="min-w-0">
          {dest === "map" && (cityEnabled
            ? <CityView view={view} actions={cityActions} setActions={setCityActions} onInspect={setDetailFirm} extraBuilds={decision?.build_facilities ?? []} />
            : <MarketMap view={view} onInspect={setDetailFirm} />)}

          {dest === "decide" && (
            <div className="grid gap-3">
              {view.ownActive && !view.complete && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 rounded-full bg-ink px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-hop" /><span className="font-mono text-[0.55rem] font-bold uppercase tracking-[0.08em] text-paper">Pro mode · all levers</span></span>
                  <span className="flex-1" />
                  <span className="hidden font-mono text-[0.55rem] uppercase tracking-wide text-inksoft sm:inline">Focus desk</span>
                  {DESKS.map((dk) => { const on = desk === dk.id; return (
                    <button key={dk.id} onClick={() => setDesk(dk.id)} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-wide transition-colors" style={{ borderColor: on ? dk.color : "var(--color-line2)", background: on ? `color-mix(in srgb, ${dk.color} 14%, var(--color-panel))` : "var(--color-panel)", color: on ? dk.color : "var(--color-inksoft)" }}>
                      <span className="h-2 w-2 rounded-sm" style={{ background: dk.color }} />{dk.label}
                    </button>
                  ); })}
                </div>
              )}
              <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="min-w-0">
                {view.ownActive && !view.complete && (
                  <div className="mb-4">
                    <DeskCockpit desk={desk} view={view} seatRole={seatRole} rationale={rationale[desk] ?? ""} onRationale={(v) => setRationale((p) => ({ ...p, [desk]: v }))} />
                  </div>
                )}
                {view.ownActive && !view.complete && (conflicts.length > 0 || offDesk.length > 0) && seatRole && (
                  <div className="mb-3"><Reconcile view={view} conflicts={conflicts} offDesk={offDesk} seatRole={seatRole} onAdopt={(field, value) => setDecision((d) => (d ? { ...d, [field]: value } as FirmDecision : d))} /></div>
                )}
                {view.ownActive && !view.complete && (
                  <DecisionForm view={view} defaultDecision={defaultDecision} onPlay={handlePlay} busy={busy} infoCost={infoCost} onInfoChange={onInfoChange} infoLocked={infoLocked} poaches={poaches} onPoach={queuePoach} cityActions={cityActions} decision={decision} setDecision={setDecision} desk={desk} submitLabel={submitLabel} footerNote={footerNote} />
                )}
                {!view.ownActive && !view.complete && (
                  <Card>
                    <Eyebrow>Forced exit</Eyebrow>
                    {mp ? (
                      <p className="text-sm text-ink">Your brewery has left the market. You still see every round resolve — follow the shakeout in Review, and use your Scorecard for the debrief. Your instructor will tell you if there's a reassignment.</p>
                    ) : (
                      <p className="text-sm text-ink">Your brewery ran out of road. Keep watching the shakeout, or start a new run.</p>
                    )}
                    {!mp && (
                      <div className="mt-3 flex gap-2">
                        <Button variant="go" onClick={() => handlePlay({} as FirmDecision)} disabled={busy}>{busy ? "…" : "Watch next round →"}</Button>
                        <Button variant="ghost" onClick={onReset}>New brewery</Button>
                      </div>
                    )}
                  </Card>
                )}
                {view.complete && <SeasonOver view={view} rank={myRank} onReset={onReset} mp={mp} />}
              </div>
              <div className="grid content-start gap-4 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100vh-5.25rem)] lg:self-start lg:overflow-y-auto">
                <Standings view={view} onSelect={setDetailFirm} />
                {/* The Round Table is a TEAM surface (who has submitted, the composed plan). Alone at
                    the controls it only repeats the desk chips above the form, so solo play skips it. */}
                {view.ownActive && !view.complete && mp && seatRole && (
                  <RoundTable view={view} rationale={rationale} seatRole={seatRole} onFocusDesk={setDesk} />
                )}
                {view.briefings.length > 0 && <Boardroom briefings={view.briefings} />}
                {view.history.length > 1 && (
                  <Card>
                    <Eyebrow>Season pulse</Eyebrow>
                    <div className="grid gap-1.5">
                      <div className="flex items-center justify-between text-[0.72rem] text-inksoft"><span>Cash</span><Sparkline values={view.history.map((h) => h.own.cash)} /></div>
                      <div className="flex items-center justify-between text-[0.72rem] text-inksoft"><span>Score</span><Sparkline values={view.history.map((h) => h.own.score)} color="var(--color-copper)" /></div>
                      <div className="flex items-center justify-between text-[0.72rem] text-inksoft"><span>Net income</span><Sparkline values={view.history.map((h) => h.own.netIncome)} /></div>
                    </div>
                  </Card>
                )}
                <Events events={parseEvents(view.events, view.names[view.own.id] ?? "")} />
              </div>
              </div>
            </div>
          )}

          {dest === "review" && (() => {
            // News worth a look before the numbers: anything that names your house, plus disruptions.
            const news = parseEvents(view.events, view.names[view.own.id] ?? "").filter((e) => e.mine || e.kind === "shock").length;
            const tabs: [RTab, string][] = [["statements", "Statements & Ratios"], ["operations", "Operations & Demand"], ["dispatch", "The Dispatch"], ["trends", "Trends"], ["field", "Field & Intel"]];
            const tab: RTab = hasHistory ? rtab : "dispatch"; // nothing to account for until a round resolves
            return (
            <div className="rounded-[14px] border border-line2 bg-panel/40">
              {/* Sticks directly under the main tab bar (it used to slide beneath it). */}
              <div className="sticky top-[3.25rem] z-[5] flex flex-wrap items-center gap-2.5 rounded-t-[14px] border-b border-line bg-panel px-4 py-2.5">
                <span className="display text-lg font-bold text-ink">Review</span>
                <div className="inline-flex flex-wrap gap-0.5 rounded-[9px] border border-line2 bg-panel2 p-0.5">
                  {tabs.map(([id, label]) => (
                    <button key={id} disabled={(id !== "dispatch") && !hasHistory} onClick={() => setRtab(id)} className="rounded-[7px] px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-wide transition-colors disabled:opacity-30" style={{ background: tab === id ? "var(--color-panel)" : "transparent", color: tab === id ? "var(--color-copperdeep)" : "var(--color-inksoft)", fontWeight: tab === id ? 700 : 500, boxShadow: tab === id ? "inset 0 1px 0 rgba(255,255,255,.6),0 1px 0 var(--color-line2)" : undefined }}>
                      {label}
                      {id === "dispatch" && news > 0 && tab !== "dispatch" && <span className="ml-1.5 rounded-full bg-brick px-1.5 py-px text-[0.55rem] font-bold text-paper">{news}</span>}
                    </button>
                  ))}
                </div>
                <span className="flex-1" />
                <span className="hidden font-mono text-[0.6rem] uppercase text-inksoft xl:inline">{resolved > 0 ? `After round ${resolved}` : "Season opening"}</span>
                {/* The way forward is on every tab — it used to live only at the foot of the Dispatch. */}
                {!view.complete && view.ownActive && <Button variant="go" onClick={() => setDest("decide")}>On to round {Math.min(view.round + 1, view.nRounds)} →</Button>}
              </div>
              <div className="grid gap-5 p-4">
                {/* Season wrap belongs to the round in review, not to every lens on it — it used
                    to repeat under all five tabs once the season closed. */}
                {view.complete && tab === "dispatch" && <SeasonOver view={view} rank={myRank} onReset={onReset} mp={mp} />}
                {/* One boundary per panel, keyed on the tab: a panel that throws stays broken
                    while the other four keep working, and switching away clears it. */}
                <ErrorBoundary resetKey={tab} label={tabs.find(([id]) => id === tab)?.[1]}>
                  {tab === "statements" && <StatementsAndRatios view={view} />}
                  {tab === "operations" && (view.ownResult ? <OperationsAndDemand result={view.ownResult} view={view} /> : <Card>Operations open once a round has resolved.</Card>)}
                  {tab === "dispatch" && <TapDispatch view={view} round={Math.max(resolved, 1)} />}
                  {tab === "trends" && <Trends view={view} />}
                  {tab === "field" && <Field view={view} infoActive={infoActive} pending={infoPending} onInspect={setDetailFirm} />}
                </ErrorBoundary>
              </div>
            </div>
            );
          })()}
        </main>
    </div>
  );
}

function SeasonOver({ view, rank, onReset, mp }: { view: GameView; rank: number; onReset: () => void; mp?: boolean }) {
  return (
    <Card className="rise">
      <Eyebrow>Season complete</Eyebrow>
      <h2 className="display text-2xl font-semibold">
        {rank === 1 ? "You finished first." : rank > 0 ? `You finished #${rank} of ${view.standings.length}.` : "Your run has ended."}
      </h2>
      <p className="mt-1 text-sm text-inksoft">Sustained scorecard rewards advantage held across the whole season, not a final-round spike.</p>
      {mp ? <p className="mt-2 text-[0.78rem] text-inksoft">Your Scorecard and Trends stay available for the debrief — nothing more to submit.</p> : <div className="mt-3"><Button variant="go" onClick={onReset}>Play again</Button></div>}
    </Card>
  );
}
