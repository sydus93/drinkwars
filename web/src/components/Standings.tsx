import type { GameView } from "../game/controller.js";
import { Card, Eyebrow, Tag } from "./ui.js";

const STATUS_TONE: Record<string, "ink" | "hop" | "brick" | "copper"> = {
  active: "hop",
  bankrupt: "brick",
  exited_banked: "ink",
  exited_invested: "copper",
  exited_rebuilt: "copper",
};

export function Standings({ view }: { view: GameView }) {
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
      <div className="grid gap-1.5">
        {view.standings.map((s, i) => (
          <div key={s.firm_id} className={`flex items-center gap-2 rounded-[2px] px-2 py-1 ${s.isYou ? "bg-panel2" : ""}`}>
            <span className="tnum w-5 text-right text-sm text-inksoft">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={`truncate text-sm ${s.isYou ? "font-bold text-copperdeep" : ""}`}>{s.name}</span>
                {s.isYou && <Tag tone="copper">You</Tag>}
                {s.status !== "active" && <Tag tone={STATUS_TONE[s.status] ?? "ink"}>{s.status.replace("exited_", "")}</Tag>}
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-[2px] bg-line">
                <div className="h-full" style={{ width: `${((s.score - lo) / span) * 100}%`, background: s.isYou ? "var(--color-copper)" : "var(--color-inksoft)" }} />
              </div>
            </div>
            <span className="tnum w-14 text-right text-sm">{s.score.toFixed(3)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
