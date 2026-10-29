import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_TAG, fmt } from "../labels.js";
import { EventTakeover, fmtClock, useNow, useUnseenWire } from "../components/EventTakeover.js";
import { WireStrip } from "../components/WireStrip.js";
import { SeatEdge, SeatMobileBar, SeatPlate } from "../components/SeatPlate.js";
import { eventCopy } from "../lib/eventCopy.js";
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
import { ackConflict, cancelsRequest, computeConflicts, dropsTheirs, leverText, offDeskEdits, openConflicts, same } from "../lib/reconcile.js";
import { buildKey, cityActionsFrom, dedupeBuilds, keepUntouchedMarkets, marketPresenceFrom, marketsTouched, poachesFrom, type CityActions, type CityBuildOrder } from "../game/cityActions.js";
import { CallsTickets, useCallsDesk, type CallsClient } from "../components/Calls.js"; // DW-077 calls tickets
import { RoundResolved } from "../components/RoundResolved.js"; // DW-077 results page
import { ModeToggle, useInlineModeToggle } from "../components/ModeToggle.js";
import { SubmitConfirm } from "../components/SubmitConfirm.js";
/** DW-082: off-desk levers that follow the plan even when the form lacks the key (see the DW-050 follow). */
const MARKET_KEYS = new Set(["market_presence", "market_supply"]);

/** DW-077: the results page is remembered per game + round so a reload never re-opens a page already read. */
const ackKey = (gameKey: string, round: number) => `dw077_resolved_ack:${gameKey}:${round}`;
const isAcked = (gameKey: string, round: number) => { try { return localStorage.getItem(ackKey(gameKey, round)) === "1"; } catch { return false; } };
const ack = (gameKey: string, round: number) => { try { localStorage.setItem(ackKey(gameKey, round), "1"); } catch { /* ignore */ } };
/** Headless Chrome (the classroom audits) must never be covered by the results overlay. */
const isWebdriver = () => typeof navigator !== "undefined" && !!(navigator as { webdriver?: boolean }).webdriver;


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

/** DW-078: the header utility line's small buttons (Return code · Leave). */
export const UTIL_BTN = "flex-none rounded-md border border-line2 bg-panel px-2 py-[3px] font-mono text-[0.58rem] uppercase tracking-wide text-inksoft transition-colors hover:text-copper";

