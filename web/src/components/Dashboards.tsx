/**
 * Analytics dashboards — the causal-chain spine of the design spec (§05).
 * Waterfalls/bridges + cockpit dials that make "decision → economics → outcome"
 * legible: P&L bridge, unit-cost build-up, cash bridge, capacity vs demand,
 * EVA bars, DuPont decomposition, rank bump, cost-of-capital dials, and the
 * firm's state small-multiples.
 *
 * Purely presentational: props are already-computed engine/controller data.
 * Dependency-free SVG in the house editorial style (see charts.tsx). Reuses
 * charts.RadialScore (ScorecardRadar is a thin alias) and Sparkline; the
 * generic <Bridge> here is the finer-grained sibling of charts.Waterfall
 * (which stays as the coarse 5-step round-report bridge).
 */
import { useId } from "react";
import type { ReactNode } from "react";
import type { Config, PnL, CashFlow, FirmRoundResult } from "drinkwars-engine";
import type { GameView, FirmSnapshot, Standing } from "../game/controller.js";
import { fmt, MONEY_DISPLAY, STOCK_LABEL } from "../labels.js";
import { RadialScore, Legend } from "./charts.js";
import { Sparkline } from "./Sparkline.js";
import { Tag } from "./ui.js";
import { InfoDot } from "./InfoDot.js";

// ── palette shorthands (theme css vars — light/dark aware) ──────────────────
const INK = "var(--color-ink)";
const SOFT = "var(--color-inksoft)";
const LINE = "var(--color-line2)";
const HOP = "var(--color-hop)"; // good / up
const BRICK = "var(--color-brick)"; // bad / down
const COPPER = "var(--color-copper)"; // you / anchor totals
const AERO = "var(--color-aero)";
const CLAY = "var(--color-clay)"; // neutral subtotals

// ── tiny shared helpers ──────────────────────────────────────────────────────
/** Finite-or-default guard: every derived number funnels through this. */
const fin = (n: unknown, d = 0): number => (typeof n === "number" && Number.isFinite(n) ? n : d);

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const trunc = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** Compact money for in-chart labels ($1.4k / $2.3M), at the app display scale. */
const moneyC = (raw: number): string => {
  const n = fin(raw) * MONEY_DISPLAY;
  const a = Math.abs(n);
  const sign = n < 0 ? "−$" : "$";
  if (a >= 1e6) return sign + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + "M";
  if (a >= 1000) return sign + (a / 1000).toFixed(a >= 1e4 ? 0 : 1) + "k";
  return sign + Math.round(a);
};
const moneyCSigned = (n: number): string => (fin(n) >= 0 ? "+" + moneyC(n) : moneyC(n));
const priceSigned = (n: number): string => `${fin(n) < 0 ? "−$" : "+$"}${Math.abs(fin(n)).toFixed(2)}`;

/** SVG text in the house style (IBM Plex labels; tabular body figures for numbers). */
function T({ x, y, children, fill = INK, size = 10, weight = 500, anchor = "start", tab = false }: { x: number; y: number; children: ReactNode; fill?: string; size?: number; weight?: number; anchor?: "start" | "middle" | "end"; tab?: boolean }) {
  return (
    <text x={x} y={y} fill={fill} fontSize={size} fontWeight={weight} textAnchor={anchor} fontFamily={tab ? "var(--font-body)" : "'IBM Plex Sans', sans-serif"} style={tab ? { fontVariantNumeric: "tabular-nums lining-nums" } : undefined}>
      {children}
    </text>
  );
}

/** One-line caption under a chart (house style: 0.66rem inksoft). */
function Cap({ children }: { children: ReactNode }) {
  return <div className="mt-1 text-[0.66rem] text-inksoft">{children}</div>;
}

/** Pre-resolution / empty-data placeholder — every dashboard renders this instead of throwing. */
function Pending({ note = "Opens after your first round resolves." }: { note?: string }) {
  return <div className="text-xs text-inksoft">{note}</div>;
}

const legend = (items: [string, string][]) => <Legend series={items.map(([label, color]) => ({ label, color, data: [] as number[] }))} />;

// ── generic waterfall bridge (shared by P&L / unit-cost / cash / scorecard bridges) ─────
export interface BridgeStep {
  label: string;
  /** Signed increment from the running level. Exactly one of delta/total per step. */
  delta?: number;
  /** Anchors the bar at the axis (opening balances, subtotals, closing totals). */
  total?: number;
  color?: string;
  /** Hover tooltip override (native <title>). */
  title?: string;
}

