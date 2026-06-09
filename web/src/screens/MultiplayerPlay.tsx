import { useCallback, useEffect, useRef, useState } from "react";
import type { FirmDecision } from "drinkwars-engine";
import type { RawView, StudentClient } from "../game/multiplayer.js";
import { Button, Card, Eyebrow, Stat, Tag } from "../components/ui.js";
import { DecisionForm } from "../components/DecisionForm.js";
import { Diagnostics } from "../components/Diagnostics.js";
import { Standings } from "../components/Standings.js";
import { SEG_TAG, fmt } from "../labels.js";

type Tab = "decide" | "last" | "standings";

/** Student multiplayer screen: polls the transport, reuses DecisionForm /
 *  Diagnostics / Standings, and reflects the instructor-driven lifecycle. */
export function MultiplayerPlay({ client, onExit }: { client: StudentClient; onExit: () => void }) {
  const [raw, setRaw] = useState<RawView | null>(client.raw());
  const [tab, setTab] = useState<Tab>("decide");
  const [busy, setBusy] = useState(false);

  const everLoaded = useRef(false);
  useEffect(() => {
    let live = true;
    const tick = async () => {
      try {
        const v = await client.fetchView();
        if (!live) return;
        everLoaded.current = true;
        setRaw({ ...v });
      } catch {
        // A restored session that never loads is dead (game ended/expired) — drop it.
        if (live && !everLoaded.current) {
          client.clearSaved();
          onExit();
        }
        // otherwise a transient blip — keep the last view
      }
    };
    tick();
    const h = setInterval(tick, 2500);
    return () => {
      live = false;
      clearInterval(h);
    };
  }, [client, onExit]);

  const defaultDecision = useCallback(() => client.defaultDecision(), [client, raw?.round]);
  const submit = useCallback(
    async (d: FirmDecision) => {
      setBusy(true);
      try {
        await client.submit(d);
        setRaw({ ...(await client.fetchView()) });
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  if (!raw) return <div className="p-8 text-inksoft">Connecting to the game…</div>;
  const view = client.toGameView(raw);
  const open = view.lifecycle === "open" && view.ownActive && !view.complete;
  const banner = view.complete
    ? "Season complete."
    : !view.ownActive
      ? "Your brewery has exited the market — watch the shakeout."
      : view.lifecycle === "open"
        ? raw.submitted
          ? "Submitted. You can revise until the instructor locks the round."
          : "Round open — set your decision and submit."
        : "Round locked — waiting for the instructor to resolve…";

  const tabs: { id: Tab; label: string; disabled: boolean }[] = [
    { id: "decide", label: "Decide", disabled: false },
    { id: "last", label: "Last round", disabled: !view.ownResult },
    { id: "standings", label: "Standings", disabled: view.standings.length === 0 },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-line2 pb-4">
        <div>
          <div className="eyebrow">Drink Wars · multiplayer</div>
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
        <div className="flex items-center gap-6">
          {view.own && <Stat label="Cash" value={fmt.money(view.own.cash)} accent={view.own.cash < 300 ? "brick" : "ink"} />}
          {view.own && <Stat label="Tanks" value={fmt.int(view.own.cap)} />}
          <Button variant="ghost" onClick={() => { client.clearSaved(); onExit(); }}>Leave</Button>
        </div>
      </header>

      <div className={`mb-4 border px-3 py-2 text-sm ${raw.submitted || !open ? "border-line text-inksoft" : "border-copper text-copperdeep"}`}>{banner}</div>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            disabled={t.disabled}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 font-mono text-sm tracking-wide transition-colors disabled:opacity-30 ${tab === t.id ? "border-copper text-copperdeep" : "border-transparent text-inksoft hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "decide" &&
        (open ? (
          <DecisionForm
            view={view}
            defaultDecision={defaultDecision}
            onPlay={submit}
            busy={busy}
            infoCost={client.infoCost()}
            submitLabel={raw.submitted ? "Update my decision" : `Submit decision (round ${view.round + 1})`}
            footerNote="Your classmates (and adaptive NPCs in any open slots) brew at the same time. The instructor resolves the round."
          />
        ) : (
          <Card>
            <Eyebrow>{view.complete ? "Season complete" : "Standing by"}</Eyebrow>
            <p className="mt-1 text-sm text-inksoft">{banner}</p>
          </Card>
        ))}

      {tab === "last" && (view.ownResult ? <Diagnostics result={view.ownResult} view={view} /> : <Card>No resolved round yet.</Card>)}
      {tab === "standings" && <Standings view={view} />}
    </div>
  );
}
