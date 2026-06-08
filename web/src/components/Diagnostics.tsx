import type { FirmRoundResult } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, STOCK_LABEL, fmt } from "../labels.js";
import { Bar, Card, Eyebrow, Row, Tag } from "./ui.js";

const PALETTE = { copper: "#b5632b", hop: "#5d7c44", gold: "#c2912f", ink: "#6a5d4f", brick: "#a8392f" };

/** §6.4 — decompose the round rather than just showing a rank. */
export function Diagnostics({ result, view }: { result: FirmRoundResult; view: GameView }) {
  const segs = Object.entries(result.segments).filter(([id]) => view.segments.find((s) => s.id === id)?.active);
  const cb = result.cost_buildup;
  const pnl = result.pnl;
  const bs = result.balance_sheet;
  const cf = result.cash_flow;

  return (
    <div className="grid gap-4">
      {/* Demand: where your sales came from */}
      <Card>
        <Eyebrow>Why You Sold What You Sold</Eyebrow>
        <div className="mb-3 text-[0.72rem] text-inksoft">Bars show what builds your appeal (consumer utility); a higher price pulls appeal back down — that pullback is the <span className="text-brick">price effect</span>.</div>
        <div className="grid gap-4 md:grid-cols-2">
          {segs.map(([id, r]) => {
            const a = r.attraction;
            const drivers = [
              { label: "Base appeal", value: a.alpha, color: PALETTE.ink },
              { label: "Quality", value: a.quality, color: PALETTE.hop },
              { label: "Brand", value: a.brand, color: PALETTE.copper },
              { label: "Fit / focus", value: a.fit, color: PALETTE.gold },
              { label: "Collab", value: a.agreement, color: "#7a6cae" },
            ].filter((x) => x.value > 0.001);
            return (
              <div key={id} className="border-b border-line pb-3 last:border-0 md:border-0 md:pb-0">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="font-semibold">{SEG_LABEL[id] ?? id}</span>
                  <span className="tnum text-sm text-copperdeep">{fmt.pct1(r.share)} share</span>
                </div>
                <Bar segments={drivers} />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] text-inksoft tnum">
                  <span>sold {fmt.int(r.q_sold)} / wanted {fmt.int(r.q_desired)}</span>
                  <span>price {fmt.price(r.price)}</span>
                  <span className="text-brick">price effect {a.price.toFixed(2)}</span>
                  <span>rev {fmt.money(r.revenue)}</span>
                </div>
              </div>
            );
          })}
          {segs.length === 0 && <div className="text-sm text-inksoft">You served no active category this round.</div>}
        </div>
      </Card>

      {/* Per-category economics */}
      <Card>
        <Eyebrow>Per-Category Economics</Eyebrow>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[0.6rem] uppercase tracking-[0.1em] text-inksoft">
                <th className="py-1 pr-2">Category</th>
                <th className="py-1 pr-2 text-right">Sold / Wanted</th>
                <th className="py-1 pr-2 text-right">Price</th>
                <th className="py-1 pr-2 text-right">Unit cost</th>
                <th className="py-1 pr-2 text-right">Margin/unit</th>
                <th className="py-1 pr-2 text-right">Revenue</th>
                <th className="py-1 text-right">Contribution</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {segs.map(([id, r]) => {
                const margin = r.price - result.unit_cost;
                const cogs = result.unit_cost * r.q_sold;
                const capped = r.q_sold + 1 < r.q_desired;
                return (
                  <tr key={id} className="border-t border-line">
                    <td className="py-1 pr-2 font-semibold">{SEG_LABEL[id] ?? id}</td>
                    <td className="py-1 pr-2 text-right">
                      {fmt.int(r.q_sold)} / {fmt.int(r.q_desired)} {capped && <span className="text-brick" title="capacity-constrained">▲</span>}
                    </td>
                    <td className="py-1 pr-2 text-right">{fmt.price(r.price)}</td>
                    <td className="py-1 pr-2 text-right">{fmt.price(result.unit_cost)}</td>
                    <td className={`py-1 pr-2 text-right ${margin >= 0 ? "text-hop" : "text-brick"}`}>{margin >= 0 ? "+" : ""}{margin.toFixed(2)}</td>
                    <td className="py-1 pr-2 text-right">{fmt.money(r.revenue)}</td>
                    <td className="py-1 text-right font-semibold">{fmt.money(r.revenue - cogs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[0.7rem] text-inksoft">▲ = you sold less than buyers wanted (capacity-constrained) — building tanks would convert that lost demand.</div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Unit cost build-up */}
        <Card>
          <Eyebrow>Unit Cost Build-Up</Eyebrow>
          <Row label="Base cost" value={fmt.price(cb.c_base)} />
          <Row label="× Experience curve" value={`×${cb.learning.toFixed(2)}`} />
          <Row label="× Operations (1 − effect)" value={`×${cb.process.toFixed(2)}`} />
          <Row label="× Location" value={`×${cb.location.toFixed(2)}`} />
          <Row label="÷ Crew productivity" value={`÷${cb.productivity.toFixed(2)}`} />
          {cb.supply_share < 1 && <Row label="× Co-packing share" value={`×${cb.supply_share.toFixed(2)}`} />}
          {cb.shock > 1 && <Row label="× Input shock" value={<span className="text-brick">×{cb.shock.toFixed(2)}</span>} />}
          <Row label="Effective unit cost" value={fmt.price(result.unit_cost)} strong />
        </Card>

        {/* Three statements */}
        <Card>
          <Eyebrow>The Ledger</Eyebrow>
          <div className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-copperdeep">P&amp;L</div>
          <Row label="Revenue" value={fmt.money(pnl.revenue)} />
          <Row label="− COGS" value={fmt.money(pnl.cogs)} />
          <Row label="− Operating expense" value={fmt.money(pnl.opex)} />
          <Row label="− Depreciation" value={fmt.money(pnl.depreciation)} />
          <Row label="− Interest" value={fmt.money(pnl.interest)} />
          <Row label="Net income" value={<span className={pnl.net_income >= 0 ? "text-hop" : "text-brick"}>{fmt.signed(pnl.net_income)}</span>} strong />
          <div className="mt-3 grid grid-cols-2 gap-x-4">
            <div>
              <div className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-copperdeep">Balance</div>
              <Row label="Cash" value={fmt.money(bs.cash)} />
              <Row label="Net PP&E" value={fmt.money(bs.ppe)} />
              <Row label="Debt" value={fmt.money(bs.debt)} />
              <Row label="Equity" value={fmt.money(bs.equity)} />
            </div>
            <div>
              <div className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-copperdeep">Cash flow</div>
              <Row label="Operating" value={fmt.signed(cf.operating)} />
              <Row label="Investing" value={fmt.signed(cf.investing)} />
              <Row label="Financing" value={fmt.signed(cf.financing)} />
              <Row label="Δ Cash" value={fmt.signed(cf.delta_cash)} strong />
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <Tag tone={result.cost_of_capital.coverage >= 2 ? "hop" : "brick"}>
              coverage {result.cost_of_capital.coverage > 900 ? "∞" : `${result.cost_of_capital.coverage.toFixed(1)}×`}
            </Tag>
            <Tag tone={result.cost_of_capital.leverage <= 1.5 ? "hop" : "brick"}>leverage {result.cost_of_capital.leverage.toFixed(2)}</Tag>
          </div>
        </Card>
      </div>

      {/* Intangible stocks */}
      <Card>
        <Eyebrow>Durable Capital (net of decay)</Eyebrow>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          {(["Q", "B", "process", "T_emp", "T_inv", "T_gov"] as const).map((k) => (
            <Row key={k} label={STOCK_LABEL[k]} value={fmt.num(result.state[k])} />
          ))}
        </div>
      </Card>

      <div className="text-center font-mono text-[0.68rem] tracking-wide text-inksoft">
        Strategic distinctiveness this round: {result.distinctiveness ? `${result.distinctiveness.mahalanobis.toFixed(2)} (vs field centroid)` : "—"} · cumulative score {result.scorecard_cumulative.toFixed(3)}
      </div>
    </div>
  );
}