export function Play({
  view,
  busy,
  infoCost,
  onPlay,
  onUnsentChange,
  defaultDecision,
  onReset,
  mp = false,
  seatRole,
  banner,
  submitLabel,
  footerNote,
  onExit,
  standing,
  gameId,
  deadlineAt,
  calls,
  gameKey = "solo",
  notices,
  utilities,
}: {
  notices?: ReactNode; // DW-078: the host's one-off notices (return-code card, submit errors, receipts) — under the wire strip
  utilities?: ReactNode; // DW-078: extra small buttons for the header's utility line (e.g. "Return code")
  calls?: CallsClient | null; // DW-077: the calls channel (student client / solo controller); absent ⇒ no tickets, no settled column
  gameKey?: string; // DW-077: keys the results page's once-per-round dismissal
  // DW-077: the game id keys the per-student takeover dismissals (solo → "solo"); the
  // instructor-announced deadline (ms epoch) drives the header clock + the takeover's clock line.
  gameId?: string | null;
  deadlineAt?: number | null;
  view: GameView;
  busy: boolean;
  infoCost: number;
  /** `forRound`: the round this form was built for — the server refuses it if that round has closed (DW-080) */
  onPlay: (d: FirmDecision, covers?: Set<string>, forRound?: number) => Promise<boolean | void> | boolean | void;
  /** DW-080: told whenever "changed since you submitted" flips — the receipt stops saying "Submitted ✓" */
  onUnsentChange?: (unsent: boolean) => void;
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
  // Locked by SERVER TRUTH, not by the local checkbox (DW-061). `infoActive` is true once the
  // firm's COMPOSED plan carries the purchase — the same moment the intel is served and the
  // same moment the server's ratchet engages — so the box can never disagree with the server
  // about whether you have bought. Two things this gets right that a `useState` flag did not:
  // a mis-tick stays freely undoable BEFORE you submit, and the lock survives a refresh.
  const infoLocked = !!view.infoActive;
  const onInfoChange = useCallback((bought: boolean) => {
    setInfoPreview(bought);
  }, []);
  const [detailFirm, setDetailFirm] = useState<string | null>(null);
  // Talent raids are lifted here so they can be made from a rival's dossier AND the
  // decision form — both write the same list, injected into the decision at submit.
  const [poaches, setPoaches] = useState<{ firm: string; employee: string; offer: number }[]>([]);
  // DW-080: what this seat changed AFTER its last submit. planDiffs judges the form as if it were
  // already sent, so a post-submit edit read "Your form matches the team's plan" under a standing
  // "Submitted ✓" — and the old value locked. Every user-driven edit (form, City & Globe queue,
  // raids, Keep mine) marks it; a landed submit and a new round clear it.
  const [editedSinceSubmit, setEditedSinceSubmit] = useState(false);
  const [submittedHere, setSubmittedHere] = useState(false);
  const markEdited = useCallback(() => setEditedSinceSubmit(true), []);
  const editDecision = useCallback((d: FirmDecision) => { setEditedSinceSubmit(true); setDecision(d); }, []);
  const editCity = useCallback((u: (a: CityActions) => CityActions) => { setEditedSinceSubmit(true); setCityActions(u); }, []);
  // DW-082d: Withdraw on the map — the build leaves the City View queue AND the form's copy (the two
  // are unioned at submit, so dropping it from one only would send it again).
  const withdrawBuild = useCallback((b: CityBuildOrder) => {
    const k = buildKey(b);
    setEditedSinceSubmit(true);
    setCityActions((a) => ({ ...a, builds: a.builds.filter((x) => buildKey(x) !== k) }));
    setDecision((d) => (d?.build_facilities?.some((x) => buildKey(x as CityBuildOrder) === k) ? { ...d, build_facilities: d.build_facilities.filter((x) => buildKey(x as CityBuildOrder) !== k) } : d));
  }, []);
  // The form's builds are this seat's own for the CEO, solo play and the operations chair; any other
  // specialist's form mirrors the team plan's builds there, so the map can't withdraw them.
  const seatDesk = mp && seatRole ? ROLE_DESK[seatRole] ?? "all" : "all";
  const buildsMine = seatDesk === "all" || (DESK_LEVERS[seatDesk] as string[]).includes("build_facilities");
  const queuePoach = (firm: string, employee: string, offer: number) =>
    (setEditedSinceSubmit(true), setPoaches((prev) => {
      const rest = prev.filter((p) => p.employee !== employee);
      return offer > 0 ? [...rest, { firm, employee, offer }] : rest;
    }));
  // City View actions + the decision draft are lifted here so they survive nav switches
  // (Map ↔ Decide edit ONE round decision, merged at submit). Reset each round.
  // DW-076: …and re-seeded from what this seat already SENT this round (a reload within a round),
  // so the queue shows the builds / markets / raids the server holds and a resubmit re-sends them.
  const storedSlice = (): Partial<FirmDecision> | null => (mp ? view.teamPlan?.seats.find((s) => s.me)?.partial ?? (view as unknown as { draft?: FirmDecision | null }).draft : null) ?? null;
  const [cityActions, setCityActions] = useState<CityActions>(() => cityActionsFrom(view, storedSlice()));
  const [decision, setDecision] = useState<FirmDecision | null>(null);
  const mySubmitted = !!view.teamPlan?.seats.find((x) => x.me)?.submitted;
  const unsent = editedSinceSubmit && (mySubmitted || submittedHere);
  useEffect(() => { onUnsentChange?.(unsent); }, [unsent, onUnsentChange]);
  // Per-desk rationale note (the §4.4 "your call" field) — a thinking aid this pass; the seam
  // for the team huddle. Keyed by desk so switching cockpits keeps each officer's note.
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const seenRound = useRef<string | null>(null);

  // New game (no results yet) → start on Decide.
  useEffect(() => {
    if (!view.result) setDest("decide");
  }, [view.result]);
  // Reset live intel preview + queued raids + decision draft each new round (from the stored
  // slice when this seat already submitted this round — see storedSlice).
  useEffect(() => {
    const stored = storedSlice();
    setInfoPreview(false);
    setPoaches(poachesFrom(stored));
    setRationale({});
    setCityActions(cityActionsFrom(view, stored));
    setEditedSinceSubmit(false);
    setSubmittedHere(false);
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
    // DW-081: the CEO's form changes only when the CEO changes it. It used to copy a teammate's
    // cover for a desk whose chair hadn't submitted — the CEO saw a CFO's price as "yours is used",
    // and when the CMO then submitted, the copy stopped and the stale number stayed. Nothing needs
    // the copy now: an untouched CEO resubmit never erases a cover (DW-080, engine seats.ts), and
    // the commit panel names every teammate's number that locks.
    if (desk === "all") return;
    const own = new Set<string>(DESK_LEVERS[desk] as string[]);
    // Only keys whose plan value MOVED since the last poll follow it (first sight seeds all):
    // a cover this player is still typing for an empty chair must not be wiped because a
    // teammate submitted something unrelated.
    const srcS = composed as unknown as Record<string, unknown>;
    const snapS: Record<string, string> = {};
    for (const k of Object.keys(srcS)) snapS[k] = JSON.stringify(srcS[k]);
    const prevS = prevComposed.current;
    prevComposed.current = snapS;
    setDecision((d) => {
      if (!d) return d;
      const next = { ...d } as unknown as Record<string, unknown>;
      const src = srcS;
      let changed = false;
      for (const k of Object.keys(src)) {
        // DW-082: the market levers follow even when the form lacks the key — a form seeded from the standing
        // plan has no "markets served" before the firm's first entry, so a teammate's entry this round never showed
        if (own.has(k) || k === "firm_id" || (!(k in next) && !MARKET_KEYS.has(k))) continue;
        if (prevS && prevS[k] === snapS[k]) continue;
        if (JSON.stringify(next[k]) !== snapS[k]) { next[k] = src[k]; changed = true; }
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
  // DW-077: the round that just resolved (0-based) — history's last entry; the pointer alone
  // stops on the final round.
  const lastResolved = view.history.length ? view.history[view.history.length - 1].own.round : view.round - 1;
  const [resolvedOpen, setResolvedOpen] = useState<number | null>(() => (!isWebdriver() && view.history.length > 0 && !isAcked(gameKey, lastResolved) ? lastResolved : null));
  useEffect(() => {
    if (seenRound.current === null) { seenRound.current = resolveSig; return; }
    if (resolveSig !== seenRound.current) {
      seenRound.current = resolveSig;
      setDest("review");
      setRtab("statements"); // the sheets first; the Dispatch tab carries a count when there is news
      // DW-077: the results page opens once per resolved round (never under an audit driver).
      if (!isWebdriver() && view.history.length > 0 && !isAcked(gameKey, lastResolved)) setResolvedOpen(lastResolved);
    }
  }, [resolveSig]);
  const dismissResolved = (then?: () => void) => { if (resolvedOpen != null) ack(gameKey, resolvedOpen); setResolvedOpen(null); then?.(); };
  // DW-077 calls: tickets in the commit panel while the round is open; the settled column on the results page.
  const roundOpen = view.lifecycle === "open" && view.ownActive && !view.complete;
  const callsDesk = useCallsDesk(calls, view.round, roundOpen);

  const myRank = view.standings.findIndex((s) => s.isYou) + 1;
  const hasHistory = view.history.length > 0;
  // DW-077 §A: the wire — every shock the student may know about, in seat-specific copy. The
  // takeover shows once per event per phase on the Decide view; the strip sits under the header
  // on every tab. `useUnseenWire` skips the takeover under automation (navigator.webdriver).
  const shownRound = Math.min(view.round + 1, view.nRounds);
  const wire = view.shocks.map((s) => eventCopy(s, mp ? seatRole : null, view));
  const { unseen, dismiss } = useUnseenWire(wire, mp ? gameId : gameKey); // solo: per run (DW-080)
  const takeover = dest === "decide" && view.ownActive && !view.complete && unseen.length > 0;
  const liveDeadline = !!deadlineAt && view.lifecycle === "open" && !view.complete;
  const now = useNow(liveDeadline);
  // DW-077 §B: seat identity — only a seated team player gets the plate, chips, edge and bar.
  const seated = mp && !!seatRole;
  const seatName = view.teamPlan?.seats.find((s) => s.me)?.name ?? "";
  useInlineModeToggle(); // the theme button lives in the header here (DW-078)
  const breweryChip = (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5">
      <span className="grid h-4 w-4 flex-none place-items-center rounded-[4px]" style={{ background: firmColor(view.own.id) }}>{firmEmblem(view.own.id) ? <Emblem id={firmEmblem(view.own.id)!} size={11} color="#fff" /> : <span className="text-[0.6rem] font-bold text-paper">{(view.names[view.own.id] ?? "B").charAt(0)}</span>}</span>
      <span className="truncate font-mono text-[0.6rem] font-bold uppercase tracking-wide text-ink">{view.names[view.own.id] ?? "Your Brewery"}</span>
    </span>
  );
  // Map = the city view when geography is in play; otherwise the demand/supply Market map.
  const cityEnabled = !!view.modules?.geography?.enabled && view.markets.length > 0;
  // Multiplayer: research is live only once the FIRM's submitted plan buys it (server truth) —
  // a ticked box previews nothing (it showed redacted zeros as if revealed). Solo previews.
  const infoActive = mp ? view.infoActive : (view.infoActive || infoPreview);
  const infoPending = mp && infoPreview && !view.infoActive;
  const detailSnapshot = detailFirm ? view.firms.find((f) => f.firm_id === detailFirm) ?? null : null;

  // DW-079: the pre-submit check is an in-app dialog (see SubmitConfirm) — resolves true on "Submit anyway".
  const [confirmAsk, setConfirmAsk] = useState<{ lines: string[]; done: (ok: boolean) => void } | null>(null);
  const askConfirm = (lines: string[]) => new Promise<boolean>((done) => setConfirmAsk({ lines, done }));
  // DW-080: a check left open across a resolve must never send last round's form into the new one —
  // close it (as "Go back") the moment the round or its state moves.
  const confirmRef = useRef(confirmAsk);
  confirmRef.current = confirmAsk;
  const roundRef = useRef(view.round);
  roundRef.current = view.round;
  useEffect(() => {
    const c = confirmRef.current;
    if (c) { c.done(false); setConfirmAsk(null); }
  }, [view.round, view.lifecycle]);

  const handlePlay = async (d0: FirmDecision) => {
    const formRound = view.round; // the round this form was built for (DW-080)
    // A bought report can't be returned. On a team the server holds the purchase (any chair buys it
    // for the firm — DW-081), so a seat's slice never re-claims it: the CEO read as having bought it too.
    let d = infoLocked && !d0.buy_info && !(mp && view.teamPlan) ? { ...d0, buy_info: true } : d0;
    let covers: Set<string> | undefined;
    if (mp && seatRole && view.teamPlan) {
      if (decision) d = keepUntouchedMarkets(view, d, decision, cityActions); // every seat, CEO included
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
        if (cityActions.supply) out.market_supply = cityActions.supply; // the drawer was edited (DW-082)
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
      // Last chance before the slice lands: disagreements this browser has not confirmed yet, spelled
      // out once (DW-077: confirming IS the acknowledgement — the commit panel keeps the rows in view
      // all round, so the dialog never repeats for the same lever and values).
      const open = openConflicts(computeConflicts(view, seatRole, d, standing));
      const off = offDeskEdits(view, seatRole, d, standing);
      if (open.length || off.length) {
        const T = (f: string, v: unknown) => leverText(f, v, view);
        // DW-082: against a teammate's build / hire / offer, your "none" is a cancel — the button says so
        const useYours = (c: { field: unknown; mine: unknown }) => cancelsRequest(String(c.field), c.mine) ? "press Cancel it in the commit panel to drop it" : "change it, or press Keep mine in the commit panel, to use yours";
        // Pre-ship review 10-29: a list (builds, hires, offers) REPLACES the teammate's — "Yours will be used" read as adding
        // to theirs, so a CEO who sited one more build dropped the CMO's unawares. Say what drops, and how to keep both.
        const drops = (c: { mine: unknown; theirs: unknown }, how: string) => (dropsTheirs(c.mine, c.theirs) ? ` Yours replaces theirs, so theirs is dropped — ${how}.` : "");
        const keepBoth = "to keep both, press Use theirs in the commit panel after this update";
        const lines = [
          ...open.slice(0, 6).map((c) => c.cover?.ownerName
            ? `${c.label}: ${c.who} suggested ${T(String(c.field), c.theirs)} for ${c.cover.ownerName}'s desk; you have ${T(String(c.field), c.mine)}. ${c.cover.decided ? `${c.cover.ownerName} decides — it's their desk.` : c.winner === "me" ? `${cancelsRequest(String(c.field), c.mine) ? "It's cancelled" : "Yours will be used"} unless ${c.cover.ownerName} changes it.${drops(c, keepBoth)}` : `Theirs will be used ${c.cover.sticks ? `unless ${c.cover.ownerName} cancels it` : `until ${c.cover.ownerName} submits`} — ${useYours(c)}.`}`
            : c.cover
            ? `${c.label}: ${c.who} set ${T(String(c.field), c.theirs)} for an empty desk; you have ${T(String(c.field), c.mine)}. ${c.winner === "me" ? (cancelsRequest(String(c.field), c.mine) ? "It's cancelled — as CEO you have the final say." : `Yours will be used — as CEO you have the final say.${drops(c, keepBoth)}`) : `Theirs will be used — ${useYours(c)}.`}`
            : `${c.label}: ${c.who} submitted ${T(String(c.field), c.theirs)}; you have ${T(String(c.field), c.mine)}. ${c.winner === "me" ? `Yours will be used — it's your desk.${drops(c, "talk to them first")}` : c.untouched ? "The CEO's will be used — you haven't changed it this round. Go back and press Keep mine in the commit panel to hold your number." : "Theirs will be used — it's their desk."}`),
          ...off.slice(0, 6).map((e) => `${e.label} is the ${e.deskOwner}'s desk${e.ownerName ? ` (${e.ownerName})` : e.ceoSeated ? " — empty, so the CEO covers it" : " — empty, no CEO seated"}. You set ${T(String(e.field), e.mine)}; the firm's plan has ${T(String(e.field), e.firm)}. ${e.applies ? (e.byCeo ? "The CEO has the final say on an empty desk — yours reaches them as a suggestion." : "Yours will be used, and the CEO will see it.")
            : e.sticks // playtest 10-29: a build / hire / offer survives the chair's silent submit — "<chair> decides" misled
              ? (e.wins ? `Yours goes into the plan unless ${e.ownerName} changes it or the CEO cancels it — it's their desk, so talk to them.`
                : e.byChair ? `${e.ownerName} set it — theirs is used.`
                : `${e.by ?? "A teammate"} ${e.gone ? "cancelled it" : "changed it"} — ${e.byCeo ? "the CEO's word stands" : "theirs stands"} unless ${e.ownerName} changes it.`)
            : `${e.ownerName ?? "The owner"} decides — yours is only a suggestion.`}`),
        ];
        if (!(await askConfirm(lines))) return;
        if (roundRef.current !== formRound) return; // the round moved while the check was open
        for (const c of open) ackConflict(c);
      }
    }
    // DW-077: the calls ride with the desk submit. Solo resolves the round inside onPlay, so its calls
    // must land first; in a class game the DESK goes first (DW-080) — a slow calls POST + refresh used
    // to hold the decision back, the one thing that must reach the server before the deadline.
    if (callsDesk.enabled && !mp) await callsDesk.flush();
    const landed = await onPlay(d, covers, formRound); // resolution effect navigates to Review
    if (landed !== false) { setEditedSinceSubmit(false); setSubmittedHere(true); }
    if (callsDesk.enabled && mp) await callsDesk.flush().catch(() => { /* the debounced save already sent each tap */ });
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
      {confirmAsk && <SubmitConfirm lines={confirmAsk.lines} onAnswer={(ok) => { confirmAsk.done(ok); setConfirmAsk(null); }} />}
      {seated && <SeatEdge role={seatRole!} />}
      {seated && <div className="-mx-3 -mt-4 mb-3 sm:hidden"><SeatMobileBar role={seatRole!} name={seatName} /></div>}
      {takeover && <EventTakeover events={unseen} role={mp ? seatRole : null} name={seatName} round={shownRound} deadlineAt={liveDeadline ? deadlineAt : null} onDismiss={dismiss} />}

      {resolvedOpen != null && (
        <RoundResolved view={view} round={resolvedOpen} mp={mp} seatRole={mp ? seatRole : null} calls={callsDesk.enabled ? callsDesk.data : null}
          onDismiss={() => dismissResolved(() => { if (view.complete || view.ownActive) setDest("decide"); })} // complete: the Decide tab IS the Season view ("SEE THE SEASON" used to land on Statements)
          onStatements={() => dismissResolved(() => { setDest("review"); setRtab("statements"); })}
          onDispatch={() => dismissResolved(() => { setDest("review"); setRtab("dispatch"); })} />
      )}

      {/* top bar (DW-078) — a slim utility line (difficulty · brewery · Return code · Leave · theme),
          then one row: round · seat plate + chips · the numbers. Below xl the plate drops to its own
          line under the round (it and the stats don't fit side by side); on a phone the seat bar
          above carries the seat, the clock rides the round line and the stats sit three-up. */}
      <header className="border-b border-line2 pb-3">
        <div className="flex min-w-0 items-center gap-2 pb-1">
          <div className="eyebrow min-w-0 truncate"><span className="hidden sm:inline">Drink Wars · </span>{view.difficulty}</div>
          <span className="hidden sm:inline-flex">{breweryChip}</span>
          <span className="flex-1" />
          {utilities}
          {onExit && <button onClick={onExit} className={UTIL_BTN}>Leave</button>}
          <ModeToggle inline />
        </div>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="min-w-0 basis-full sm:basis-auto">
            <div className="flex items-baseline gap-3">
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
              {liveDeadline && <span className="ml-auto font-mono text-lg font-semibold text-ink sm:hidden" title="Round closes" data-round-closes-mobile>{fmtClock(deadlineAt! - now)}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex max-w-full sm:hidden">{breweryChip}</span>
              {view.segments.filter((s) => s.active).map((s) => (
                <Tag key={s.id} tone="copper">{SEG_TAG[s.id] ?? s.id}</Tag>
              ))}
              {/* DW-077: the shock pills that used to sit here are now the wire strip below the header. */}
            </div>
          </div>
          {seated && <div className="order-3 hidden min-w-0 basis-full sm:block xl:order-none xl:basis-auto"><SeatPlate role={seatRole!} name={seatName} seats={view.seats} /></div>}
          {/* Phone: Cash · Capacity · Rank three-up. Wider: a right-aligned run of stats that thins
              where the seat plate shares the row (xl) and fills back in at 2xl. */}
          <div className="order-2 grid w-full grid-cols-3 gap-x-3 sm:ml-auto sm:flex sm:w-auto sm:flex-wrap sm:items-start sm:justify-end sm:gap-x-6 xl:order-none">
            <Stat label="Cash" value={fmt.money(view.own.cash)} accent={view.own.cash < 300 ? "brick" : "ink"} />
            <span className={seated ? "sm:hidden md:block xl:hidden 2xl:block" : "sm:hidden md:block"}><Stat label="Capacity" value={fmt.int(view.own.cap)} sub="drinks/rd" /></span>
            {view.ownResult && (
              <span className={seated ? "hidden lg:block xl:hidden 2xl:block" : "hidden lg:block"}>
                <Stat label="Net income" value={fmt.signed(view.ownResult.pnl.net_income)} accent={view.ownResult.pnl.net_income < 0 ? "brick" : "ink"} />
              </span>
            )}
            <Stat label="Your rank" value={myRank > 0 ? `#${myRank}` : "—"} accent="copper" sub={view.ownActive ? undefined : "exited"} />
            {liveDeadline && (
              <div className="hidden rounded-[10px] border border-line px-3 py-1.5 text-right sm:block" data-round-closes>
                <div className="text-[0.62rem] uppercase tracking-[0.14em] text-inksoft">Round closes</div>
                <div className="font-mono text-lg font-semibold leading-tight text-ink">{fmtClock(deadlineAt! - now)}</div>
              </div>
            )}
          </div>
        </div>
      </header>
      {/* DW-077 §A: the wire strip — full-width under the header, on every tab. */}
      <div className="-mx-3 mb-3 sm:-mx-5"><WireStrip events={wire} /></div>

      {notices}
      {banner && <div className="mb-3 rounded-lg border px-3 py-2 text-sm text-inksoft" style={{ borderColor: mp && view.ownActive && !view.complete ? "var(--color-copper)" : "var(--color-line2)" }}>{banner}</div>}
      {/* (DW-078: the "You're the CEO — your levers compose…" line that sat here is gone — the seat
          plate / phone seat bar, the desk card's "Your seat" chip and the commit panel all say it.) */}

      {/* tab row — three pills directly below the HUD (design: Decide · Review · City & Globe) */}
      <nav data-dw-tabs className="sticky top-0 z-20 -mx-3 mb-4 flex gap-1.5 overflow-x-auto border-b border-line2 bg-paper/85 px-3 py-2 backdrop-blur sm:-mx-5 sm:px-5">
        {nav.map((n) => navPill(n))}
      </nav>

      {/* destination */}
      <main className="min-w-0">
          {dest === "map" && (cityEnabled
            ? <CityView view={view} actions={cityActions} setActions={editCity} onInspect={setDetailFirm} extraBuilds={decision?.build_facilities ?? []} extraOwn={buildsMine} onWithdrawBuild={withdrawBuild} carriedSupply={decision?.market_supply} />
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
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="min-w-0">
                {view.ownActive && !view.complete && (
                  <div className="mb-4">
                    <DeskCockpit desk={desk} view={view} seatRole={seatRole} rationale={rationale[desk] ?? ""} onRationale={(v) => setRationale((p) => ({ ...p, [desk]: v }))} />
                  </div>
                )}
                {view.ownActive && !view.complete && (
                  <DecisionForm view={view} defaultDecision={defaultDecision} onPlay={handlePlay} busy={busy} infoCost={infoCost} onInfoChange={onInfoChange} infoLocked={infoLocked} poaches={poaches} onPoach={queuePoach} cityActions={cityActions} decision={decision} setDecision={editDecision} unsent={unsent} onEdited={markEdited} desk={desk} submitLabel={submitLabel} footerNote={footerNote} seatRole={mp ? seatRole : null} standing={standing}
                    callsSlot={callsDesk.enabled ? <CallsTickets desk={callsDesk} round={view.round} open={roundOpen} /> : undefined} callsCount={callsDesk.enabled ? callsDesk.count : undefined} />
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
              <div className="grid min-w-0 grid-cols-1 content-start gap-4 lg:sticky lg:top-[4.25rem] lg:max-h-[calc(100vh-5.25rem)] lg:self-start lg:overflow-y-auto">
                <Standings view={view} onSelect={setDetailFirm} />
                {/* The Round Table is a TEAM surface (who has submitted, the composed plan). Alone at
                    the controls it only repeats the desk chips above the form, so solo play skips it. */}
                {view.ownActive && !view.complete && mp && seatRole && (
                  <RoundTable view={view} rationale={rationale} seatRole={seatRole} standing={standing} onFocusDesk={setDesk} />
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
              {/* sticky from sm up only — on a phone this wrapped row plus the tab bar held ~25% of the screen (DW-080) */}
              <div className="z-[5] flex flex-wrap items-center gap-2.5 rounded-t-[14px] border-b border-line bg-panel px-4 py-2.5 sm:sticky sm:top-[3.25rem]">
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
