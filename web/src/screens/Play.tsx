import { useEffect, useRef, useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_TAG, fmt } from "../labels.js";
import { Button, Card, Eyebrow, Stat, Tag } from "../components/ui.js";
import { DecisionForm } from "../components/DecisionForm.js";
import { Diagnostics } from "../components/Diagnostics.js";
import { Standings } from "../components/Standings.js";
import { Events } from "../components/Events.js";
import { RoundReport } from "../components/RoundReport.js";
import { FirmDetail } from "../components/FirmDetail.js";
import { type GameEvent } from "../components/EventModal.js";
import { parseEvents } from "../components/eventFeed.js";
import { Boardroom } from "../components/Boardroom.js";
import { Sparkline } from "../components/Sparkline.js";
import { Trends } from "../components/Trends.js";
import { Field } from "../components/Field.js";

type Tab = "decision" | "last" | "trends" | "field";

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
  const [tab, setTab] = useState<Tab>("decision");
  const [infoPreview, setInfoPreview] = useState(false);
  // End-of-round briefing: when a round resolves, all its dispatches surface as
  // ONE categorized outline (RoundReport) before settling into the rail.
  const [report, setReport] = useState<{ round: number; events: GameEvent[] } | null>(null);
  const [detailFirm, setDetailFirm] = useState<string | null>(null);
  const seenRound = useRef<number | null>(null);

  // New game (no results yet) → start on the decision tab.
  useEffect(() => {
    if (!view.result) setTab("decision");
  }, [view.result]);
  // Reset the live intel preview each new round.
  useEffect(() => {
    setInfoPreview(false);
  }, [view.round]);
  // Surface this round's events on each resolution (not on first mount / replays).
  // Keyed on resolved-round COUNT, not the round pointer — the pointer stops
  // advancing on the final round, but history still grows by one.
  const resolved = view.history.length;
  useEffect(() => {
    if (seenRound.current === null) { seenRound.current = resolved; return; }
    if (resolved !== seenRound.current) {
      seenRound.current = resolved;
      if (view.events.length) setReport({ round: resolved, events: parseEvents(view.events, view.names[view.own.id] ?? "") });
    }
  }, [resolved, view.events]);

  const myRank = view.standings.findIndex((s) => s.isYou) + 1;
  const hasHistory = view.history.length > 0;
  const infoActive = view.infoActive || infoPreview;
  const detailSnapshot = detailFirm ? view.firms.find((f) => f.firm_id === detailFirm) ?? null : null;

  const handlePlay = async (d: FirmDecision) => {
    await onPlay(d);
    setTab("last");
  };

  const tabs: { id: Tab; label: string; disabled?: boolean }[] = [
    { id: "decision", label: view.complete ? "Season over" : `Decide R${view.round + 1}` },
    { id: "last", label: "Last round", disabled: !view.ownResult },
    { id: "trends", label: "Trends", disabled: !hasHistory },
    { id: "field", label: "Field & intel", disabled: !hasHistory },
  ];

  return (
    <div className="mx-auto max-w-[1720px] px-4 py-6 sm:px-6">
      {report && (
        <RoundReport
          round={report.round}
          events={report.events}
          final={view.complete}
          onClose={() => setReport(null)}
        />
      )}
      {detailSnapshot && (
        <FirmDetail firm={detailSnapshot} view={view} infoActive={infoActive} onClose={() => setDetailFirm(null)} />
      )}
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-line2 pb-4">
        <div>
          <div className="eyebrow">Drink Wars · {view.difficulty}</div>
          <h1 className="display text-3xl font-semibold">
            Round <span className="text-copper">{Math.min(view.round + 1, view.nRounds)}</span>
            <span className="text-inksoft"> / {view.nRounds}</span>
          </h1>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {view.segments.filter((s) => s.active).map((s) => (
              <Tag key={s.id} tone="copper">{SEG_TAG[s.id] ?? s.id}</Tag>
            ))}
          </div>
        </div>
        <div className="flex gap-6">
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

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            disabled={t.disabled}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 font-mono text-sm tracking-wide transition-colors disabled:opacity-30 ${
              tab === t.id ? "border-copper text-copperdeep" : "border-transparent text-inksoft hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          {tab === "decision" && view.ownActive && !view.complete && (
            <DecisionForm view={view} defaultDecision={defaultDecision} onPlay={handlePlay} busy={busy} infoCost={infoCost} onInfoChange={setInfoPreview} />
          )}
          {tab === "decision" && !view.ownActive && !view.complete && (
            <Card>
              <Eyebrow>Forced exit</Eyebrow>
              <p className="text-sm text-ink">Your brewery ran out of road. Keep watching the shakeout, or start a new run.</p>
              <div className="mt-3 flex gap-2">
                <Button variant="go" onClick={() => handlePlay({} as FirmDecision)} disabled={busy}>{busy ? "…" : "Watch next round →"}</Button>
                <Button variant="ghost" onClick={onReset}>New brewery</Button>
              </div>
            </Card>
          )}
          {tab === "decision" && view.complete && <SeasonOver view={view} rank={myRank} onReset={onReset} />}

          {tab === "last" && (
            <div className="grid gap-4">
              {view.complete && <SeasonOver view={view} rank={myRank} onReset={onReset} />}
              {view.ownResult ? <Diagnostics result={view.ownResult} view={view} /> : <Card>No diagnostics yet.</Card>}
              {!view.complete && view.ownActive && (
                <div className="flex justify-end">
                  <Button variant="go" onClick={() => setTab("decision")} disabled={busy} className="px-6 py-3 text-base">Next round →</Button>
                </div>
              )}
            </div>
          )}

          {tab === "trends" && <Trends view={view} />}
          {tab === "field" && <Field view={view} infoActive={infoActive} onInspect={setDetailFirm} />}
        </div>

        {/* Persistent rail — pinned on desktop so standings/dispatches stay in view */}
        <div className="grid content-start gap-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
          <Standings view={view} onSelect={setDetailFirm} />
          {view.briefings.length > 0 && <Boardroom briefings={view.briefings} />}
          {view.history.length > 1 && (
            <Card>
              <Eyebrow>Season pulse</Eyebrow>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between text-[0.72rem] text-inksoft">
                  <span>Cash</span>
                  <Sparkline values={view.history.map((h) => h.own.cash)} />
                </div>
                <div className="flex items-center justify-between text-[0.72rem] text-inksoft">
                  <span>Score</span>
                  <Sparkline values={view.history.map((h) => h.own.score)} color="var(--color-copper)" />
                </div>
                <div className="flex items-center justify-between text-[0.72rem] text-inksoft">
                  <span>Net income</span>
                  <Sparkline values={view.history.map((h) => h.own.netIncome)} />
                </div>
              </div>
            </Card>
          )}
          <Events events={view.events} />
        </div>
      </div>
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
