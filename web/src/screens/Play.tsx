import { useEffect, useRef, useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_TAG, SHOCK_META, fmt } from "../labels.js";
import { Button, Card, Eyebrow, Stat, Tag } from "../components/ui.js";
import { DecisionForm } from "../components/DecisionForm.js";
import { Diagnostics } from "../components/Diagnostics.js";
import { Standings } from "../components/Standings.js";
import { Events } from "../components/Events.js";
import { FirmDetail } from "../components/FirmDetail.js";
import { parseEvents } from "../components/eventFeed.js";
import { Boardroom } from "../components/Boardroom.js";
import { Sparkline } from "../components/Sparkline.js";
import { Trends } from "../components/Trends.js";
import { Field } from "../components/Field.js";
import { MarketMap } from "../components/MarketMap.js";
import { CityView } from "../components/CityView.js";
import { TapDispatch } from "../components/TapDispatch.js";
import { Emblem } from "../components/FacilityGlyph.js";
import { firmColor, playerEmblem } from "../lib/teamColors.js";
import { emptyCityActions, type CityActions } from "../game/cityActions.js";

/** Primary destinations (design: Review · Decide · Map). Distribution is a drawer
 *  inside Map / a panel inside Decide, NOT a destination. */
type Dest = "review" | "decide" | "map";
type RTab = "dispatch" | "trends" | "field";

const NAV_ICON: Record<Dest, JSX.Element> = {
  review: <path d="M4 5h13v14H5a1 1 0 0 1-1-1ZM17 8h3v9a2 2 0 0 1-2 2M7 8h7M7 11h7M7 14h4" />,
  decide: <><path d="M4 7h16M4 12h16M4 17h16" /><circle cx="9" cy="7" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="7" cy="17" r="2" /></>,
  map: <><path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" /><path d="M9 4v14M15 6v14" /></>,
};

