import { useEffect, useState } from "react";
import type { FirmDecision, PrPlayType, SegmentId } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, SEG_TAG, STOCK_LABEL, fmt } from "../labels.js";
import { Button, Card, Eyebrow, Row, Tag } from "./ui.js";
import { AllocationBar } from "./AllocationBar.js";
import { CategoryCoin } from "./CategoryIcons.js";
import { EventModal, type GameEvent } from "./EventModal.js";
import { InfoDot } from "./InfoDot.js";
import { WorldMap } from "./WorldMap.js";
import { MarketDetail } from "./MarketDetail.js";

const PR_PLAYS: { id: PrPlayType; label: string; description: string }[] = [
  { id: "festival", label: "Festival sponsorship", description: "A steady brand lift at a community event." },
  { id: "collab", label: "Brewer collaboration", description: "A buzzier co-release — a bigger spike." },
  { id: "viral", label: "Viral label drop", description: "Highest-upside splash — the biggest spike." },
];
const PR_LABEL: Record<PrPlayType, string> = { festival: "Festival sponsorship", collab: "Brewer collab", viral: "Viral label drop" };
const GOOD_LABEL: Record<string, string> = { regional_marketing: "Regional marketing fund", water_commons: "Water-commons pool", quality_certification: "Quality certification" };
const GOOD_BLURB: Record<string, string> = {
  demand: "Lifts demand for everyone in the segment.",
  water_resilience: "Softens the water shock industry-wide.",
  quality: "Raises how much the market rewards quality.",
};

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
  const [prModal, setPrModal] = useState(false);
  const [marketDetail, setMarketDetail] = useState<string | null>(null);
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
  // Production / inventory mode (only when the game was created with it on).
  const invOn = view.inventoryEnabled;
  const cap = view.own.cap;
  const stock = view.own.inventory_units ?? 0;
  const runRate = d.run_rate ?? 1; // fraction of capacity to brew (1 = full)
  const produced = runRate * cap;
  const sellable = stock + produced;
  const lastSold = view.ownResult?.inventory?.sold ?? null;
  const brewSpend = invOn ? produced * view.unitCostEst : 0; // cash out to brew this round

  // Expansion-module decision controls (gated on what the instructor enabled).
  const mods = view.modules;
  const prOn = !!mods?.prEvents?.enabled;
  const sustOn = !!mods?.sustainability?.enabled;
  const pgOn = !!mods?.publicGoods?.enabled;
  const prCost = mods?.prEvents?.cost ?? 0;
  const prCooldownUntil = view.own.pr_cooldown_until ?? null;
  const prOnCooldown = prCooldownUntil != null && view.round < prCooldownUntil;
  const prSpend = prOn && d?.pr_action && !prOnCooldown ? prCost : 0;
  const waterSpend = sustOn ? Math.max(0, d?.invest_water_efficiency ?? 0) : 0;
  const goods = mods?.publicGoods?.goods ?? [];
  const contribs = d?.public_good_contributions ?? {};
  const pgSpend = pgOn ? Object.values(contribs).reduce((a, b) => a + Math.max(0, b), 0) : 0;
  const rndOn = !!mods?.rndRace?.enabled;
  const rndSpend = rndOn ? Math.max(0, d?.invest_rnd ?? 0) : 0;
  const frontierActive = view.segments.some((s) => s.id === "frontier" && s.active);

  // MOD-B06 vertical assets · MOD-B03 key hires · MOD-B08 instruments · MOD-B07 M&A
  const vertOn = !!mods?.verticalIntegration?.enabled;
  const vertAssets = mods?.verticalIntegration?.assets ?? [];
  const owned = new Set((view.own.vertical_assets ?? []).map((a) => a.id));
  const buying = new Set(d?.buy_vertical ?? []);
  const vertSpend = vertOn ? vertAssets.filter((a) => buying.has(a.id) && !owned.has(a.id)).reduce((s, a) => s + a.cost, 0) : 0;
  const toggleBuy = (id: string) => {
    const next = new Set(buying);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ buy_vertical: [...next] });
  };
  const labOn = !!mods?.laborMarket?.enabled;
  const labRoles = mods?.laborMarket?.roles ?? [];
  // Retention read: the chance a hire stays, from the same formula the engine uses
  // (employee trust mitigates the base departure probability).
  const labCfg = mods?.laborMarket;
  const tEmp = view.own.T_emp ?? 0;
  const pLeave = labCfg ? labCfg.departure_prob * (1 - labCfg.t_emp_mitigation * (tEmp / (tEmp + labCfg.t_emp_halfsat))) : 0;
  const retentionLabel = pLeave <= 0.03 ? "strong — your people stay" : pLeave <= 0.06 ? "solid" : "shaky — poaching risk is real";
  const retentionTone = pLeave <= 0.03 ? "text-hop" : pLeave <= 0.06 ? "text-copperdeep" : "text-brick";
  const onStaff = new Set((view.own.key_hires ?? []).map((h) => h.role));
  const hiring = new Set(d?.hire_roles ?? []);
  const firing = new Set(d?.fire_roles ?? []);
  const hireSpend = labOn ? labRoles.filter((r) => hiring.has(r.id) && !onStaff.has(r.id)).reduce((s, r) => s + r.signing_bonus + r.salary, 0) : 0;
  const toggleHire = (id: string) => {
    const next = new Set(hiring);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ hire_roles: [...next] });
  };
  const toggleFire = (id: string) => {
    const next = new Set(firing);
    next.has(id) ? next.delete(id) : next.add(id);
    set({ fire_roles: [...next] });
  };
  const fiOn = !!mods?.financialInstruments?.enabled;
  const fiCfg = mods?.financialInstruments;
  const noteOut = view.own.convertible_note ?? null;
  const rbfOut = Math.max(0, view.own.rbf_outstanding ?? 0);
  const instrDraws = fiOn ? Math.max(0, d?.draw_convertible ?? 0) + Math.max(0, d?.draw_rbf ?? 0) : 0;
  const maOn = !!mods?.ma?.enabled;
  const rivals = view.standings.filter((s) => !s.isYou && s.status === "active");
  const bid = d?.acquisition_bid ?? null;
  // M&A reads: distress is public; fair value + floor need market research.
  const researched = !!d?.buy_info || view.infoActive;
  const maMinDistress = mods?.ma?.min_distress_rounds ?? 1;
  const maFloorFrac = mods?.ma?.min_price_fraction ?? 0.75;
  const snapOf = (firmId: string) => view.firms.find((f) => f.firm_id === firmId);
  const maFloor = (firmId: string) => maFloorFrac * Math.max(0, snapOf(firmId)?.valuation ?? 0);
  // Geography (MOD-B01/B02): which markets are open + this firm's capacity split.
  const geoOn = !!mods?.geography?.enabled;
  const intlOn = !!mods?.international?.enabled;
  const markets = geoOn ? (mods!.geography.markets ?? []).filter((m) => m.kind !== "export" || intlOn) : [];
  const entered = view.own.markets_entered ?? ["home"];
  const marketWeights = d?.market_presence ?? { home: 1 };
  const setWeight = (id: string, v: number) => set({ market_presence: { ...marketWeights, [id]: Math.max(0, v) } });
  const geoEntrySpend = geoOn ? markets.filter((m) => m.kind !== "home" && (marketWeights[m.id] ?? 0) > 0 && !entered.includes(m.id)).reduce((a, m) => a + m.entry_cost, 0) : 0;

  const moduleSpend = prSpend + waterSpend + pgSpend + geoEntrySpend + rndSpend + vertSpend + hireSpend;
  const anyModuleControls = prOn || sustOn || pgOn || rndOn || vertOn || labOn || maOn;
  const setContribution = (goodId: string, v: number) => set({ public_good_contributions: { ...contribs, [goodId]: Math.max(0, v) } });
  const prEvent: GameEvent | null = prModal
    ? {
        id: "pr-plan", kind: "opportunity", title: "Plan a PR play",
        body: <>A tactical brand play spikes your buzz this round, then fades fast — tactical, not lasting. Costs {fmt.money(prCost)}.</>,
        detail: "Each angle costs the same; bigger splashes spike harder.",
        choices: [
          ...PR_PLAYS.map((p) => ({ id: p.id, label: p.label, description: p.description, tone: "solid" as const })),
          { id: "none", label: "Skip — no play this round", tone: "ghost" as const },
        ],
      }
    : null;
  const onPrChoose = (cid: string) => { set({ pr_action: cid === "none" ? null : (cid as PrPlayType) }); setPrModal(false); };

  const investSpend = d.invest_cap + d.invest_Q + d.invest_B + d.invest_process + d.invest_T_emp + d.invest_T_inv + d.invest_T_gov;
  const infoSpend = d.buy_info ? infoCost : 0;
  const financeOut = d.debt_repay + d.dividend;
  const financeIn = d.debt_draw + d.equity_raise;
  const netFinancing = financeIn - financeOut;
  const projectedCash = cash - investSpend - infoSpend - brewSpend - moduleSpend + netFinancing + instrDraws; // before this round's sales
  const overcommit = projectedCash < 0;

  const equity = view.own.paid_in_capital + view.own.retained_earnings;
  const leverage = view.own.debt / Math.max(equity, 1e-6);
  const lastCov = view.ownResult?.cost_of_capital.coverage ?? null;
  const lastRate = view.ownResult?.cost_of_capital.r_debt ?? null;

  // Desktop command-center: with expansion content on, the cards split into two
  // columns — run the brewery (left) and grow the empire (right) — so a wide
  // screen shows the whole round at once instead of a long scroll.
  const twoCol = geoOn || anyModuleControls;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <EventModal event={prEvent} onChoose={onPrChoose} onClose={() => setPrModal(false)} />
      {marketDetail && (() => {
        const m = markets.find((x) => x.id === marketDetail);
        if (!m) return null;
        return (
          <MarketDetail
            market={m}
            view={{ fx: view.fx }}
            weight={marketWeights[m.id] ?? (m.kind === "home" ? 1 : 0)}
            entered={m.kind === "home" || entered.includes(m.id)}
            perf={view.ownResult?.markets?.[m.id] ?? null}
            onClose={() => setMarketDetail(null)}
          />
        );
      })()}
      <div className={`grid content-start gap-4 ${twoCol ? "2xl:grid-cols-2" : ""}`}>
        <div className="grid min-w-0 content-start gap-4">
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
          {invOn && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold">Run the line at</label>
                <span className="tnum text-sm text-copperdeep">{Math.round(runRate * 100)}% of capacity</span>
              </div>
              <input
                type="range" min="0" max="100" step="5"
                value={Math.round(runRate * 100)}
                onChange={(e) => set({ run_rate: Math.max(0, Math.min(1, +e.target.value / 100)) })}
                className="mt-1 w-full"
              />
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] text-inksoft tnum">
                <span>brew ≈ {fmt.int(produced)} units</span>
                <span>in stock {fmt.int(stock)}</span>
                <span>→ {fmt.int(sellable)} sellable this round</span>
                {lastSold != null && <span>(sold {fmt.int(lastSold)} last round)</span>}
              </div>
              <div className="mt-1 text-[0.68rem] leading-snug text-inksoft">
                Brewing costs cash now ({fmt.money(brewSpend)}); unsold kegs carry over but a share spoils each round.
              </div>
            </div>
          )}
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
          {fiOn && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold">Alternative financing</span>
                <InfoDot title="Beyond plain debt">A convertible note is cheap cash now — but if you can't repay at maturity it converts into ownership (dilution). Revenue financing takes a slice of every round's sales until you've paid back {((fiCfg?.rbf.multiple ?? 1.3)).toFixed(1)}× what you drew — easy when sales dip, pricey when you boom.</InfoDot>
              </div>
              <div className="mt-1 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm">Convertible note</label>
                  {noteOut ? (
                    <div className="mt-1 text-[0.72rem] text-inksoft tnum">Outstanding: {fmt.money(noteOut.principal)} · matures r{noteOut.drawn_round + (fiCfg?.convertible.term ?? 4) + 1}</div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-inksoft">$</span>
                      <input type="number" step="50" min="0" value={d.draw_convertible ?? 0} onChange={(e) => set({ draw_convertible: Math.max(0, +e.target.value) })} className="w-28 text-right" />
                    </div>
                  )}
                  <div className="text-[0.66rem] leading-snug text-inksoft">{Math.round((fiCfg?.convertible.rate ?? 0.04) * 100)}%/round · repay in {fiCfg?.convertible.term ?? 4} rounds or it converts to equity.</div>
                </div>
                <div>
                  <label className="text-sm">Revenue financing</label>
                  {rbfOut > 0 ? (
                    <div className="mt-1 text-[0.72rem] text-inksoft tnum">Still owed: {fmt.money(rbfOut)} (paid from sales)</div>
                  ) : (
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-inksoft">$</span>
                      <input type="number" step="50" min="0" value={d.draw_rbf ?? 0} onChange={(e) => set({ draw_rbf: Math.max(0, +e.target.value) })} className="w-28 text-right" />
                    </div>
                  )}
                  <div className="text-[0.66rem] leading-snug text-inksoft">{Math.round((fiCfg?.rbf.payment_rate ?? 0.07) * 100)}% of each round's sales until {(fiCfg?.rbf.multiple ?? 1.3).toFixed(1)}× is repaid.</div>
                </div>
              </div>
            </div>
          )}
        </Card>

        </div>

        <div className="grid min-w-0 content-start gap-4">

        {/* Markets / worldview (MOD-B01 geography, MOD-B02 international) */}
        {geoOn && markets.length > 1 && (
          <Card>
            <div className="flex items-center gap-1.5">
              <Eyebrow>Markets</Eyebrow>
              <InfoDot title="Geographic strategy">Your capacity is split across the regions you run — entering a market trades home presence for reach. Regions have different tastes; your brand carries at a discount abroad. Export markets add tariffs &amp; currency swings.</InfoDot>
            </div>
            <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
              <div className="rounded-md border border-line bg-paper2/30 p-1">
                <WorldMap markets={markets} weights={marketWeights} entered={entered} />
              </div>
              <div className="grid content-start gap-2">
                <div className="text-[0.7rem] text-inksoft">Allocate capacity across markets (relative weights):</div>
                {markets.map((m) => {
                  const isIn = m.kind === "home" || entered.includes(m.id);
                  const w = marketWeights[m.id] ?? (m.kind === "home" ? 1 : 0);
                  return (
                    <div key={m.id}>
                      <div className="flex items-center justify-between">
                        <button type="button" onClick={() => setMarketDetail(m.id)} className="group flex items-center gap-1 text-left text-[0.78rem] font-semibold hover:text-copperdeep" title="Market profile">
                          {m.label}
                          <span className="text-[0.6rem] text-inksoft opacity-0 transition-opacity group-hover:opacity-100">ⓘ</span>
                          {m.kind === "export" && <span className="ml-1 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-hop">export · {Math.round(m.tariff_rate * 100)}% tariff{view.fx[m.id] != null ? ` · FX ${view.fx[m.id].toFixed(2)}` : ""}</span>}
                          {m.kind === "domestic" && <span className="ml-1 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-copperdeep">region</span>}
                        </button>
                        {!isIn && m.entry_cost > 0 && (marketWeights[m.id] ?? 0) > 0 && <span className="text-[0.64rem] text-brick">enter · {fmt.money(m.entry_cost)}</span>}
                      </div>
                      <input type="range" min="0" max="100" step="5" value={Math.round(w * 100)} onChange={(e) => setWeight(m.id, +e.target.value / 100)} className="w-full" />
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {/* Expansion-module plays & programs (only the enabled ones render) */}
        {anyModuleControls && (
          <Card>
            <div className="flex items-center gap-1.5">
              <Eyebrow>Plays &amp; Programs</Eyebrow>
              <InfoDot title="Expansion modes">These controls appear because your instructor enabled extra modes for this game. They're off in a standard game.</InfoDot>
            </div>

            {prOn && (
              <div className="mt-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold">Tactical PR</span>
                  {prOnCooldown ? (
                    <span className="text-[0.72rem] text-inksoft">On cooldown · ready round {(prCooldownUntil ?? 0) + 1}</span>
                  ) : d.pr_action ? (
                    <span className="flex items-center gap-2 text-[0.72rem]">
                      <Tag tone="hop">{PR_LABEL[d.pr_action]}</Tag>
                      <button className="text-inksoft underline hover:text-ink" onClick={() => set({ pr_action: null })}>clear</button>
                    </span>
                  ) : (
                    <Button onClick={() => setPrModal(true)} className="px-3 py-1 text-[0.72rem]">Plan a PR play →</Button>
                  )}
                </div>
                <div className="mt-1 text-[0.68rem] leading-snug text-inksoft">
                  A one-off brand splash ({fmt.money(prCost)}) that spikes buzz then decays fast. {view.own.pr_spike > 0.1 ? `Current buzz +${view.own.pr_spike.toFixed(1)}.` : ""}
                </div>
              </div>
            )}

            {sustOn && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">Water efficiency</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(waterSpend)}</span>
                </div>
                <input type="range" min="0" max={Math.max(200, Math.round(cash * 0.3))} step="10" value={waterSpend} onChange={(e) => set({ invest_water_efficiency: +e.target.value })} className="mt-1 w-full" />
                <div className="text-[0.68rem] leading-snug text-inksoft">
                  Builds resilience to the water shock &amp; earns regulator goodwill. {view.own.water_efficiency > 0.1 ? `Efficiency stock ${view.own.water_efficiency.toFixed(1)}.` : ""}
                </div>
              </div>
            )}

            {rndOn && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">R&amp;D — the new category</span>
                  <span className="tnum text-xs text-inksoft">{fmt.money(rndSpend)}</span>
                </div>
                <input type="range" min="0" max={Math.max(300, Math.round(cash * 0.4))} step="10" value={rndSpend} onChange={(e) => set({ invest_rnd: +e.target.value })} className="mt-1 w-full" />
                <div className="text-[0.68rem] leading-snug text-inksoft">
                  {frontierActive ? "The frontier category is open — R&D no longer pulls it forward." : "Race to open the frontier category early; the leader gets a first-mover head start."}
                  {view.own.rnd_progress > 0.1 ? ` Your progress ${view.own.rnd_progress.toFixed(0)}.` : ""}
                </div>
              </div>
            )}

            {pgOn && goods.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Industry guild</span>
                  <InfoDot title="Public goods">Contributions are a private cost; the benefit is shared by the whole industry. Fund it together — or free-ride and hope others do.</InfoDot>
                </div>
                <div className="mt-1 grid gap-2">
                  {goods.map((g) => (
                    <div key={g.id} className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[0.78rem] font-semibold">{GOOD_LABEL[g.id] ?? g.id}</div>
                        <div className="text-[0.66rem] leading-snug text-inksoft">{GOOD_BLURB[g.benefit] ?? ""}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-inksoft">$</span>
                        <input type="number" step="10" min="0" value={contribs[g.id] ?? 0} onChange={(e) => setContribution(g.id, +e.target.value)} className="w-20 text-right" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vertOn && vertAssets.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Vertical moves</span>
                  <InfoDot title="Own your supply chain">Buying upstream cuts what each barrel costs to make; buying distribution cuts your regulatory drag — but visible vertical control draws antitrust attention. Benefits switch on after the integration period.</InfoDot>
                </div>
                <div className="mt-1 grid gap-2">
                  {vertAssets.map((a) => {
                    const has = owned.has(a.id);
                    const queued = buying.has(a.id);
                    return (
                      <div key={a.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[0.78rem] font-semibold">
                            {a.label}
                            <span className="ml-1 font-mono text-[0.56rem] uppercase tracking-[0.1em] text-copperdeep">{a.type}</span>
                          </div>
                          <div className="text-[0.66rem] leading-snug text-inksoft">
                            {a.type === "upstream" ? `−${Math.round(a.unit_cost_reduction * 100)}% unit cost` : `−${Math.round(a.reg_relief * 100)}% regulatory drag`} · online in {a.integration_lag} rounds · {fmt.money(a.cost)}
                          </div>
                        </div>
                        {has ? (
                          <Tag tone="hop">Owned</Tag>
                        ) : (
                          <Button onClick={() => toggleBuy(a.id)} variant={queued ? "go" : "solid"} className="px-3 py-1 text-[0.72rem]">
                            {queued ? "Buying ✓" : "Buy"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {labOn && labRoles.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Key people</span>
                  <InfoDot title="The talent market">You hire specialists from an open talent market — you're not poaching a specific rival, you're competing for scarce talent. A hire boosts a capability the day they start and takes it with them if they leave. <b>Rivals can poach your people</b> each round; a strong crew culture (employee trust) is what keeps them home. You can see who staffs which rivals in a brewery's dossier.</InfoDot>
                </div>
                <div className="mb-1.5 text-[0.66rem] leading-snug text-inksoft">
                  Retention this round: <span className={retentionTone}>{retentionLabel}</span> — driven by your {STOCK_LABEL.T_emp.toLowerCase()}.
                </div>
                <div className="mt-1 grid gap-2">
                  {labRoles.map((r) => {
                    const employed = onStaff.has(r.id);
                    const queued = hiring.has(r.id);
                    const leaving = firing.has(r.id);
                    const bonusTxt = Object.entries(r.bonus).map(([k, v]) => `+${v} ${STOCK_LABEL[k as "Q"] ?? k}`).join(", ");
                    return (
                      <div key={r.id} className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[0.78rem] font-semibold">{r.label}{employed && <span className="ml-1 text-[0.6rem] text-inksoft">· at risk of poaching</span>}</div>
                          <div className="text-[0.66rem] leading-snug text-inksoft">{bonusTxt} · {fmt.money(r.salary)}/round{!employed ? ` · ${fmt.money(r.signing_bonus)} signing` : ""}</div>
                        </div>
                        {employed ? (
                          <Button onClick={() => toggleFire(r.id)} variant="ghost" className="px-3 py-1 text-[0.72rem]">{leaving ? "Leaving ✗" : "On staff · let go?"}</Button>
                        ) : (
                          <Button onClick={() => toggleHire(r.id)} variant={queued ? "go" : "solid"} className="px-3 py-1 text-[0.72rem]">{queued ? "Hiring ✓" : "Hire"}</Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {maOn && rivals.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">Acquisitions</span>
                  <InfoDot title="Buying a rival">A bid only lands on a rival in real financial distress (struggling for {maMinDistress}+ rounds), and only at or above a fair-value floor. If it lands you absorb part of their capacity and brand — and all of their debt. Buy market research to see each rival's fair value.</InfoDot>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {rivals.map((r) => {
                    const isBid = bid?.target === r.firm_id;
                    const snap = snapOf(r.firm_id);
                    const targetable = snap ? snap.distressRounds >= maMinDistress : false;
                    return (
                      <button
                        key={r.firm_id}
                        type="button"
                        aria-pressed={isBid}
                        onClick={() => set({ acquisition_bid: isBid ? null : { target: r.firm_id, price: bid?.price ?? Math.round(maFloor(r.firm_id) || 500) } })}
                        title={targetable ? "In distress — acquirable" : "Not currently acquirable"}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.72rem] font-semibold transition-colors ${isBid ? "border-copper bg-copper/10 text-copperdeep" : "border-line2 text-inksoft hover:border-copper hover:text-ink"}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${targetable ? "bg-brick" : "bg-line2"}`} />
                        {r.name}
                      </button>
                    );
                  })}
                </div>
                {bid ? (() => {
                  const snap = snapOf(bid.target);
                  const targetable = snap ? snap.distressRounds >= maMinDistress : false;
                  const floor = maFloor(bid.target);
                  return (
                    <div className="mt-2 grid gap-2 rounded-md border border-line bg-paper2/40 p-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[0.78rem] text-inksoft">Your offer</span>
                        <span className="flex items-center gap-1">
                          <span className="text-inksoft">$</span>
                          <input type="number" step="50" min="0" value={bid.price} onChange={(e) => set({ acquisition_bid: { ...bid, price: Math.max(0, +e.target.value) } })} className="w-24 text-right" />
                        </span>
                        <Tag tone={targetable ? "hop" : "ink"}>{targetable ? "Distressed · acquirable" : "Not in distress"}</Tag>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[0.7rem] text-inksoft tnum">
                        {researched && snap ? (
                          <>
                            <span>fair value ≈ {fmt.money(snap.valuation)}</span>
                            <span className={bid.price >= floor ? "text-hop" : "text-brick"}>floor ≈ {fmt.money(floor)} {bid.price >= floor ? "✓ cleared" : "✗ too low"}</span>
                          </>
                        ) : (
                          <span>Buy market research to see their fair value &amp; the bid floor.</span>
                        )}
                      </div>
                      <div className="text-[0.64rem] leading-snug text-inksoft">Settles after the round only if they're distressed and your offer clears the floor — otherwise nothing happens and you keep your cash.</div>
                    </div>
                  );
                })() : (
                  <div className="mt-1 text-[0.66rem] leading-snug text-inksoft">Tap a rival to prepare a bid — a red dot marks one that's distressed enough to acquire. No bid goes out otherwise.</div>
                )}
              </div>
            )}
          </Card>
        )}

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
      </div>

      {/* Pre-submission indicators — pinned on desktop so projected cash and the
          submit button never scroll away while tuning levers */}
      <div className="grid content-start gap-4 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <Eyebrow>Before You Brew</Eyebrow>
          <Row label="Cash on hand" value={fmt.money(cash)} />
          {invOn && <Row label="− Brewing this round" value={fmt.money(brewSpend)} />}
          {moduleSpend > 0 && <Row label="− Plays, programs & entry" value={fmt.money(moduleSpend)} />}
          {instrDraws > 0 && <Row label="+ Alternative financing" value={<span className="text-hop">{fmt.signed(instrDraws)}</span>} />}
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
