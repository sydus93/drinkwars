import { Fragment } from "react";
import type { GameView } from "../game/controller.js";
import { Card, Eyebrow, Tag } from "./ui.js";
import { inContention } from "drinkwars-engine";
import { firmColor } from "../lib/teamColors.js";

const STATUS_TONE: Record<string, "ink" | "hop" | "brick" | "copper"> = {
  active: "hop",
  bankrupt: "brick",
  exited_banked: "ink",
  exited_invested: "copper",
  exited_rebuilt: "copper",
};

const STATUS_LABEL: Record<string, string> = {
  bankrupt: "Bankrupt",
  exited_banked: "Cashed out",
  exited_invested: "Turned investor",
  exited_rebuilt: "Rebuilt",
  acquired: "Acquired",
};

export function Standings({ view, onSelect }: { view: GameView; onSelect?: (firmId: string) => void }) {
  if (!view.standings.length) {
    return (
      <Card>
        <Eyebrow>Standings</Eyebrow>
        <div className="text-sm text-inksoft">Brew your first round to see where you stand.</div>
      </Card>
    );
  }
  const scores = view.standings.map((s) => s.score);
  const lo = Math.min(...scores, 0);
  const hi = Math.max(...scores, 0.01);
  const span = hi - lo || 1;

  return (
    <Card>
      <Eyebrow>Standings — Sustained Scorecard</Eyebrow>
      {/* grid-cols-1 = minmax(0,1fr): a long brewery name truncates instead of widening the row
          past the card (it pushed the page to 404px on a phone and hid the scores on desktop). */}
      <div className="grid grid-cols-1 gap-1.5">
        {view.standings.map((s, i) => {
          const clickable = !!onSelect;
          const Inner = (
            <>
              <span className="tnum w-5 text-right text-sm text-inksoft">{i + 1}</span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: firmColor(s.firm_id) }} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`truncate text-sm ${s.isYou ? "font-bold text-copperdeep" : ""}`}>{s.name}</span>
                  {s.isYou && <Tag tone="copper">You</Tag>}
                  {s.status !== "active" && <Tag tone={STATUS_TONE[s.status] ?? "ink"}>{STATUS_LABEL[s.status] ?? s.status}</Tag>}
                </div>
                <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-[2px] bg-line">
                  <div className="h-full" style={{ width: `${((s.score - lo) / span) * 100}%`, background: s.isYou ? "var(--color-copper)" : "var(--color-inksoft)" }} />
                </div>
              </div>
              <span className="tnum w-14 flex-none text-right text-sm">{s.score.toFixed(3)}</span>
            </>
          );
          // DW-071: you have to survive to win — firms that have left the game rank below every
          // firm still trading (server-side order), and the line between them is drawn.
          const divider = i > 0 && !inContention(s.status) && inContention(view.standings[i - 1].status)
            ? <div className="mt-1 border-t border-line2 pt-1 text-[0.62rem] uppercase tracking-[0.08em] text-inksoft">Out of contention — you have to survive to win</div>
            : null;
          return <Fragment key={s.firm_id}>{divider}{clickable ? (
            <button
              key={s.firm_id}
              onClick={() => onSelect!(s.firm_id)}
              title="Open dossier"
              className={`flex min-w-0 items-center gap-2 rounded-[2px] px-2 py-1 text-left transition-colors hover:bg-panel2 ${s.isYou ? "bg-panel2" : ""}`}
            >
              {Inner}
            </button>
          ) : (
            <div key={s.firm_id} className={`flex min-w-0 items-center gap-2 rounded-[2px] px-2 py-1 ${s.isYou ? "bg-panel2" : ""}`}>
              {Inner}
            </div>
          )}</Fragment>;
        })}
      </div>
      {onSelect && <div className="mt-1.5 text-[0.64rem] text-inksoft">Tap any brewery for its dossier.</div>}
    </Card>
  );
}
