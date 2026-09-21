import type { FirmRoundResult } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, fmt } from "../labels.js";
import { Bar, Card, Eyebrow, Row } from "./ui.js";
import { InfoDot } from "./InfoDot.js";
import { WorldMap } from "./WorldMap.js";
import { CapacityVsDemand } from "./Dashboards.js";

const PALETTE = {
  copper: "var(--color-copper)",
  hop: "var(--color-hop)",
  gold: "var(--color-gold)",
  ink: "var(--color-inksoft)",
  brick: "var(--color-brick)",
};

/** Review → Operations & Demand: how the product got made and why it sold. Capacity against
 *  demand, the cost of one drink, what drew buyers — plus inventory, markets and programs when
 *  those modules are on. Each of these lives here and nowhere else; the statements and the
 *  per-category sales figures are on Statements & Ratios, the scorecard visuals on Trends. */
export function OperationsAndDemand({ result, view }: { result: FirmRoundResult; view: GameView }) {
  const segs = Object.entries(result.segments).filter(([id]) => view.segments.find((s) => s.id === id)?.active);
  const cb = result.cost_buildup;
  const geoMarkets = result.markets && view.modules?.geography?.markets
    ? view.modules.geography.markets.filter((m) => m.kind !== "export" || view.modules?.international?.enabled)
    : null;

  // Expansion-module position readouts (render only what's switched on / non-zero).
  const mods = view.modules;
  const own = view.own;
  const repOn = !!mods?.reputation?.enabled;
  const sustOn = !!mods?.sustainability?.enabled;
  const rndOn = !!mods?.rndRace?.enabled;
  // Talent: one system. Named employees (B12) supersede key-role hires (B03) in the readout.
  const empOn = !!mods?.employees?.enabled;
  const emps = own.employees ?? [];
  const hires = empOn ? [] : own.key_hires ?? [];
  const vassets = own.vertical_assets ?? [];
  const note = own.convertible_note ?? null;
  const rbf = Math.max(0, own.rbf_outstanding ?? 0);
  const showPrograms = repOn || sustOn || rndOn || hires.length > 0 || emps.length > 0 || vassets.length > 0 || note != null || rbf > 0;
  const meter = (v: number, scale: number) => (
    <span className="inline-flex h-1.5 w-24 overflow-hidden rounded-[2px] border border-line align-middle">
      <span style={{ width: `${Math.min(100, (v / scale) * 100)}%`, background: PALETTE.copper }} />
    </span>
  );

  const unitCostCard = (
    <Card>
      <div className="flex items-center gap-1.5">
        <Eyebrow>Unit Cost Build-Up</Eyebrow>
        <InfoDot title="What one drink costs to brew">
          Start from the base cost of brewing one drink, then each line moves it. The model multiplies the factors together, so each line shows the <b>dollar change</b> that factor causes, with the raw factor in grey. Cumulative volume (the experience curve) and investment in operations push cost <b>down</b>. A premium recipe, an expensive location and input shocks push it <b>up</b>. Crew productivity divides rather than multiplies because it measures output per hour of labor: a crew that brews 10% more per hour makes each drink about 9% cheaper. The experience curve reads your cumulative volume <b>at the start of the quarter</b> — this quarter's brewing pays off next quarter, which is why round 1 shows no saving.
        </InfoDot>
      </div>
      {(() => {
        // Same multiplicative chain the engine uses, walked in dollars so each factor's effect
        // on the cost of one drink is legible (a column of bare "×0.94" rows was not).
        const chain: { label: string; f: number; raw: string }[] = [
          { label: "Experience curve", f: cb.learning, raw: `×${cb.learning.toFixed(2)}` },
          { label: "Operations investment", f: cb.process, raw: `×${cb.process.toFixed(2)}` },
          ...(cb.quality_premium > 1.001 ? [{ label: "Premium recipe", f: cb.quality_premium, raw: `×${cb.quality_premium.toFixed(2)}` }] : []),
          { label: "Location", f: cb.location, raw: `×${cb.location.toFixed(2)}` },
          { label: "Crew productivity", f: 1 / Math.max(cb.productivity, 1e-6), raw: `÷${cb.productivity.toFixed(2)}` },
          ...(cb.supply_share < 1 ? [{ label: "Co-packing share", f: cb.supply_share, raw: `×${cb.supply_share.toFixed(2)}` }] : []),
          ...(cb.shock > 1 ? [{ label: "Input shock", f: cb.shock, raw: `×${cb.shock.toFixed(2)}` }] : []),
        ];
        let run = cb.c_base;
        return (
          <>
            <Row label="Base cost per drink" value={fmt.price(cb.c_base)} />
            {chain.map((x) => {
              const next = run * x.f; const dlt = next - run; run = next;
              const flat = Math.abs(dlt) < 0.005;
              return <Row key={x.label} label={<>{x.label} <span className="text-inksoft/70 tnum">{x.raw}</span></>} value={<span className={flat ? "text-inksoft" : dlt < 0 ? "text-hop" : "text-brick"}>{flat ? "no change" : `${dlt < 0 ? "−" : "+"}$${Math.abs(dlt).toFixed(2)}`}</span>} />;
            })}
          </>
        );
      })()}
      <Row label="Effective unit cost" value={fmt.price(result.unit_cost)} strong />
    </Card>
  );

  return (
    <div className="grid gap-4">
      {/* Supply: what buyers wanted, what you sold, what you could brew */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center gap-1.5">
            <Eyebrow>Capacity &amp; Demand</Eyebrow>
            <InfoDot title="Reading this chart">Three bars on one scale. <b>First choice</b> is the demand you won outright: buyers who picked you at your price. <b>Sold</b> is what you delivered. If it falls short, the red hatched gap is buyers you turned away because you ran out of product. If it runs <i>past</i> first choice, the extra is <b>spillover</b>: rivals ran out, and some of their buyers settled for you — it only reaches firms with spare tanks. <b>Capacity</b> is what you could brew; a hatched tail is idle tank you paid upkeep on. Unserved demand says build. Idle tanks say you overbuilt or priced yourself out of volume — unless you are holding them to catch spillover when rivals stock out.</InfoDot>
          </div>
          <CapacityVsDemand result={result} cap={view.own.cap} />
        </Card>
        {unitCostCard}
      </div>

      {/* Per-market performance (geography) */}
      {geoMarkets && result.markets && (
        <Card>
          <div className="flex items-center gap-1.5">
            <Eyebrow>Your Markets</Eyebrow>
            <InfoDot title="Markets &amp; shipping">Revenue and units by market. <b>Shipping</b> is what it cost to truck product into a market from your nearest brewery because you sold more there than you brew there; it lands inside operating expense on the P&amp;L. Siting production in the market removes it.</InfoDot>
          </div>
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
                    value={inMkt ? <span>{fmt.money(p?.revenue ?? 0)} · {fmt.int(p?.q_sold ?? 0)}u{(() => { const ship = (p?.lanes ?? []).reduce((a, l) => a + l.cost, 0); return ship > 0.5 ? <span className="text-brick"> · shipping {fmt.money(ship)}</span> : null; })()}</span> : <span className="text-inksoft">—</span>}
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
            {emps.length > 0 && <Row label="Your crew" value={emps.map((e) => e.name).join(" · ")} />}
            {hires.length > 0 && <Row label="Key people" value={hires.map((h) => h.role.replace(/_/g, " ")).join(" · ")} />}
            {note && <Row label="Convertible note" value={<span className="tnum">{fmt.money(note.principal)} outstanding</span>} />}
            {rbf > 0 && <Row label="Revenue financing" value={<span className="tnum">{fmt.money(rbf)} still owed</span>} />}
          </div>
        </Card>
      )}

      {/* Demand: where your sales came from */}
      <Card>
        <div className="flex items-center gap-1.5">
          <Eyebrow>Why You Sold What You Sold</Eyebrow>
          <InfoDot title="How appeal becomes sales">
            Every drinker weighs each brewery's <b>appeal</b> in a category. Appeal is a sum: a base level everyone gets, plus what your recipe quality, your brand and your focus on that category add — minus what your price takes away (the <b>price effect</b>, always negative: the higher the price, the bigger the pullback). The bar shows the pieces that <i>build</i> appeal, in proportion. What matters for sales is your <b>net appeal</b> compared with your rivals': the brewery with the higher net appeal takes the larger share. Raising price lifts your margin per drink but lowers net appeal, so you sell fewer of them.
          </InfoDot>
        </div>
        <div className="mb-3 text-[0.72rem] text-inksoft">Each bar is what builds your appeal to drinkers in that category. Price works against it — the <span className="text-brick">price effect</span>. Net appeal, relative to rivals, sets your share.</div>
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
                {/* The bar had no key — colour alone can't say which slice is quality and which is brand. */}
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.68rem] text-inksoft tnum">
                  {drivers.map((x) => (
                    <span key={x.label} className="inline-flex items-center gap-1">
                      <span className="h-2 w-2 flex-none rounded-[2px] border border-line" style={{ background: x.color }} />
                      {x.label} <b className="text-ink">+{x.value.toFixed(2)}</b>
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1 text-brick">
                    <span className="h-2 w-2 flex-none rounded-[2px] bg-brick" />
                    Price effect <b>{a.price.toFixed(2)}</b>
                  </span>
                  <span className="text-ink">= net appeal <b>{(drivers.reduce((t, x) => t + x.value, 0) + a.price).toFixed(2)}</b></span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] text-inksoft tnum">
                  <span>sold {fmt.int(r.q_sold)} · first-choice demand {fmt.int(r.q_desired)}{r.q_sold - r.q_desired > 1 ? <span className="text-hop"> (+{fmt.int(r.q_sold - r.q_desired)} spillover)</span> : r.q_desired - r.q_sold > 1 ? <span className="text-brick"> ({fmt.int(r.q_desired - r.q_sold)} unserved)</span> : null}</span>
                  <span>price {fmt.price(r.price)}</span>
                  <span>rev {fmt.money(r.revenue)}</span>
                </div>
              </div>
            );
          })}
          {segs.length === 0 && <div className="text-sm text-inksoft">You served no active category this round.</div>}
        </div>
      </Card>

      {/* Inventory & turnover (production mode only) */}
      {result.inventory && (
        <Card>
          <div className="flex items-center gap-1.5">
            <Eyebrow>Production &amp; Inventory</Eyebrow>
            <InfoDot title="Where spoilage comes from">
              Spoilage is beer you brewed but did not sell. Whatever finished stock is left at the end of the quarter, a fixed share of it goes off and is written off at what it cost you to brew — a straight loss on the P&amp;L. It has nothing to do with distribution or how many locations you run. The cause is brewing ahead of demand; the cure is a lower <b>run rate</b> (Operations desk) or selling more of what you make. Low turnover is the early warning: stock is sitting.
            </InfoDot>
          </div>
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
    </div>
  );
}
