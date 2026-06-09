import { useState } from "react";
import type { GameView } from "../game/controller.js";
import type { FirmSnapshot } from "../game/controller.js";
import { SEG_LABEL, fmt } from "../labels.js";
import { Card, Eyebrow, Row, Tag } from "./ui.js";
import { CompareBar, Scatter, type ScatterPoint } from "./charts.js";

function avgPrice(f: FirmSnapshot): number {
  const ps = Object.values(f.priceBySeg).filter((p) => p > 0);
  return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
}
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function Field({ view, infoActive }: { view: GameView; infoActive: boolean }) {
  const firms = view.firms;
  const you = firms.find((f) => f.isYou);
  const others = firms.filter((f) => !f.isYou);
  const lastField = view.history.at(-1)?.field;

  const scores = firms.map((f) => f.score);
  const fieldMedScore = median(others.map((f) => f.score));
  const myRank = [...firms].sort((a, b) => b.score - a.score).findIndex((f) => f.isYou) + 1;

  return (
    <div className="grid gap-4">
      {/* Market overview — always public */}
      <Card>
        <Eyebrow>The Market</Eyebrow>
        <div className="grid gap-2">
          {view.segments.filter((s) => s.active).map((s) => {
            const maxD = Math.max(...view.segments.map((x) => x.D), 1);
            return (
              <div key={s.id}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{SEG_LABEL[s.id] ?? s.id}</span>
                  <span className="tnum text-inksoft">demand {fmt.int(s.D)}</span>
                </div>
                <div className="mt-0.5 h-1.5 w-full rounded-[2px] bg-line">
                  <div className="h-full rounded-[2px] bg-copper" style={{ width: `${(s.D / maxD) * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        {lastField && <div className="mt-2 text-[0.72rem] text-inksoft tnum">Industry sold {fmt.int(lastField.totalQ)} units last round · {lastField.activeFirms} breweries still standing.</div>}
      </Card>

      {/* Benchmarks — score is public via standings */}
      <Card>
        <Eyebrow>You vs the Field</Eyebrow>
        <div className="mb-2 flex items-baseline gap-3">
          <span className="display text-3xl font-semibold text-copper">#{myRank > 0 ? myRank : "—"}</span>
          <span className="text-sm text-inksoft">of {firms.length} breweries, by sustained scorecard</span>
        </div>
        <CompareBar label="Cumulative score" you={you?.score ?? 0} ref_={fieldMedScore} max={Math.max(...scores, 0.01)} fmt={(n) => n.toFixed(2)} />
        <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <Row label="Your share" value={fmt.pct(you?.share ?? 0)} />
          <Row label="Your tanks" value={fmt.int(you?.cap ?? 0)} />
          <Row label="Your unit cost" value={you?.unitCost ? fmt.price(you.unitCost) : "—"} />
        </div>
      </Card>

      {/* Market intelligence — gated behind buying research */}
      {infoActive ? (
        <>
          <Card>
            <Eyebrow>Market Intelligence · rivals revealed</Eyebrow>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[0.62rem] uppercase tracking-[0.1em] text-inksoft">
                    <th className="py-1 pr-2">Brewery</th>
                    <th className="py-1 pr-2 text-right">Score</th>
                    <th className="py-1 pr-2 text-right">Quality</th>
                    <th className="py-1 pr-2 text-right">Brand</th>
                    <th className="py-1 pr-2 text-right">Tanks</th>
                    <th className="py-1 pr-2 text-right">Avg price</th>
                    <th className="py-1">Focus</th>
                  </tr>
                </thead>
                <tbody className="tnum">
                  {[...firms].sort((a, b) => b.score - a.score).map((f) => (
                    <tr key={f.firm_id} className={`border-t border-line ${f.isYou ? "bg-panel2" : ""}`}>
                      <td className={`py-1 pr-2 ${f.isYou ? "font-bold text-copperdeep" : ""}`}>{f.name}{f.status !== "active" ? " ✗" : ""}</td>
                      <td className="py-1 pr-2 text-right">{f.score.toFixed(2)}</td>
                      <td className="py-1 pr-2 text-right">{f.Q.toFixed(0)}</td>
                      <td className="py-1 pr-2 text-right">{f.B.toFixed(0)}</td>
                      <td className="py-1 pr-2 text-right">{fmt.int(f.cap)}</td>
                      <td className="py-1 pr-2 text-right">{avgPrice(f) ? fmt.price(avgPrice(f)) : "—"}</td>
                      <td className="py-1 text-[0.7rem]">{f.focus.map((s) => (SEG_LABEL[s] ?? s).split(" ")[0]).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <StrategyMap firms={firms} />
        </>
      ) : (
        <Card>
          <Eyebrow>Market Intelligence · locked</Eyebrow>
          <div className="flex flex-col items-start gap-2 py-4">
            <p className="text-sm text-inksoft">
              Rivals' quality, brand, capacity, pricing, and the positioning map are hidden. Tick <span className="font-semibold text-copperdeep">Buy market research</span> in
              your decision to reveal the field — its cost and effect show right there.
            </p>
            <div className="grid w-full grid-cols-2 gap-2 opacity-40 blur-[2px] sm:grid-cols-4">
              {others.slice(0, 4).map((f) => (
                <div key={f.firm_id} className="card p-2">
                  <div className="text-xs font-semibold">█████ Brewing</div>
                  <div className="tnum text-[0.7rem] text-inksoft">Q ██ · B ██</div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Plottable strategy dimensions — pick any two to find distinctive positions. */
const DIMS: { key: string; label: string; get: (f: FirmSnapshot) => number }[] = [
  { key: "unitCost", label: "Cost position (unit cost)", get: (f) => f.unitCost },
  { key: "Q", label: "Recipe quality", get: (f) => f.Q },
  { key: "B", label: "Brand", get: (f) => f.B },
  { key: "avgPrice", label: "Avg price", get: avgPrice },
  { key: "cap", label: "Capacity (tanks)", get: (f) => f.cap },
  { key: "T_emp", label: "Taproom community", get: (f) => f.T_emp },
  { key: "T_inv", label: "Investor relations", get: (f) => f.T_inv },
  { key: "T_gov", label: "Regulator relations", get: (f) => f.T_gov },
  { key: "leverage", label: "Leverage", get: (f) => f.leverage },
  { key: "share", label: "Market share", get: (f) => f.share },
];

/** §6.5 strategy map with selectable axes. Defaults to cost × brand (not the
 *  price×quality pair that's usually too correlated to reveal real positioning). */
function StrategyMap({ firms }: { firms: FirmSnapshot[] }) {
  const [xKey, setXKey] = useState("unitCost");
  const [yKey, setYKey] = useState("B");
  const xDim = DIMS.find((d) => d.key === xKey)!;
  const yDim = DIMS.find((d) => d.key === yKey)!;
  if (firms.length < 2) return null;
  const pts: ScatterPoint[] = firms.map((f) => ({
    label: f.isYou ? "you" : f.name.split(" ")[0],
    color: f.isYou ? "var(--color-copper)" : "var(--color-inksoft)",
    x: xDim.get(f),
    y: yDim.get(f),
    size: f.isYou ? 6 : 4,
    faded: f.status !== "active",
  }));

  const Select = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="rounded-[2px] border border-line2 bg-paper px-1 py-0.5 font-mono text-xs text-ink">
      {DIMS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
    </select>
  );

  return (
    <Card>
      <Eyebrow>Strategy Map · pick your axes</Eyebrow>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-inksoft">
        <span>Y: <Select value={yKey} onChange={setYKey} /></span>
        <span>X: <Select value={xKey} onChange={setXKey} /></span>
      </div>
      <Scatter points={pts} xLabel={xDim.label} yLabel={yDim.label} />
      <div className="text-[0.7rem] text-inksoft">Open space = a distinctive position; clusters = a crowded red ocean. Try axes you wouldn't expect to correlate.</div>
    </Card>
  );
}
