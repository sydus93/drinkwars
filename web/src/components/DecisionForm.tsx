import { useEffect, useState } from "react";
import type { FirmDecision, SegmentId } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, SEG_TAG, STOCK_LABEL, fmt } from "../labels.js";
import { Button, Card, Eyebrow, Row, Tag } from "./ui.js";
import { AllocationBar } from "./AllocationBar.js";
import { CategoryCoin } from "./CategoryIcons.js";

type InvestKey = "invest_Q" | "invest_B" | "invest_process" | "invest_T_emp" | "invest_T_inv" | "invest_T_gov";
const INVEST_FIELDS: { key: InvestKey; label: string; hint: string }[] = [
  { key: "invest_Q", label: STOCK_LABEL.Q, hint: "Brewing talent, recipes, and consistency." },
  { key: "invest_B", label: STOCK_LABEL.B, hint: "Awareness, identity, and reputation." },
  { key: "invest_process", label: STOCK_LABEL.process, hint: "Operational efficiency and yield." },
  { key: "invest_T_emp", label: STOCK_LABEL.T_emp, hint: "Your taproom regulars and crew." },
  { key: "invest_T_inv", label: STOCK_LABEL.T_inv, hint: "Standing with your lenders and investors." },
  { key: "invest_T_gov", label: STOCK_LABEL.T_gov, hint: "Standing with your distributors and regulators." },
];

