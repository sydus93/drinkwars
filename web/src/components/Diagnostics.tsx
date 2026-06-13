import type { FirmRoundResult } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, STOCK_LABEL, fmt } from "../labels.js";
import { Bar, Card, Eyebrow, Row, Tag } from "./ui.js";
import { WorldMap } from "./WorldMap.js";

const PALETTE = {
  copper: "var(--color-copper)",
  hop: "var(--color-hop)",
  gold: "var(--color-gold)",
  ink: "var(--color-inksoft)",
  brick: "var(--color-brick)",
};

/** §6.4 — decompose the round rather than just showing a rank. */
export function Diagnostics({ result, view }: { result: FirmRoundResult; view: GameView }) {
  const segs = Object.entries(result.segments).filter(([id]) => view.segments.find((s) => s.id === id)?.active);
  const cb = result.cost_buildup;
  const pnl = result.pnl;
  const bs = result.balance_sheet;
  const cf = result.cash_flow;

  const geoMarkets = result.markets && view.modules?.geography?.markets
    ? view.modules.geography.markets.filter((m) => m.kind !== "export" || view.modules?.international?.enabled)
    : null;

  // Expansion-module position readouts (render only what's switched on / non-zero).
  const mods = view.modules;
  const own = view.own;
  const repOn = !!mods?.reputation?.enabled;
  const sustOn = !!mods?.sustainability?.enabled;
  const rndOn = !!mods?.rndRace?.enabled;
  const hires = own.key_hires ?? [];
  const vassets = own.vertical_assets ?? [];
  const note = own.convertible_note ?? null;
  const rbf = Math.max(0, own.rbf_outstanding ?? 0);
  const showPrograms = repOn || sustOn || rndOn || hires.length > 0 || vassets.length > 0 || note != null || rbf > 0;
  const meter = (v: number, scale: number) => (
    <span className="inline-flex h-1.5 w-24 overflow-hidden rounded-[2px] border border-line align-middle">
      <span style={{ width: `${Math.min(100, (v / scale) * 100)}%`, background: PALETTE.copper }} />
    </span>
  );

  return (
    <div className="grid gap-4">
      {/* Per-market performance (geography) */}
      {geoMarkets && result.markets && (
        <Card>
          <Eyebrow>Your Markets</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
            <div className="rounded-md border border-line bg-paper2/30 p-1">
              <WorldMap markets={geoMarkets} breakdown={result.markets} />
            </div>
            <div className="grid content-start gap-1">
              {geoMarkets.map((m) => {
                const p = result.markets![m.id];
                const inMkt = p?.entered ?? m.kind === "home";
                return (
                  <Row
                    key={m.id}
                    label={<span>{m.label}{m.kind === "export" && <span className="ml-1 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-hop">export</span>}{!inMkt && <span className="ml-1 text-[0.62rem] text-inksoft">— not entered</span>}</span>}
                    value={inMkt ? <span>{fmt.money(p?.revenue ?? 0)} · {fmt.int(p?.q_sold ?? 0)}u</span> : <span className="text-inksoft">—</span>}
                  />
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Expansion programs: the position your extra plays have built */}
      {showPrograms && (
        <Card>
          <Eyebrow>Your Programs</Eyebrow>
          <div className="grid gap-1">
            {repOn && <Row label={<span>Reputation <span className="text-[0.62rem] text-inksoft">honoring deals → cheaper borrowing</span></span>} value={<span>{meter(result.state.reputation, 12)} <span className="tnum ml-1">{result.state.reputation.toFixed(1)}</span></span>} />}
            {sustOn && <Row label={<span>Water efficiency <span className="text-[0.62rem] text-inksoft">drought armor</span></span>} value={<span>{meter(result.state.water_efficiency, 30)} <span className="tnum ml-1">{result.state.water_efficiency.toFixed(1)}</span></span>} />}
            {rndOn && <Row label={<span>R&amp;D progress <span className="text-[0.62rem] text-inksoft">race to the new category</span></span>} value={<span>{meter(result.state.rnd_progress, 60)} <span className="tnum ml-1">{result.state.rnd_progress.toFixed(0)}</span></span>} />}
            {vassets.length > 0 && <Row label="Vertical assets" value={vassets.map((a) => a.id.replace(/_/g, " ")).join(" · ")} />}
            {hires.length > 0 && <Row label="Key people" value={hires.map((h) => h.role.replace(/_/g, " ")).join(" · ")} />}
            {note && <Row label="Convertible note" value={<span className="tnum">{fmt.money(note.principal)} outstanding</span>} />}
            {rbf > 0 && <Row label="Revenue financing" value={<span className="tnum">{fmt.money(rbf)} still owed</span>} />}
          </div>
        </Card>
      )}

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
              { label: "Collab", value: a.agreement, color: "var(--color-plum)" },
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
          {cb.quality_premium > 1.001 && <Row label="× Premium recipe" value={<span className="text-brick">×{cb.quality_premium.toFixed(2)}</span>} />}
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
          {pnl.spoilage > 0 && <Row label="− Spoilage" value={<span className="text-brick">{fmt.money(pnl.spoilage)}</span>} />}
          <Row label="− Operating expense" value={fmt.money(pnl.opex)} />
          <Row label="− Depreciation" value={fmt.money(pnl.depreciation)} />
          <Row label="− Interest" value={fmt.money(pnl.interest)} />
          <Row label="Net income" value={<span className={pnl.net_income >= 0 ? "text-hop" : "text-brick"}>{fmt.signed(pnl.net_income)}</span>} strong />
          <div className="mt-3 grid grid-cols-2 gap-x-4">
            <div>
              <div className="mb-1 text-[0.62rem] uppercase tracking-[0.14em] text-copperdeep">Balance</div>
              <Row label="Cash" value={fmt.money(bs.cash)} />
              <Row label="Net PP&E" value={fmt.money(bs.ppe)} />
              {bs.inventory > 0 && <Row label="Inventory" value={fmt.money(bs.inventory)} />}
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

      {/* Inventory & turnover (production mode only) */}
      {result.inventory && (
        <Card>
          <Eyebrow>Production &amp; Inventory</Eyebrow>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm tnum">
            <span className="text-inksoft">Opening stock <span className="text-ink">{fmt.int(result.inventory.begin)}</span></span>
            <span className="text-inksoft">Brewed <span className="text-ink">{fmt.int(result.inventory.produced)}</span></span>
            <span className="text-inksoft">Sold <span className="text-hop">{fmt.int(result.inventory.sold)}</span></span>
            <span className="text-inksoft">Spoiled <span className="text-brick">{fmt.int(result.inventory.spoiled)}</span></span>
            <span className="text-inksoft">Carried over <span className="text-ink">{fmt.int(result.inventory.end)}</span></span>
            <span className="text-inksoft">Turnover <span className="text-copperdeep">{result.inventory.turnover.toFixed(2)}×</span></span>
          </div>
          <div className="mt-2 text-[0.7rem] leading-snug text-inksoft">
            Turnover = sold ÷ average stock on hand (higher is leaner). Carried kegs tie up cash and lose a share to spoilage each round — match your run-rate to demand.
          </div>
        </Card>
      )}

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
