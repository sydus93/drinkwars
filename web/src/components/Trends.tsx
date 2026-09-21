import type { ReactNode } from "react";
import type { GameView } from "../game/controller.js";
import { fmt } from "../labels.js";
import { STOCK_LABEL } from "../labels.js";
import { Card, Eyebrow, Row } from "./ui.js";
import { InfoDot } from "./InfoDot.js";
import { LineChart, Legend, Distribution, type Series } from "./charts.js";
import { PnLBridge, CashBridge, EvaBars, DuPont, ScorecardRadar, RankBump, CostOfCapitalCockpit, StateSmallMultiples } from "./Dashboards.js";
import { ScorecardPanel } from "./Scorecard.js";

const COPPER = "var(--color-copper)";
const HOP = "var(--color-hop)";
const INK = "var(--color-inksoft)";
const GOLD = "var(--color-gold)";

const CAPTION = "mb-1 font-mono text-[0.6rem] uppercase tracking-wide text-inksoft";

/** Chart caption with an explainer. Every panel on this tab is a named finance or strategy
 *  artefact — a DuPont decomposition, an EVA series, a bridge — and until now not one of them
 *  said what it was. A capstone student should be able to read these without having met the
 *  term before, and should recognise the term afterwards. */
function Cap({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={`${CAPTION} flex items-center gap-1`}>
      <span>{title}</span>
      <InfoDot title={title}>{children}</InfoDot>
    </div>
  );
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
  const r = view.ownResult;
  const you = view.firms.find((f) => f.isYou) ?? null;
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

      {r && (
        <>
          <Card>
            <Eyebrow>Position — you against the field</Eyebrow>
            <div className="mt-1 grid gap-5 lg:grid-cols-3">
              <div><Cap title="Balanced scorecard">Your four pillars for <b>this quarter only</b>, each drawn as your position against the rest of the room: further out means further ahead of the field, the centre is the field average. It is not your season score — that one averages every quarter, so a single good round moves the radar a lot and the score a little.</Cap><ScorecardRadar you={r.scorecard_norm} /></div>
              <div><Cap title="Rank over the season">Where you finished each quarter, first at the top. A flat line means positions are frozen and nobody is catching anybody; lines crossing means the order is still up for grabs. Early rank is weak evidence — four or five quarters is not long enough for skill to separate cleanly from luck.</Cap><RankBump history={h} standings={view.standings} /></div>
              <div><Cap title="Where you rank">Every firm's season score on one axis, with you marked. The <i>shape</i> is the point: bunched together means the room is close and small moves change places; spread out means somebody has built a real lead.</Cap><Distribution vals={view.firms.map((f) => f.score)} you={view.firms.find((f) => f.isYou)?.score ?? r.scorecard_cumulative} fmtTick={(n) => n.toFixed(2)} /></div>
            </div>
          </Card>
          <Card>
            <Eyebrow>The statements in pictures</Eyebrow>
            <div className="mb-2 text-[0.72rem] text-inksoft">The same figures as Statements &amp; Ratios, drawn. Read the sheets first; use these to see the shape.</div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div><Cap title="P&amp;L bridge">The income statement walked from revenue down to net income, one step per cost. Read it to see <b>which</b> cost took the money — a bridge makes a fat overhead or a heavy interest bill obvious in a way a column of numbers does not.</Cap><PnLBridge pnl={r.pnl} /></div>
              <div><Cap title="Cash bridge">Opening cash to closing cash, through operating, investing and financing. This is where profit and cash come apart: depreciation is a cost that takes no cash, capex takes cash that is not a cost, and a profitable quarter can still drain the account.</Cap><CashBridge cash={r.cash_flow} opening={r.balance_sheet.cash - r.cash_flow.delta_cash} /></div>
              {you && <div><Cap title="DuPont — return on equity decomposed">Return on equity split into the three things that produce it: <b>margin</b> (profit per sales dollar) × <b>asset turnover</b> (sales per dollar of assets) × <b>leverage</b> (assets per dollar of equity). Two firms can post the same ROE for completely different reasons — one earning it, one borrowing it — and this is the chart that tells them apart. Leverage flatters ROE right up until the quarter it doesn't.</Cap><DuPont you={you} result={r} field={view.firms.filter((f) => !f.isYou)} /></div>}
              <div><Cap title="Cost of capital">What your lender charges and the two ratios that set it. The <b>?</b> beside the rate breaks down how leverage and coverage move the price of your debt.</Cap><CostOfCapitalCockpit coc={r.cost_of_capital} finance={view.finance} /></div>
              <div><Cap title="Economic value added">Net income less a rent on the owners' capital tied up in the business, charged at the going borrowing rate. Accounting profit asks "did we make money?"; EVA asks the harder question — <b>did we make more than this capital could have earned elsewhere?</b> A positive bar is real value created. A small profit on a large balance sheet shows up here as a negative bar, and that is the point of the measure.</Cap><EvaBars history={h} finance={view.finance} /></div>
            </div>
          </Card>
          <Card>
            <Eyebrow>Durable capital — the stocks you are building</Eyebrow>
            <div className="mb-2 text-[0.72rem] text-inksoft">Quality, brand, operations and the three relationships are stocks: what you invest lands a quarter later, and all of them decay if you stop funding them.</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
              {(["Q", "B", "process", "T_emp", "T_inv", "T_gov"] as const).map((k) => <Row key={k} label={STOCK_LABEL[k]} value={fmt.num(r.state[k])} />)}
            </div>
            <div className="mt-3"><StateSmallMultiples history={h} /></div>
          </Card>
        </>
      )}
    </div>
  );
}