export function DecisionForm({
  view,
  defaultDecision,
  onPlay,
  busy,
  infoCost,
  onInfoChange,
  submitLabel,
  footerNote,
}: {
  view: GameView;
  defaultDecision: () => Promise<FirmDecision>;
  onPlay: (d: FirmDecision) => void;
  busy: boolean;
  infoCost: number;
  onInfoChange?: (bought: boolean) => void;
  submitLabel?: string;
  footerNote?: string;
}) {
  const [d, setD] = useState<FirmDecision | null>(null);
  const activeSegs = view.segments.filter((s) => s.active).map((s) => s.id);

  useEffect(() => {
    let live = true;
    defaultDecision().then((dd) => {
      if (live) {
        setD(dd);
        onInfoChange?.(!!dd.buy_info);
      }
    });
    return () => {
      live = false;
    };
  }, [view.round, defaultDecision, onInfoChange]);

  if (!d) return <Card>Loading lineup…</Card>;

  const set = (patch: Partial<FirmDecision>) => setD({ ...d, ...patch });
  const setPrice = (s: SegmentId, v: number) => set({ price: { ...d.price, [s]: v } });

  const cash = view.own.cash;
  const investSpend = d.invest_cap + d.invest_Q + d.invest_B + d.invest_process + d.invest_T_emp + d.invest_T_inv + d.invest_T_gov;
  const infoSpend = d.buy_info ? infoCost : 0;
  const financeOut = d.debt_repay + d.dividend;
  const financeIn = d.debt_draw + d.equity_raise;
  const netFinancing = financeIn - financeOut;
  const projectedCash = cash - investSpend - infoSpend + netFinancing; // before this round's sales
  const overcommit = projectedCash < 0;

  const equity = view.own.paid_in_capital + view.own.retained_earnings;
  const leverage = view.own.debt / Math.max(equity, 1e-6);
  const lastCov = view.ownResult?.cost_of_capital.coverage ?? null;
  const lastRate = view.ownResult?.cost_of_capital.r_debt ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="grid gap-4">
        {/* Pricing */}
        <Card>
          <Eyebrow>Lineup &amp; Pricing</Eyebrow>
          <div className="mb-3 text-sm text-inksoft">Set your price in each category. Est. unit cost {fmt.price(view.unitCostEst)}.</div>
          <div className="grid gap-3">
            {activeSegs.map((s) => {
              const margin = d.price[s] - view.unitCostEst;
              return (
                <div key={s} className="flex items-center gap-3">
                  <div className="flex w-40 items-center gap-2">
                    <CategoryCoin seg={s} size={28} />
                    <div>
                      <div className="text-sm font-semibold">{SEG_LABEL[s] ?? s}</div>
                      <Tag tone="copper">{SEG_TAG[s] ?? s}</Tag>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-inksoft">$</span>
                    <input type="number" step="0.25" min="0" value={d.price[s]} onChange={(e) => setPrice(s, Math.max(0, +e.target.value))} className="w-24 text-right" />
                  </div>
                  <div className={`tnum text-sm ${margin > 0 ? "text-hop" : "text-brick"}`}>{margin >= 0 ? "+" : ""}{margin.toFixed(2)} / unit</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Capacity + presence */}
        <Card>
          <Eyebrow>Tanks &amp; Allocation</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-sm text-inksoft">Invest in tank capacity (builds with a one-round lag)</label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-inksoft">$</span>
                <input type="number" step="50" min="0" value={d.invest_cap} onChange={(e) => set({ invest_cap: Math.max(0, +e.target.value) })} className="w-28 text-right" />
              </div>
              <div className="mt-1 text-[0.7rem] text-inksoft tnum">Current capacity: {fmt.int(view.own.cap)} units</div>
            </div>
            <div>
              <label className="text-sm text-inksoft">Capacity allocation — drag the dividers</label>
              <div className="mt-2">
                <AllocationBar
                  segments={activeSegs.map((s) => ({ id: s, label: SEG_TAG[s] ?? s }))}
                  weights={activeSegs.map((s) => d.presence[s] || 0)}
                  onChange={(w) => {
                    const next = { ...d.presence };
                    activeSegs.forEach((s, i) => (next[s] = w[i]));
                    set({ presence: next });
                  }}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Investments */}
        <Card>
          <Eyebrow>Build the Brewery</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            {INVEST_FIELDS.map((f) => (
              <div key={f.key}>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold">{f.label}</label>
                  <span className="tnum text-xs text-inksoft">{fmt.money(d[f.key])}</span>
                </div>
                <input type="range" min="0" max={Math.max(300, Math.round(cash * 0.5))} step="10" value={d[f.key]} onChange={(e) => set({ [f.key]: +e.target.value } as Partial<FirmDecision>)} className="mt-1 w-full" />
                <div className="text-[0.68rem] leading-snug text-inksoft">{f.hint}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[0.68rem] text-inksoft">More controls — financing, distributor &amp; investor relations, collaborations — unlock as the game progresses.</div>
        </Card>

        {/* Financing */}
        <Card>
          <Eyebrow>Financing</Eyebrow>
          <div className="mb-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.72rem] text-inksoft tnum">
            <span>debt {fmt.money(view.own.debt)}</span>
            <span>equity {fmt.money(equity)}</span>
            <span className={leverage > 1.5 ? "text-brick" : ""}>leverage {leverage.toFixed(2)}</span>
            {lastRate != null && <span>borrowing rate {(lastRate * 100).toFixed(1)}%</span>}
            {lastCov != null && <span>coverage {lastCov > 900 ? "∞" : `${lastCov.toFixed(1)}×`}</span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { key: "debt_draw", label: "Draw debt (cash in)", hint: "Borrow cash now; capped by your leverage." },
              { key: "debt_repay", label: "Repay debt (cash out)", hint: "Lower leverage → cheaper future borrowing." },
              { key: "equity_raise", label: "Raise equity (cash in)", hint: "Raise cash by issuing equity — dilutive, with an issue cost." },
              { key: "dividend", label: "Pay dividend (cash out)", hint: "Returns cash to owners; capped at a fraction of cash." },
            ] as const).map((f) => (
              <div key={f.key}>
                <label className="text-sm font-semibold">{f.label}</label>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-inksoft">$</span>
                  <input type="number" step="50" min="0" value={d[f.key]} onChange={(e) => set({ [f.key]: Math.max(0, +e.target.value) } as Partial<FirmDecision>)} className="w-28 text-right" />
                </div>
                <div className="text-[0.66rem] leading-snug text-inksoft">{f.hint}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Belief + reflection + info */}
        <Card>
          <Eyebrow>Read &amp; Reflect</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={d.buy_info} onChange={(e) => { set({ buy_info: e.target.checked }); onInfoChange?.(e.target.checked); }} />
                Buy market research <span className="tnum text-inksoft">({fmt.money(infoCost)})</span>
              </label>
              <div className={`mt-0.5 text-[0.68rem] ${d.buy_info ? "text-hop" : "text-inksoft"}`}>
                {d.buy_info ? "✓ Rivals' quality, brand, pricing & the strategy map are unlocked in the Field tab." : "Reveals rival positioning in the Field tab this round."}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              Predict your finish rank:
              <input type="number" min="1" max={view.standings.length || 8} value={d.beliefs?.own_rank ?? ""} onChange={(e) => set({ beliefs: { ...d.beliefs, own_rank: e.target.value ? +e.target.value : undefined } })} className="w-16 text-center" />
            </label>
          </div>
          <textarea
            placeholder="One line on your strategy this round…"
            value={d.reflection ?? ""}
            onChange={(e) => set({ reflection: e.target.value })}
            className="mt-3 h-16 w-full resize-none"
          />
        </Card>
      </div>

      {/* Pre-submission indicators */}
      <div className="grid content-start gap-4">
        <Card>
          <Eyebrow>Before You Brew</Eyebrow>
          <Row label="Cash on hand" value={fmt.money(cash)} />
          <Row label="− Investment & research" value={fmt.money(investSpend + infoSpend)} />
          <Row label={netFinancing >= 0 ? "+ Net financing" : "− Net financing"} value={<span className={netFinancing < 0 ? "text-brick" : "text-hop"}>{fmt.signed(netFinancing)}</span>} />
          <Row label="Projected cash (pre-sales)" value={<span className={overcommit ? "text-brick" : ""}>{fmt.money(projectedCash)}</span>} strong />
          {lastCov != null && <Row label="Interest coverage (last)" value={lastCov > 900 ? "—" : `${lastCov.toFixed(1)}×`} />}
          {overcommit && <div className="mt-2 text-[0.72rem] text-brick">You'd run negative before any sales come in — revenue may cover it, but you risk forced exit.</div>}
        </Card>
        <Button variant="go" onClick={() => onPlay(d)} disabled={busy} className="w-full py-3 text-base">
          {busy ? "Working…" : submitLabel ?? `Brew & Resolve Round ${view.round + 1}`}
        </Button>
        <div className="text-center text-[0.68rem] text-inksoft">{footerNote ?? "7 rival breweries (adaptive AI) brew at the same time."}</div>
      </div>
    </div>
  );
}
