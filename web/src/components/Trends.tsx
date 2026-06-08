import type { GameView } from "../game/controller.js";
import { fmt } from "../labels.js";
import { Card, Eyebrow } from "./ui.js";
import { LineChart, Legend, type Series } from "./charts.js";

const COPPER = "#b5632b";
const HOP = "#5d7c44";
const INK = "#6a5d4f";
const GOLD = "#c2912f";

export function Trends({ view }: { view: GameView }) {
  const h = view.history;
  if (h.length === 0) {
    return (
      <Card>
        <Eyebrow>Trends</Eyebrow>
        <div className="text-sm text-inksoft">Play a round to start charting your trajectory over the season.</div>
      </Card>
    );
  }

  const scoreSeries: Series[] = [
    { label: "You", color: COPPER, data: h.map((r) => r.own.score) },
    { label: "Field top", color: INK, data: h.map((r) => r.field.topScore) },
    { label: "Field median", color: HOP, data: h.map((r) => r.field.medianScore) },
  ];
  const cashSeries: Series[] = [{ label: "Cash", color: COPPER, data: h.map((r) => r.own.cash) }];
  const shareSeries: Series[] = [{ label: "Total share", color: COPPER, data: h.map((r) => r.own.share) }];
  const qbSeries: Series[] = [
    { label: "Recipe quality", color: HOP, data: h.map((r) => r.own.Q) },
    { label: "Brand", color: GOLD, data: h.map((r) => r.own.B) },
  ];
  const niSeries: Series[] = [{ label: "Net income", color: COPPER, data: h.map((r) => r.own.netIncome) }];

  const last = h.at(-1)!;
  const charts: { title: string; series: Series[]; fmt: (n: number) => string; zero?: boolean }[] = [
    { title: "Cumulative score vs field", series: scoreSeries, fmt: (n) => n.toFixed(2), zero: true },
    { title: "Cash on hand", series: cashSeries, fmt: fmt.money },
    { title: "Net income / round", series: niSeries, fmt: fmt.money, zero: true },
    { title: "Total market share", series: shareSeries, fmt: fmt.pct },
    { title: "Quality & brand (durable capital)", series: qbSeries, fmt: (n) => n.toFixed(0) },
  ];

  return (
    <div className="grid gap-4">
      <Card>
        <Eyebrow>This Season So Far</Eyebrow>
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-5">
          {[
            { l: "Rounds played", v: String(h.length) },
            { l: "Best rank", v: `#${Math.min(...h.map((r) => r.own.rank))}` },
            { l: "Peak cash", v: fmt.money(Math.max(...h.map((r) => r.own.cash))) },
            { l: "Score now", v: last.own.score.toFixed(2) },
            { l: "Net income (last)", v: fmt.money(last.own.netIncome) },
          ].map((s) => (
            <div key={s.l}>
              <div className="text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">{s.l}</div>
              <div className="tnum text-lg font-semibold">{s.v}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {charts.map((c) => (
          <Card key={c.title}>
            <div className="mb-1 text-sm font-semibold">{c.title}</div>
            <LineChart series={c.series} formatY={c.fmt} zeroBaseline={c.zero} />
            {c.series.length > 1 && <Legend series={c.series} />}
          </Card>
        ))}
      </div>
    </div>
  );
}