export function Play({
  view,
  busy,
  infoCost,
  onPlay,
  defaultDecision,
  onReset,
}: {
  view: GameView;
  busy: boolean;
  infoCost: number;
  onPlay: (d: FirmDecision) => Promise<void> | void;
  defaultDecision: () => Promise<FirmDecision>;
  onReset: () => void;
}) {
  const [dest, setDest] = useState<Dest>("decide");
  const [rtab, setRtab] = useState<RTab>("dispatch");
  const [infoPreview, setInfoPreview] = useState(false);
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
  const seenRound = useRef<number | null>(null);

  // New game (no results yet) → start on Decide.
  useEffect(() => {
    if (!view.result) setDest("decide");
  }, [view.result]);
  // Reset live intel preview + queued raids + decision draft each new round.
  useEffect(() => {
    setInfoPreview(false);
    setPoaches([]);
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
  // On each resolution, surface the round in Review (the Tap Dispatch) — replaces the
  // old one-popup-per-event queue. Keyed on resolved-round COUNT (the round pointer
  // stops on the final round, but history still grows by one).
  const resolved = view.history.length;
  useEffect(() => {
    if (seenRound.current === null) { seenRound.current = resolved; return; }
    if (resolved !== seenRound.current) {
      seenRound.current = resolved;
      setDest("review");
      setRtab("dispatch");
    }
  }, [resolved]);

  const myRank = view.standings.findIndex((s) => s.isYou) + 1;
  const hasHistory = view.history.length > 0;
  // Map = the city view when geography is in play; otherwise the demand/supply Market map.
  const cityEnabled = !!view.modules?.geography?.enabled && view.markets.length > 0;
  const infoActive = view.infoActive || infoPreview;
  const detailSnapshot = detailFirm ? view.firms.find((f) => f.firm_id === detailFirm) ?? null : null;

  const handlePlay = async (d: FirmDecision) => {
    await onPlay(d); // resolution effect navigates to Review
  };

  const nav: { id: Dest; label: string }[] = [
    { id: "review", label: "Review" },
    { id: "decide", label: view.complete ? "Season" : "Decide" },
    { id: "map", label: "Map" },
  ];

  const navBtn = (n: { id: Dest; label: string }, vertical: boolean) => {
    const active = dest === n.id;
    return (
      <button
        key={n.id}
        onClick={() => setDest(n.id)}
        className={`flex items-center justify-center gap-2 rounded-[11px] border transition-colors ${vertical ? "flex-col px-1 py-2.5" : "flex-1 px-3 py-2"}`}
        style={{ borderColor: active ? "var(--color-line)" : "transparent", background: active ? "var(--color-panel)" : "transparent", color: active ? "var(--color-copperdeep)" : "var(--color-inksoft)", boxShadow: active ? "inset 0 1px 0 rgba(255,255,255,.6),0 1px 0 var(--color-line2)" : undefined }}
      >
        <svg viewBox="0 0 24 24" width={vertical ? 21 : 18} height={vertical ? 21 : 18} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">{NAV_ICON[n.id]}</svg>
        <span className={`font-mono uppercase tracking-[0.04em] ${vertical ? "text-[0.5rem]" : "text-[0.62rem]"} font-bold`}>{n.label}</span>
      </button>
    );
  };

  return (
    <div className="mx-auto max-w-[1720px] px-3 py-4 pb-24 sm:px-5 lg:pb-4">
      {detailSnapshot && (
        <FirmDetail firm={detailSnapshot} view={view} infoActive={infoActive} poaches={poaches} onPoach={queuePoach} onClose={() => setDetailFirm(null)} />
      )}

      {/* top bar */}
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line2 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="eyebrow">Drink Wars · {view.difficulty}</div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5">
              <span className="grid h-4 w-4 place-items-center rounded-[4px]" style={{ background: firmColor(view.own.id) }}>{playerEmblem() ? <Emblem id={playerEmblem()!} size={11} color="#fff" /> : <span className="text-[0.6rem] font-bold text-paper">{(view.names[view.own.id] ?? "B").charAt(0)}</span>}</span>
              <span className="font-mono text-[0.6rem] font-bold uppercase tracking-wide text-ink">{view.names[view.own.id] ?? "Your Brewery"}</span>
            </span>
          </div>
          <h1 className="display text-2xl font-semibold sm:text-3xl">
            Round <span className="text-copper">{Math.min(view.round + 1, view.nRounds)}</span>
            <span className="text-inksoft"> / {view.nRounds}</span>
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
        <div className="flex gap-5 sm:gap-6">
          <Stat label="Cash" value={fmt.money(view.own.cash)} accent={view.own.cash < 300 ? "brick" : "ink"} />
          <Stat label="Tanks" value={fmt.int(view.own.cap)} />
          {view.ownResult && (
            <span className="hidden sm:block">
              <Stat label="Net income" value={fmt.signed(view.ownResult.pnl.net_income)} accent={view.ownResult.pnl.net_income < 0 ? "brick" : "ink"} />
            </span>
          )}
          <Stat label="Your rank" value={myRank > 0 ? `#${myRank}` : "—"} accent="copper" sub={view.ownActive ? undefined : "exited"} />
        </div>
      </header>

      <div className="flex gap-4">
        {/* desktop nav rail */}
        <nav className="sticky top-4 hidden h-max w-[78px] flex-none flex-col gap-1.5 rounded-[14px] border border-line2 bg-panel/50 p-2 lg:flex">
          {nav.map((n) => navBtn(n, true))}
        </nav>

        {/* destination */}
        <main className="min-w-0 flex-1">
          {dest === "map" && (cityEnabled
            ? <CityView view={view} actions={cityActions} setActions={setCityActions} onInspect={setDetailFirm} />
            : <MarketMap view={view} onInspect={setDetailFirm} />)}

          {dest === "decide" && (
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
              <div className="min-w-0">
                {view.ownActive && !view.complete && (
                  <DecisionForm view={view} defaultDecision={defaultDecision} onPlay={handlePlay} busy={busy} infoCost={infoCost} onInfoChange={setInfoPreview} poaches={poaches} onPoach={queuePoach} cityActions={cityActions} decision={decision} setDecision={setDecision} />
                )}
                {!view.ownActive && !view.complete && (
                  <Card>
                    <Eyebrow>Forced exit</Eyebrow>
                    <p className="text-sm text-ink">Your brewery ran out of road. Keep watching the shakeout, or start a new run.</p>
                    <div className="mt-3 flex gap-2">
                      <Button variant="go" onClick={() => handlePlay({} as FirmDecision)} disabled={busy}>{busy ? "…" : "Watch next round →"}</Button>
                      <Button variant="ghost" onClick={onReset}>New brewery</Button>
                    </div>
                  </Card>
                )}
                {view.complete && <SeasonOver view={view} rank={myRank} onReset={onReset} />}
              </div>
              <div className="grid content-start gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
                <Standings view={view} onSelect={setDetailFirm} />
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
          )}

          {dest === "review" && (
            <div className="rounded-[14px] border border-line2 bg-panel/40">
              <div className="sticky top-0 z-[5] flex flex-wrap items-center gap-2.5 rounded-t-[14px] border-b border-line bg-panel px-4 py-2.5">
                <span className="display text-base font-extrabold uppercase text-ink">Review</span>
                <div className="inline-flex gap-0.5 rounded-[9px] border border-line2 bg-panel2 p-0.5">
                  {([["dispatch", "Dispatch"], ["trends", "Trends"], ["field", "Field & Intel"]] as [RTab, string][]).map(([id, label]) => (
                    <button key={id} disabled={(id !== "dispatch") && !hasHistory} onClick={() => setRtab(id)} className="rounded-[7px] px-3 py-1.5 font-mono text-[0.62rem] uppercase tracking-wide transition-colors disabled:opacity-30" style={{ background: rtab === id ? "var(--color-panel)" : "transparent", color: rtab === id ? "var(--color-copperdeep)" : "var(--color-inksoft)", fontWeight: rtab === id ? 700 : 500, boxShadow: rtab === id ? "inset 0 1px 0 rgba(255,255,255,.6),0 1px 0 var(--color-line2)" : undefined }}>{label}</button>
                  ))}
                </div>
                <span className="flex-1" />
                <span className="hidden font-mono text-[0.6rem] uppercase text-inksoft sm:inline">{resolved > 0 ? `After round ${resolved}` : "Season opening"}</span>
              </div>
              <div className="p-4">
                {rtab === "dispatch" && (
                  <div className="grid gap-5">
                    {view.complete && <SeasonOver view={view} rank={myRank} onReset={onReset} />}
                    <TapDispatch
                      view={view}
                      round={Math.max(resolved, 1)}
                      footer={!view.complete && view.ownActive ? (
                        <>
                          <span className="font-body flex-1 text-[0.72rem] italic text-inksoft">Dispatches stay in your rail all season. The numbers behind the round are below.</span>
                          <Button variant="go" onClick={() => setDest("decide")}>On to round {Math.min(view.round + 1, view.nRounds)} →</Button>
                        </>
                      ) : undefined}
                    />
                    {view.ownResult && (
                      <div>
                        <div className="mb-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-copperdeep">The round in numbers</div>
                        <Diagnostics result={view.ownResult} view={view} />
                      </div>
                    )}
                  </div>
                )}
                {rtab === "trends" && (hasHistory ? <Trends view={view} /> : <Card>Trends open once a round has resolved.</Card>)}
                {rtab === "field" && (hasHistory ? <Field view={view} infoActive={infoActive} onInspect={setDetailFirm} /> : <Card>Field intel opens once a round has resolved.</Card>)}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-1 border-t border-line2 bg-panel/95 px-3 py-2 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}>
        {nav.map((n) => navBtn(n, false))}
      </nav>
    </div>
  );
}

function SeasonOver({ view, rank, onReset }: { view: GameView; rank: number; onReset: () => void }) {
  return (
    <Card className="rise">
      <Eyebrow>Season complete</Eyebrow>
      <h2 className="display text-2xl font-semibold">
        {rank === 1 ? "You finished first." : rank > 0 ? `You finished #${rank} of ${view.standings.length}.` : "Your run has ended."}
      </h2>
      <p className="mt-1 text-sm text-inksoft">Sustained scorecard rewards advantage held across the whole season, not a final-round spike.</p>
      <div className="mt-3"><Button variant="go" onClick={onReset}>Play again</Button></div>
    </Card>
  );
}