export function Bridge({ steps, fmtDelta, fmtTotal, vh = 168 }: { steps: BridgeStep[]; fmtDelta: (n: number) => string; fmtTotal: (n: number) => string; vh?: number }) {
  const clean = steps.filter((s) => Number.isFinite(s.total ?? s.delta ?? NaN));
  if (clean.length === 0) return <Pending />;
  const VW = 340, padL = 6, padT = 16;
  const stagger = clean.length > 6; // two-row x labels once the chain gets long
  const padB = stagger ? 30 : 22;
  let run = 0;
  const spans: [number, number][] = clean.map((s) => {
    if (s.total != null) { run = s.total; return [0, s.total]; }
    const a = run;
    run += s.delta ?? 0;
    return [a, run];
  });
  const flat = spans.flat().concat(0);
  let mn = Math.min(...flat), mx = Math.max(...flat);
  if (!(mx > mn)) mx = mn + 1;
  mx += (mx - mn) * 0.12; // headroom for value labels
  if (mn < 0) mn -= (mx - mn) * 0.05;
  const yOf = (v: number) => padT + (1 - (v - mn) / (mx - mn)) * (vh - padT - padB);
  const gap = (VW - padL * 2) / clean.length;
  const bw = Math.min(34, gap * 0.62);
  return (
    <svg width="100%" viewBox={`0 0 ${VW} ${vh}`} style={{ display: "block" }}>
      <line x1={padL} y1={yOf(0)} x2={VW - padL} y2={yOf(0)} stroke={LINE} strokeWidth={1} />
      {clean.map((s, i) => {
        const cx = padL + gap * i + gap / 2;
        const [a, b] = spans[i];
        const y1 = yOf(Math.max(a, b)), y2 = yOf(Math.min(a, b));
        const isTotal = s.total != null;
        const d = s.delta ?? 0;
        const color = s.color ?? (isTotal ? COPPER : d >= 0 ? HOP : BRICK);
        const lblY = stagger && i % 2 === 1 ? vh - 4 : vh - (stagger ? 14 : 8);
        return (
          <g key={`${s.label}-${i}`}>
            <title>{s.title ?? `${s.label}: ${isTotal ? fmtTotal(b) : fmtDelta(d)}`}</title>
            <rect x={cx - bw / 2} y={y1} width={bw} height={Math.max(1.5, y2 - y1)} fill={color} rx={2} opacity={isTotal ? 1 : 0.9} />
            <T x={cx} y={y1 - 3} anchor="middle" size={8} weight={600} tab>{isTotal ? fmtTotal(b) : fmtDelta(d)}</T>
            <T x={cx} y={lblY} anchor="middle" size={8.5} fill={SOFT}>{s.label}</T>
            {i < clean.length - 1 && (
              <line x1={cx + bw / 2} y1={yOf(spans[i][1])} x2={cx + gap - bw / 2} y2={yOf(spans[i][1])} stroke={SOFT} strokeWidth={1} strokeDasharray="2 2" opacity={0.55} />
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · P&L bridge
// ─────────────────────────────────────────────────────────────────────────────

/** Full income-statement waterfall: Revenue → −COGS → Gross → −Opex → −Spoilage →
 *  −Depreciation → EBIT → −Interest → Net income. Green up / red down; subtotals
 *  anchored to the baseline. (charts.Waterfall stays as the coarse 5-step version.) */
export function PnLBridge({ pnl }: { pnl: PnL }) {
  if (!pnl || !Number.isFinite(pnl.revenue)) return <Pending />;
  const spoil = fin(pnl.spoilage);
  const steps: BridgeStep[] = [
    { label: "Revenue", total: fin(pnl.revenue), color: COPPER },
    { label: "COGS", delta: -fin(pnl.cogs) },
    { label: "Gross", total: fin(pnl.gross), color: CLAY },
    { label: "Opex", delta: -fin(pnl.opex) },
    ...(spoil > 0.005 ? [{ label: "Spoil", delta: -spoil }] : []),
    { label: "Depr", delta: -fin(pnl.depreciation) },
    { label: "EBIT", total: fin(pnl.ebit), color: CLAY },
    { label: "Int", delta: -fin(pnl.interest) },
    { label: "Net", total: fin(pnl.net_income), color: fin(pnl.net_income) >= 0 ? HOP : BRICK },
  ];
  return (
    <div>
      <Bridge steps={steps} fmtDelta={moneyCSigned} fmtTotal={moneyC} />
      {legend([["adds", HOP], ["takes away", BRICK], ["subtotal", CLAY]])}
      <Cap>Revenue stepping down through every cost line to net income{spoil <= 0.005 ? " (no spoilage this round)" : ""}.</Cap>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Cash bridge
// ─────────────────────────────────────────────────────────────────────────────

/** Cash-flow bridge: operating → investing (capex out / divest in, already signed) →
 *  financing → net change. Pass `opening` (e.g. last round's cash) to anchor it as
 *  opening → closing balances; without it the bridge shows the round's Δ cash from zero.
 *  Any gap between the three flows and delta_cash is the shock cash hit — shown as its own step. */
export function CashBridge({ cash, opening }: { cash: CashFlow; opening?: number }) {
  if (!cash || !Number.isFinite(cash.delta_cash)) return <Pending />;
  const op = fin(cash.operating), inv = fin(cash.investing), finc = fin(cash.financing), dc = fin(cash.delta_cash);
  const resid = dc - (op + inv + finc); // engine: delta_cash = o+i+f − shock cash hit
  const scale = Math.max(Math.abs(op), Math.abs(inv), Math.abs(finc), Math.abs(dc), 1);
  const anchored = opening != null && Number.isFinite(opening);
  const steps: BridgeStep[] = [
    ...(anchored ? [{ label: "Open", total: opening as number, color: CLAY }] : []),
    { label: "Operating", delta: op },
    { label: "Investing", delta: inv, title: `Investing (capex out / divest in): ${moneyCSigned(inv)}` },
    { label: "Financing", delta: finc },
    ...(Math.abs(resid) > 1e-6 * scale ? [{ label: "Shock", delta: resid, color: BRICK, title: `Shock cash hit: ${moneyCSigned(resid)}` }] : []),
    anchored
      ? { label: "Close", total: (opening as number) + dc, color: COPPER }
      : { label: "Δ Cash", total: dc, color: dc >= 0 ? HOP : BRICK },
  ];
  return (
    <div>
      <Bridge steps={steps} fmtDelta={moneyCSigned} fmtTotal={moneyC} />
      {legend([["cash in", HOP], ["cash out", BRICK]])}
      <Cap>{anchored ? "Opening cash walked through the three flows to the closing balance." : "The round's three cash flows, summing to the net change in cash."}</Cap>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · Capacity vs demand — the key operational chart
// ─────────────────────────────────────────────────────────────────────────────

/** What buyers wanted vs what you sold vs what you could brew. Hatched red =
 *  lost sales (demand above what you supplied); hatched grey = idle tanks
 *  (capacity above what you sold). The dashed rule marks capacity everywhere. */
export function CapacityVsDemand({ result, cap }: { result: FirmRoundResult; cap: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const segs = Object.values(result?.segments ?? {});
  const desired = segs.reduce((a, s) => a + Math.max(0, fin(s?.q_desired)), 0);
  const sold = segs.reduce((a, s) => a + Math.max(0, fin(s?.q_sold)), 0);
  const capV = Math.max(0, fin(cap));
  const max = Math.max(desired, sold, capV);
  if (!(max > 0)) return <Pending />;

  const VW = 340, padL = 62, padR = 48, padT = 14, rowH = 30, bh = 14;
  const VH = padT + rowH * 3 + 4;
  const w = (v: number) => (Math.min(v, max) / max) * (VW - padL - padR);
  const lost = Math.max(0, desired - sold);
  const idle = Math.max(0, capV - sold);
  // The bar totals net spillover in one category against a shortfall in another, so the
  // firm-wide `lost` is NOT the number any per-category line shows — the caption used to
  // publish 2,036u beside a detail row reading 10,131 unserved, on the same screen. Sum the
  // per-category gaps separately so the caption says the same thing the detail does.
  const unservedGross = segs.reduce((a, x) => a + Math.max(0, fin(x?.q_desired) - fin(x?.q_sold)), 0);
  const spillGross = segs.reduce((a, x) => a + Math.max(0, fin(x?.q_sold) - fin(x?.q_desired)), 0);
  const rowY = (i: number) => padT + rowH * i + (rowH - bh) / 2;
  const capX = padL + w(capV);

  // `solidTo` stops the solid fill short of `main`, so the hatched remainder reads as a
  // different KIND of thing (idle tanks) rather than a faint texture over the same bar.
  const row = (i: number, label: string, main: number, mainColor: string, hatch?: { from: number; to: number; pattern: string; tag: string; tagColor: string; outline?: string }, solidTo?: number) => {
    const y = rowY(i);
    return (
      <g key={label}>
        <title>{`${label}: ${fmt.int(main)} units`}</title>
        <T x={padL - 6} y={y + bh - 3} anchor="end" size={9} fill={SOFT}>{label}</T>
        <rect x={padL} y={y} width={Math.max(1, w(solidTo ?? main))} height={bh} fill={mainColor} rx={2} />
        {hatch && hatch.to > hatch.from && (
          <g>
            <title>{`${hatch.tag}: ${fmt.int(hatch.to - hatch.from)} units`}</title>
            <rect x={padL + w(hatch.from)} y={y} width={Math.max(1, w(hatch.to) - w(hatch.from))} height={bh} fill={`url(#${hatch.pattern})`} stroke={hatch.outline} strokeWidth={hatch.outline ? 1 : 0} strokeDasharray={hatch.outline ? "3 2" : undefined} rx={2} />
            {w(hatch.to) - w(hatch.from) > 52 && (
              <T x={padL + (w(hatch.from) + w(hatch.to)) / 2} y={y + bh - 4} anchor="middle" size={7.5} weight={600} fill={hatch.tagColor}>{hatch.tag}</T>
            )}
          </g>
        )}
        <T x={padL + w(Math.max(main, hatch?.to ?? 0)) + 4} y={y + bh - 3} size={8.5} fill={INK} tab>{fmt.int(main)}</T>
      </g>
    );
  };

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <defs>
          <pattern id={`lost${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill={BRICK} opacity="0.12" />
            <line x1="0" y1="0" x2="0" y2="5" stroke={BRICK} strokeWidth="1.4" opacity="0.8" />
          </pattern>
          <pattern id={`idle${uid}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill={CLAY} opacity="0.10" />
            <line x1="0" y1="0" x2="0" y2="5" stroke={CLAY} strokeWidth="1.6" opacity="0.85" />
          </pattern>
        </defs>
        {row(0, "First choice", desired, AERO)}
        {row(1, "Sold", sold, COPPER, lost > 0 ? { from: sold, to: desired, pattern: `lost${uid}`, tag: "unserved", tagColor: BRICK } : undefined)}
        {row(2, "Capacity", capV, CLAY, idle > 0 ? { from: sold, to: capV, pattern: `idle${uid}`, tag: "idle", tagColor: INK, outline: CLAY } : undefined, Math.min(sold, capV))}
        <line x1={capX} y1={padT - 6} x2={capX} y2={VH - 2} stroke={INK} strokeWidth={1} strokeDasharray="3 2" opacity={0.6} />
        <T x={capX} y={padT - 8 + 1} anchor="middle" size={7.5} fill={SOFT}>cap</T>
      </svg>
      {legend([["first-choice demand", AERO], ["sold", COPPER], ["unserved (hatched)", BRICK], ["capacity in use", CLAY]])}
      <div className="mt-0.5 text-[0.62rem] text-inksoft">Hatched, dashed outline on the Capacity row = <b>idle tanks</b>: capacity you own and pay upkeep on but did not brew into.</div>
      <Cap>
        {unservedGross > 0.5 && (
          <span className="text-brick">Unserved demand {fmt.int(unservedGross)}u — buyers who chose you and could not be served. </span>
        )}
        {spillGross > 0.5 && (
          <span className="text-hop">Spillover +{fmt.int(spillGross)}u — rivals ran out and some of their buyers settled for you. </span>
        )}
        {unservedGross > 0.5 && spillGross > 0.5 && (
          <span>Net, the bars are {fmt.int(Math.abs(desired - sold))}u {desired > sold ? "short" : "long"}: you turned buyers away in one category while catching a rival's overflow in another. </span>
        )}
        {unservedGross <= 0.5 && spillGross <= 0.5 && "Every buyer who chose you was served. "}
        {idle > 0.5 ? <span>Idle capacity {fmt.int(idle)}u paying upkeep for nothing.</span> : "Every tank earned its keep."}
      </Cap>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · EVA-style bars
// ─────────────────────────────────────────────────────────────────────────────

/** Per-round economic profit ≈ net income − a 2.5%/qtr capital charge on book
 *  equity (the game's benchmark borrowing rate). Green above the hurdle, red
 *  below. APPROXIMATION: the round trend carries no ROIC/WACC, so this proxies
 *  EVA with an equity charge rather than a true invested-capital × spread. */
export function EvaBars({ history, finance }: { history: GameView["history"]; finance?: Config["finance"] }) {
  const rows = (history ?? []).map((h) => h.own).filter((o) => o && Number.isFinite(o.netIncome));
  if (rows.length === 0) return <Pending />;
  // The hurdle is what a well-covered borrower pays: risk-free + the base spread, per quarter.
  // Read from config (DW-056) rather than hardcoded — it was a literal 0.025 with a comment
  // pinning it to the then-current defaults, which is exactly the kind of constant that goes
  // quietly wrong the next time the spreads are retuned.
  const HURDLE = (finance?.r_f ?? 0.015) + (finance?.base_spread ?? 0.01);
  const eva = rows.map((o) => fin(o.netIncome) - HURDLE * Math.max(0, fin(o.equity)));
  const VW = 320, VH = 128, padL = 6, padT = 14, padB = 18;
  let mn = Math.min(0, ...eva), mx = Math.max(0, ...eva);
  if (!(mx > mn)) mx = mn + 1;
  mx += (mx - mn) * 0.1;
  if (mn < 0) mn -= (mx - mn) * 0.06;
  const yOf = (v: number) => padT + (1 - (v - mn) / (mx - mn)) * (VH - padT - padB);
  const gap = (VW - padL * 2) / rows.length;
  const bw = Math.min(26, gap * 0.7);
  const every = Math.max(1, Math.ceil(rows.length / 8));
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <line x1={padL} y1={yOf(0)} x2={VW - padL} y2={yOf(0)} stroke={LINE} strokeWidth={1} />
        {rows.map((o, i) => {
          const v = eva[i];
          const cx = padL + gap * i + gap / 2;
          const y1 = yOf(Math.max(0, v)), y2 = yOf(Math.min(0, v));
          return (
            <g key={o.round}>
              <title>{`Round ${o.round}: ${moneyCSigned(v)} economic profit`}</title>
              <rect x={cx - bw / 2} y={y1} width={bw} height={Math.max(1.5, y2 - y1)} fill={v >= 0 ? HOP : BRICK} rx={2} opacity={0.9} />
              {i % every === 0 && <T x={cx} y={VH - 5} anchor="middle" size={8} fill={SOFT}>R{o.round}</T>}
              {i === rows.length - 1 && <T x={cx} y={(v >= 0 ? y1 : y2 + 8) - (v >= 0 ? 3 : 0)} anchor="middle" size={8} weight={600} tab>{moneyCSigned(v)}</T>}
            </g>
          );
        })}
      </svg>
      {legend([["value created", HOP], ["value destroyed", BRICK]])}
      <Cap>Economic profit ≈ net income − 2.5%/qtr charge on book equity — an approximation; the trend data carries no true ROIC−WACC.</Cap>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · DuPont decomposition
// ─────────────────────────────────────────────────────────────────────────────

function FactorRow({ label, you, youText, field, fieldText, negative }: { label: string; you: number | null; youText: string; field: number | null; fieldText: string; negative?: boolean }) {
  const scale = Math.max(Math.abs(you ?? 0), Math.abs(field ?? 0)) * 1.25 || 1;
  const pctW = (v: number) => `${Math.min(100, (Math.abs(v) / scale) * 100)}%`;
  return (
    <div className="py-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-inksoft">{label}</span>
        <span className="tnum">
          <span className={`font-semibold ${negative ? "text-brick" : "text-copperdeep"}`}>{youText}</span> <span className="text-inksoft">· field {fieldText}</span>
        </span>
      </div>
      <div className="relative mt-1 h-2 w-full rounded-[2px] bg-line">
        {you != null && <div className="absolute top-0 h-full rounded-[2px]" style={{ width: pctW(you), background: negative ? BRICK : COPPER }} />}
        {field != null && <div className="absolute top-[-2px] h-3 w-[2px] bg-ink" style={{ left: pctW(field) }} title="field median" />}
      </div>
    </div>
  );
}

/** ROE decomposed the DuPont way — net margin × asset turnover × equity multiplier —
 *  you (exact, from your statements) vs the field median where it's derivable from
 *  public snapshots. Rivals publish no income statement, so field margin/turnover
 *  aren't knowable; their multiplier (1 + D/E) is exact, their ROE only for
 *  debt-carrying rivals (equity backed out as debt ÷ leverage). */
export function DuPont({ you, result, field }: { you: FirmSnapshot; result: FirmRoundResult; field: FirmSnapshot[] }) {
  const rev = fin(result?.pnl?.revenue);
  const ni = fin(result?.pnl?.net_income);
  const assets = fin(result?.balance_sheet?.assets);
  const eq = fin(result?.balance_sheet?.equity);
  if (!(rev > 0) || !(assets > 0)) return <Pending />;

  const margin = ni / rev;
  const turnover = rev / assets;
  const mult = eq > 1e-6 ? assets / eq : null;
  const roe = eq > 1e-6 ? ni / eq : null;

  const rivals = (field ?? []).filter((f) => f && !f.isYou);
  const active = rivals.filter((f) => f.status === "active");
  const pool = active.length > 0 ? active : rivals;
  const fMult = pool.length ? median(pool.map((f) => 1 + Math.max(0, fin(f.leverage)))) : null;
  const roePool = pool.filter((f) => fin(f.leverage) > 1e-4 && fin(f.debt) > 0).map((f) => fin(f.netIncome) / (fin(f.debt) / fin(f.leverage)));
  const fRoe = roePool.length ? median(roePool) : null;

  return (
    <div>
      <div className="tnum text-sm text-ink">
        {fmt.pct1(margin)} <span className="text-inksoft">margin</span> × {turnover.toFixed(2)}× <span className="text-inksoft">turnover</span> × {mult != null ? `${mult.toFixed(2)}×` : "—"} <span className="text-inksoft">leverage</span> ={" "}
        <span className={`font-semibold ${roe != null && roe < 0 ? "text-brick" : "text-copperdeep"}`}>{roe != null ? fmt.pct1(roe) : "n/a"}</span> <span className="text-inksoft">ROE</span>
      </div>
      <div className="mt-1">
        <FactorRow label="Net margin" you={margin} youText={fmt.pct1(margin)} field={null} fieldText="not public" negative={margin < 0} />
        <FactorRow label="Asset turnover" you={turnover} youText={`${turnover.toFixed(2)}×`} field={null} fieldText="not public" />
        <FactorRow label="Equity multiplier" you={mult} youText={mult != null ? `${mult.toFixed(2)}×` : "equity ≤ 0"} field={fMult} fieldText={fMult != null ? `${fMult.toFixed(2)}×` : "—"} />
        <FactorRow label="= Return on equity" you={roe} youText={roe != null ? fmt.pct1(roe) : "equity ≤ 0"} field={fRoe} fieldText={fRoe != null ? fmt.pct1(fRoe) : "—"} negative={(roe ?? 0) < 0} />
      </div>
      <Cap>
        {you?.name ?? "You"} vs field median (tick). Rivals publish no statements — field margin/turnover aren&apos;t derivable; their multiplier comes from reported debt/equity, their ROE only from debt-carrying rivals.
      </Cap>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · Scorecard radar — thin alias over the existing charts.RadialScore
// ─────────────────────────────────────────────────────────────────────────────

type ScorePillars = FirmRoundResult["scorecard_norm"];

/** Four-pillar scorecard radar (financial / market / intangible / stakeholder),
 *  you vs an optional field average. Thin wrapper over charts.RadialScore —
 *  no new radar; kept here so the dashboard suite has one import surface. */
export function ScorecardRadar({ you, field }: { you: ScorePillars; field?: ScorePillars | null }) {
  if (!you || !Number.isFinite(you.financial)) return <Pending />;
  return <RadialScore you={you} field={field ?? null} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8 · Rank bump
// ─────────────────────────────────────────────────────────────────────────────

/** Your rank flowing across rounds (1 on top), with today's full standings pinned
 *  at the right edge. LIMITATION: only your own per-round rank is recorded in the
 *  trend — rivals appear at their current position, not as historical lines. */
export function RankBump({ history, standings }: { history: GameView["history"]; standings: Standing[] }) {
  const rows = (history ?? []).map((h) => h.own).filter((o) => o && fin(o.rank) > 0);
  if (rows.length === 0) return <Pending />;
  const N = Math.max(2, standings?.length ?? 0, ...rows.map((o) => Math.round(fin(o.rank, 1))));
  const VW = 340, plotR = 222, padL = 22, padT = 12, padB = 18;
  const VH = Math.max(96, Math.min(200, 30 + N * 17));
  const y = (rank: number) => padT + ((rank - 1) / (N - 1)) * (VH - padT - padB);
  const x = (i: number) => padL + (rows.length <= 1 ? 0 : (i / (rows.length - 1)) * (plotR - padL));
  const pts = rows.map((o, i) => `${x(i).toFixed(1)},${y(fin(o.rank, N)).toFixed(1)}`).join(" ");
  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        {N <= 10 && Array.from({ length: N }, (_, i) => (
          <line key={i} x1={padL} y1={y(i + 1)} x2={plotR} y2={y(i + 1)} stroke={LINE} strokeWidth={0.75} opacity={0.35} />
        ))}
        <T x={padL - 6} y={y(1) + 3} anchor="end" size={8} fill={SOFT} tab>1</T>
        <T x={padL - 6} y={y(N) + 3} anchor="end" size={8} fill={SOFT} tab>{N}</T>
        <polyline points={pts} fill="none" stroke={COPPER} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {rows.map((o, i) => (
          <g key={o.round}>
            <title>{`Round ${o.round}: rank ${Math.round(fin(o.rank, N))} of ${N}`}</title>
            <circle cx={x(i)} cy={y(fin(o.rank, N))} r={2.4} fill={COPPER} />
          </g>
        ))}
        <T x={x(0)} y={VH - 5} anchor="middle" size={8} fill={SOFT}>R{rows[0].round}</T>
        {rows.length > 1 && <T x={x(rows.length - 1)} y={VH - 5} anchor="middle" size={8} fill={SOFT}>R{rows[rows.length - 1].round}</T>}
        {(standings ?? []).slice(0, N).map((s, idx) => (
          <T key={s.firm_id} x={plotR + 8} y={y(idx + 1) + 3} size={8.5} weight={s.isYou ? 700 : 400} fill={s.isYou ? "var(--color-copperdeep)" : SOFT}>
            {trunc(s.name ?? s.firm_id, 16)}
          </T>
        ))}
      </svg>
      <Cap>Your rank over the rounds (1 = leading); the field is pinned at today&apos;s standings — rivals&apos; past ranks aren&apos;t recorded.</Cap>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9 · Cost-of-capital cockpit
// ─────────────────────────────────────────────────────────────────────────────

function Dial({ cx, cy, r, frac, zone, refFrac, title, value, sub, alarm }: { cx: number; cy: number; r: number; frac: number; zone?: [number, number]; refFrac?: number; title: string; value: string; sub?: string; alarm?: boolean }) {
  const p = (f: number, rad = r): [number, number] => {
    const th = Math.PI * (1 - Math.min(1, Math.max(0, f)));
    return [cx + rad * Math.cos(th), cy - rad * Math.sin(th)];
  };
  const arc = (f0: number, f1: number, rad = r) => {
    const [x0, y0] = p(f0, rad), [x1, y1] = p(f1, rad);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${rad} ${rad} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const f = Math.min(1, Math.max(0, frac));
  const [nx, ny] = p(f, r - 8);
  return (
    <g>
      <T x={cx} y={cy - r - 8} anchor="middle" size={7.5} weight={600} fill={SOFT}>{title.toUpperCase()}</T>
      <path d={arc(0, 1)} fill="none" stroke={LINE} strokeWidth={5} />
      {zone && zone[1] > zone[0] && <path d={arc(zone[0], zone[1])} fill="none" stroke={BRICK} strokeWidth={5} opacity={0.45} />}
      {refFrac != null && (() => { const [ax, ay] = p(refFrac, r - 5); const [bx, by] = p(refFrac, r + 5); return <line x1={ax} y1={ay} x2={bx} y2={by} stroke={INK} strokeWidth={1.4} />; })()}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={alarm ? BRICK : INK} strokeWidth={2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={2.5} fill={alarm ? BRICK : INK} />
      <T x={cx} y={cy + 15} anchor="middle" size={11} weight={700} fill={alarm ? BRICK : INK} tab>{value}</T>
      {sub && <T x={cx} y={cy + 26} anchor="middle" size={7.5} fill={SOFT}>{sub}</T>}
    </g>
  );
}

/** Borrowing-cost dials: leverage and interest coverage set the spread over the
 *  base rate, which sets r_debt. Tick marks show the default tuning (spread kicks
 *  in past 1× debt/equity; coverage under 1.5× triggers the punitive reprice;
 *  base rate 2.5%/qtr). Whole cluster turns red when the firm is credit-rationed. */
export function CostOfCapitalCockpit({ coc, finance }: { coc: FirmRoundResult["cost_of_capital"]; finance?: Config["finance"] }) {
  if (!coc || !Number.isFinite(coc.r_debt)) return <Pending />;
  const lev = Math.max(0, fin(coc.leverage));
  const cov = fin(coc.coverage);
  const rd = Math.max(0, fin(coc.r_debt));
  const rationed = !!coc.credit_rationed;
  // Everything below reads from the config rather than hardcoded numbers, so the dials and the
  // explainer cannot drift from the economy the way the old "risk-free 1.5% … 2.5% all-in"
  // caption did when DW-056 retuned the spreads. Fallbacks are the shipped defaults.
  const rf = finance?.r_f ?? 0.015;
  const baseSpread = finance?.base_spread ?? 0.01;
  const healthy = rf + baseSpread;                       // an unlevered, well-covered borrower
  const levRef = finance?.leverage_ref ?? 1;
  const levCap = finance?.max_leverage ?? 3;
  const covThr = finance?.coverage_threshold ?? 1.5;
  const penalty = finance?.coverage_penalty_spread ?? 0.05;
  const graduated = finance?.coverage_penalty_mode === "graduated";
  const apr = (q: number) => `${Math.round(((1 + q) ** 4 - 1) * 100)}%`;
  // Dial ceiling = the practical worst case this config can produce: healthy rate, plus the
  // leverage grid at the borrowing cap, plus the whole covenant penalty.
  const rateMax = healthy + (finance?.spread_leverage_k ?? 0.0075) * Math.max(0, levCap - levRef) + penalty;
  const alarmFrom = healthy * 2;                          // "meaningfully above the going rate"
  const VW = 340, VH = 100, cy = 62, R = 33;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="tnum text-sm text-ink">
          Debt costs <span className={`font-semibold ${rationed ? "text-brick" : "text-copperdeep"}`}>{fmt.pct1(rd)}</span>/qtr
          <span className="text-inksoft"> ≈ {apr(rd)} a year — risk-free {fmt.pct1(rf)} plus a spread of {fmt.pct1(Math.max(0, rd - rf))}</span>
          <InfoDot title="What sets the price of your debt">
            <span className="block"><b>Leverage</b> is debt ÷ equity. It climbs when you borrow — and also when you lose money, because a loss shrinks equity even if you never touch the loan. Past {levRef.toFixed(1)}× the bank starts charging more, and at {levCap.toFixed(1)}× it stops lending: a draw that would breach the cap is cut down to what fits.</span>
            <span className="mt-1.5 block"><b>Coverage</b> is operating income ÷ interest — how many times over this quarter's profit covers the interest bill. It is the number your lender actually watches. Below {covThr.toFixed(1)}× you are in breach of covenant; below 1× the business cannot pay its lenders out of operations at all, which is what puts you under the safety line.</span>
            <span className="mt-1.5 block"><b>Interest rate</b> is what you were charged this quarter, and it is not fixed. It starts at the risk-free {fmt.pct1(rf)} plus a {fmt.pct1(baseSpread)} spread — about {apr(healthy)} a year. The spread widens as leverage passes {levRef.toFixed(1)}× and {graduated ? `as coverage thins below ${covThr.toFixed(1)}×, reaching its full ${fmt.pct1(penalty)} only at zero operating income` : `jumps by ${fmt.pct1(penalty)} the moment coverage falls under ${covThr.toFixed(1)}×`}. Investor relations narrow it a little. So the interest line can move in a quarter when your debt did not — that is the bank repricing you, and the cure is to repay or to earn your cover back.</span>
          </InfoDot>
        </span>
        {rationed && <Tag tone="brick">Credit rationed</Tag>}
      </div>
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ display: "block" }}>
        <Dial cx={58} cy={cy} r={R} frac={lev / (levCap + 1)} zone={[levCap / (levCap + 1), 1]} refFrac={levRef / (levCap + 1)} title="Leverage" value={lev >= 10 ? "10×+" : `${lev.toFixed(1)}×`} sub="debt ÷ equity" alarm={rationed} />
        <Dial cx={170} cy={cy} r={R} frac={Math.min(cov, 6) / 6} zone={[0, covThr / 6]} refFrac={covThr / 6} title="Coverage" value={cov >= 999 ? "∞" : `${cov.toFixed(1)}×`} sub="profit ÷ interest" alarm={rationed || cov < covThr} />
        {/* Dial bounds track the config (DW-056): base all-in 2.5%/qtr, +1.5 at the 3x leverage
            cap, +5.0 at zero coverage, so ~9%/qtr is the practical ceiling. The old 15% max with
            its alarm at 11.5% was scaled to the pre-retune penalty — the needle physically could
            not reach red any more. APR compounds (1+r)^4, not r x 4, or a distressed rate reads
            7 points light. */}
        <Dial cx={282} cy={cy} r={R} frac={Math.min(1, rd / rateMax)} zone={[alarmFrom / rateMax, 1]} refFrac={healthy / rateMax} title="Interest rate" value={fmt.pct1(rd)} sub={`≈ ${apr(rd)} a year`} alarm={rationed} />
      </svg>
      <Cap>
        {rationed
          ? cov < 1.5
            ? "Coverage fell under the 1.5× covenant — the bank moved this firm onto the penalty grid. The spread widens with how thin the cover actually is, reaching its full 5%/qtr only at zero operating income, and new credit is rationed meanwhile."
            : "A requested draw was capped: it would have pushed debt past 3× equity, the borrowing limit."
          : `High leverage or thin coverage widens the spread. The ticks mark where each dial turns: ${levRef.toFixed(1)}× debt-to-equity, ${covThr.toFixed(1)}× coverage, and the ${fmt.pct1(healthy)}/qtr rate a well-covered borrower pays.`}
      </Cap>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10 · State small-multiples
// ─────────────────────────────────────────────────────────────────────────────

/** The firm's recorded stocks over time as a sparkline grid — the eight series
 *  the round trend carries (cash, net income, equity, quality, brand, share,
 *  score, rank). Capacity, crew/investor/regulator trust, and unit cost aren't
 *  in the trend, so they can't be plotted here. */
export function StateSmallMultiples({ history }: { history: GameView["history"] }) {
  const rows = (history ?? []).map((h) => h.own).filter((o) => o && Number.isFinite(o.round));
  if (rows.length === 0) return <Pending />;
  const last = rows[rows.length - 1];
  const rankVals = rows.map((o) => fin(o.rank));
  const rankImproving = rankVals[rankVals.length - 1] <= rankVals[0];
  const cells: { label: string; vals: number[]; out: string; color?: string }[] = [
    { label: "Cash", vals: rows.map((o) => fin(o.cash)), out: moneyC(fin(last.cash)) },
    { label: "Net income", vals: rows.map((o) => fin(o.netIncome)), out: moneyC(fin(last.netIncome)) },
    { label: "Equity", vals: rows.map((o) => fin(o.equity)), out: moneyC(fin(last.equity)) },
    { label: STOCK_LABEL.Q, vals: rows.map((o) => fin(o.Q)), out: fin(last.Q).toFixed(1) },
    { label: STOCK_LABEL.B, vals: rows.map((o) => fin(o.B)), out: fin(last.B).toFixed(1) },
    { label: "Share (Σ cat.)", vals: rows.map((o) => fin(o.share)), out: fmt.pct1(fin(last.share)) },
    { label: "Score", vals: rows.map((o) => fin(o.score)), out: fin(last.score).toFixed(2) },
    { label: "Rank", vals: rankVals, out: `#${Math.round(fin(last.rank))}`, color: rankImproving ? HOP : BRICK },
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="text-[0.6rem] uppercase tracking-[0.12em] text-inksoft">{c.label}</div>
            <div className="tnum text-sm font-semibold leading-tight text-ink">{c.out}</div>
            {c.vals.length >= 2 ? <Sparkline values={c.vals} color={c.color} width={92} height={20} /> : <div className="text-[0.62rem] text-inksoft">first round</div>}
          </div>
        ))}
      </div>
      <Cap>Every stock the round trend records; rank colored by direction (down the table = red). Tank capacity, trust stocks &amp; unit cost aren&apos;t carried in the trend.</Cap>
    </div>
  );
}
