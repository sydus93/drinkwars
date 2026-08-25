import { Fragment } from "react";
import type { GameView } from "../game/controller.js";
import { fmt } from "../labels.js";
import { RATIO_DEFS, RATIO_GROUPS, ratioDisplay, type RatioInput } from "../lib/ratios.js";
import { Card, Eyebrow } from "./ui.js";
import { LineChart, Legend, type Series } from "./charts.js";
import { ScorecardPanel } from "./Scorecard.js";

const COPPER = "var(--color-copper)";
const HOP = "var(--color-hop)";
const INK = "var(--color-inksoft)";
const GOLD = "var(--color-gold)";

/** The engine's OwnTrendView carries the DW-037 statement figures at runtime; the
 *  controller's narrower OwnTrend type predates them, so read them defensively
 *  (older saved games without the fields just show "—"). */
function ratioInputOf(own: GameView["history"][number]["own"]): RatioInput {
  const o = own as typeof own & Partial<RatioInput>;
  return {
    revenue: o.revenue ?? 0, gross: o.gross ?? 0, ebit: o.ebit ?? 0, interest: o.interest ?? 0,
    netIncome: own.netIncome, cash: own.cash, debt: o.debt ?? 0, equity: own.equity, assets: o.assets ?? 0,
  };
}

export function Trends({ view }: { view: GameView }) {
  const h = view.history;
  if (h.length === 0) {
    return (
      <div className="grid gap-3">
        <ScorecardPanel view={view} />
        <Card>
          <Eyebrow>Trends</Eyebrow>
          <div className="text-sm text-inksoft">Play a round to start charting your trajectory over the season.</div>
        </Card>
      </div>
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
      <ScorecardPanel view={view} />
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

      <Card>
        <Eyebrow>Your financials — key ratios</Eyebrow>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                <th className="py-1 pr-2">Ratio</th>
                {h.slice(-4).map((r, i, arr) => (
                  <th key={r.own.round} className={`px-2 py-1 text-right ${i === arr.length - 1 ? "text-ink" : ""}`}>R{r.own.round + 1}</th>
                ))}
              </tr>
            </thead>
            <tbody className="tnum">
              {RATIO_GROUPS.map((g) => (
                <Fragment key={g.id}>
                  <tr>
                    <td colSpan={Math.min(h.length, 4) + 1} className="pb-0.5 pt-2 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-copperdeep">{g.label}</td>
                  </tr>
                  {RATIO_DEFS.filter((def) => def.group === g.id).map((def) => (
                    <tr key={def.key} className="border-t border-line">
                      <td className="py-1 pr-2 text-inksoft">{def.label}</td>
                      {h.slice(-4).map((r, i, arr) => (
                        <td key={r.own.round} className={`px-2 py-1 text-right ${i === arr.length - 1 ? "font-semibold text-ink" : ""}`}>
                          {ratioDisplay(def, def.compute(ratioInputOf(r.own)))}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[0.7rem] text-inksoft">
          The same ratios an analyst reads off a real income statement and balance sheet — margins from the P&amp;L, liquidity and leverage from the balance sheet. Each round is a fiscal quarter.
        </div>
      </Card>
    </div>
  );
}
