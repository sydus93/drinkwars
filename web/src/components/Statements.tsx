/**
 * Review → Statements & Ratios — the landing page of Review.
 *
 * The three statements as an analyst reads them: line items down the side, the last four
 * quarters across, a change column, and the whole season one click away. The ratios sit
 * beside them on the same page because that is where they come from — point at a ratio and
 * the statement lines it is built from light up, with the formula worked in this quarter's
 * actual figures. Operating data (units, price, margin by category, utilization) sits directly
 * under the P&L, the way a 10-K's operating metrics do.
 *
 * Deliberately plain. The bridges and radars live in Trends; this page is for learning to
 * read the sheets.
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import type { BalanceSheet, CashFlow, PnL } from "drinkwars-engine";
import type { GameView } from "../game/controller.js";
import { SEG_LABEL, fmt } from "../labels.js";
import { bandIsMeaningful, bandsForRound } from "drinkwars-engine";
import { RATIO_DEFS, RATIO_GROUPS, ratioDeltaUnit, ratioDisplay, type RatioDef, type RatioInput } from "../lib/ratios.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";
import { Sparkline } from "./Sparkline.js";

interface Quarter {
  round: number;
  pnl: PnL; bs: BalanceSheet; cf: CashFlow;
  unitCost: number; capacity: number;
  categories: Record<string, { price: number; sold: number; wanted: number; revenue: number; share: number }>;
}

/** One statement line. Costs are carried NEGATIVE so they print in parentheses and common-size
 *  to a negative share, exactly as on a printed statement. */
interface Line {
  key: string; label: string;
  get: (q: Quarter) => number;
  kind?: "total" | "sub"; // total = double rule, sub = single rule
  good?: "up" | "down"; // which direction of change is good news (colours the Δ column only)
  hideIfZero?: boolean;
  note?: string | ((view: GameView) => string);
}

const PNL: Line[] = [
  { key: "revenue", label: "Revenue", get: (q) => q.pnl.revenue, good: "up" },
  { key: "cogs", label: "Cost of goods sold", get: (q) => -q.pnl.cogs, good: "up", note: "Units sold × the cost to brew one drink." },
  { key: "gross", label: "Gross profit", get: (q) => q.pnl.gross, kind: "sub", good: "up" },
  { key: "opex", label: "Operating expense", get: (q) => -q.pnl.opex, good: "up", note: "Tank upkeep, overhead, and everything you chose to fund this quarter: quality, brand, operations, people, investor and regulator relations, research. These are expensed, not capitalized." },
  { key: "spoilage", label: "Spoilage write-off", get: (q) => -q.pnl.spoilage, good: "up", hideIfZero: true },
  { key: "depreciation", label: "Depreciation", get: (q) => -q.pnl.depreciation, note: "Wear on tanks and plant. A cost on the P&L, but no cash leaves — which is why operating cash flow runs above net income." },
  { key: "ebit", label: "Operating income (EBIT)", get: (q) => q.pnl.ebit, kind: "sub", good: "up" },
  { key: "interest", label: "Interest", get: (q) => -q.pnl.interest, good: "up", note: (v) => {
    const f = v.finance;
    if (!f) return "Your lender's rate is not fixed: it rises as you take on debt relative to equity and as operating income thins out against the interest bill. Repaying debt is the way out.";
    const apr = (q: number) => `${((Math.pow(1 + q, 4) - 1) * 100).toFixed(0)}%`;
    const healthy = f.r_f + f.base_spread;
    const worst = healthy + f.coverage_penalty_spread;
    const grid = f.coverage_penalty_mode === "graduated"
      ? `Your loan is priced on a grid, the way real credit agreements are. While operating income covers the interest bill at least ${f.coverage_threshold.toFixed(1)}× you pay the healthy rate, about ${apr(healthy)} a year. Below that the spread widens with how thin the cover actually is — reaching about ${apr(worst)} a year for a firm earning no operating income at all.`
      : `While operating income covers the interest bill at least ${f.coverage_threshold.toFixed(1)}× you pay about ${apr(healthy)} a year. Fall below that and the whole loan reprices to about ${apr(worst)}.`;
    return `${grid} Debt also gets dearer as debt-to-equity climbs past ${f.leverage_ref.toFixed(1)}×, and a little cheaper as investor relations improve. That is why the interest line can move when your debt has not — and why a bad quarter costs a borrower more than it costs a firm with no debt. Repaying debt, or earning your way back above ${f.coverage_threshold.toFixed(1)}× cover, is the way out.`;
  } },
  { key: "net", label: "Net income", get: (q) => q.pnl.net_income, kind: "total", good: "up" },
];
const BS: Line[] = [
  { key: "cash", label: "Cash", get: (q) => q.bs.cash, good: "up" },
  { key: "inventory", label: "Inventory", get: (q) => q.bs.inventory, hideIfZero: true, note: "Finished beer on hand, at what it cost to brew." },
  { key: "ppe", label: "Net plant & equipment", get: (q) => q.bs.ppe, note: "What you have spent on tanks and plant, less depreciation to date." },
  { key: "assets", label: "Total assets", get: (q) => q.bs.assets, kind: "sub" },
  { key: "debt", label: "Debt", get: (q) => q.bs.debt, good: "down" },
  // Debt sat directly above the equity lines with nothing between them and no liabilities
  // subtotal, so the rule under "Total equity" appeared to close a block that STARTED with
  // Debt. On a page whose job is statement literacy, that is the one ordering mistake worth
  // spending a row on.
  { key: "liabs", label: "Total liabilities", get: (q) => q.bs.debt, kind: "sub", good: "down", note: "Everything you owe. In this game that is your bank debt — there are no payables to carry." },
  { key: "paidIn", label: "Paid-in capital", get: (q) => q.bs.paid_in, note: "Money owners have put in: seed capital plus any equity raised." },
  { key: "retained", label: "Retained earnings", get: (q) => q.bs.retained, good: "up", note: "Every quarter's net income to date, less dividends paid. This line is how the P&L flows onto the balance sheet." },
  { key: "equity", label: "Total equity", get: (q) => q.bs.equity, kind: "sub", good: "up" },
  { key: "liabEq", label: "Total debt & equity", get: (q) => q.bs.debt + q.bs.equity, kind: "total", note: "Always equals total assets — everything you own was paid for by lenders or owners." },
];
const CF: Line[] = [
  { key: "cfOpen", label: "Opening cash", get: (q) => q.bs.cash - q.cf.delta_cash },
  { key: "cfOp", label: "From operations", get: (q) => q.cf.operating, good: "up", note: "Net income with depreciation added back (it was never a cash cost), adjusted for inventory." },
  { key: "cfInv", label: "From investing", get: (q) => q.cf.investing, note: "Cash spent on tanks and plant (negative), or recovered by selling them." },
  { key: "cfFin", label: "From financing", get: (q) => q.cf.financing, note: "Borrowing and equity raised, less repayments and dividends." },
  { key: "cfOther", label: "Shock & other", get: (q) => q.cf.delta_cash - (q.cf.operating + q.cf.investing + q.cf.financing), hideIfZero: true },
  { key: "cfDelta", label: "Net change in cash", get: (q) => q.cf.delta_cash, kind: "sub", good: "up" },
  { key: "cfClose", label: "Closing cash", get: (q) => q.bs.cash, kind: "total", note: "Ties to Cash on the balance sheet." },
];

const money0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
/** Accounting format: negatives in parentheses. */
const acct = (n: number): string => (Math.abs(n) < 0.5 ? "—" : n < 0 ? `(${money0.format(Math.round(-n))})` : money0.format(Math.round(n)));
const pct = (n: number): string => (Math.abs(n) < 0.0005 ? "—" : n < 0 ? `(${(-n * 100).toFixed(1)}%)` : `${(n * 100).toFixed(1)}%`);

const ratioInput = (q: Quarter): RatioInput => ({
  revenue: q.pnl.revenue, gross: q.pnl.gross, ebit: q.pnl.ebit, interest: q.pnl.interest, netIncome: q.pnl.net_income,
  cash: q.bs.cash, debt: q.bs.debt, equity: q.bs.equity, assets: q.bs.assets,
});

/** Lines the statements carry as negatives by accounting convention (a cost is money out).
 *  Only these get |x| in the ratio drill-down. Everything else — notably `equity`, which can
 *  genuinely be negative once losses eat the capital — must print its real sign, or the
 *  drill-down contradicts the balance sheet two inches to its left. */
/** True on a phone-width viewport. Tracked live rather than read once, so rotating the handset
 *  or resizing a desktop window re-flows instead of leaving a stale column count. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

const NEGATED_LINES = new Set(["cogs", "opex", "spoilage", "depreciation", "interest"]);
const LINE_BY_KEY = new Map([...PNL, ...BS, ...CF].map((l) => [l.key, l]));

export function StatementsAndRatios({ view }: { view: GameView }) {
  const [full, setFull] = useState(false);
  // How many quarters fit side by side. Four columns plus the delta need ~425px of table,
  // which a phone does not have: the card scrolls internally, so the newest quarter — the one
  // that matters — sits off the right edge cut mid-digit, and the squeezed label column wraps
  // "Operating income (EBIT)" onto three lines. Two quarters fit, which also keeps the single
  // comparison a reader actually makes (this quarter against last) fully on screen. The
  // "full history" toggle still shows everything for anyone who wants to scroll.
  const cols = useNarrow() ? 2 : 4;
  const [common, setCommon] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const hot = hover ?? pinned;

  const all: Quarter[] = useMemo(() => {
    const fromHistory = view.history.flatMap((h) => {
      const o = h.own;
      return o.pnl && o.balance && o.cashFlow
        ? [{ round: o.round, pnl: o.pnl, bs: o.balance, cf: o.cashFlow, unitCost: o.unitCost ?? 0, capacity: o.capacity ?? 0, categories: o.categories ?? {} }]
        : [];
    });
    if (fromHistory.length) return fromHistory;
    // A game served by a build that predates the statement history: show the latest quarter.
    const r = view.ownResult;
    return r ? [{
      round: r.round, pnl: r.pnl, bs: r.balance_sheet, cf: r.cash_flow, unitCost: r.unit_cost, capacity: r.effective_cap ?? r.state.cap,
      categories: Object.fromEntries(Object.entries(r.segments).map(([id, g]) => [id, { price: g.price, sold: g.q_sold, wanted: g.q_desired, revenue: g.revenue, share: g.share }])),
    }] : [];
  }, [view.history, view.ownResult]);

  if (!all.length) return <Card>Your statements open once a round has resolved.</Card>;

  // Some resolved quarters carry no statements. Three causes, and the message has to fit all
  // of them: a server running an engine older than this page (every quarter missing but the
  // latest); a mid-season redeploy (only the quarters since it); and a firm that left the game
  // or was rebuilt, where the MISSING quarters are the later ones, not the earlier ones. The
  // old copy asserted "only the latest is shown", which read as backwards in two of the three.
  const partial = all.length < view.history.length;
  const missingLabel = all.length === 1
    ? "Only this quarter has full statements — the server is running an older engine build."
    : `${view.history.length - all.length} of ${view.history.length} quarters have no statements recorded and are left out below.`;
  const shown = full ? all : all.slice(-cols);
  const last = shown[shown.length - 1];
  const prev = shown.length > 1 ? shown[shown.length - 2] : null;
  const uses = new Set(hot ? RATIO_DEFS.find((d) => d.key === hot)?.uses ?? [] : []);
  const cats = view.segments.filter((s) => s.active || shown.some((q) => (q.categories[s.id]?.sold ?? 0) > 0)).map((s) => s.id);

  const colHead = (delta = true) => (
    <tr className="text-right font-mono text-[0.58rem] uppercase tracking-[0.1em] text-inksoft">
      <th className="sticky left-0 z-[1] bg-panel py-1 pr-2 text-left font-normal" />
      {shown.map((q, i) => <th key={q.round} className={`px-2 py-1 font-normal ${i === shown.length - 1 ? "font-bold text-ink" : ""}`}>R{q.round + 1}</th>)}
      {prev && <th className="px-2 py-1 font-normal" title="Latest quarter against the one before it. Costs carry negative, so a positive change on a cost line means the cost fell.">{delta ? `Δ vs R${prev.round + 1}` : ""}</th>}
    </tr>
  );

  const table = (lines: Line[], base: ((q: Quarter) => number) | null) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[0.8rem]">
        <thead>{colHead()}</thead>
        <tbody className="tnum">
          {lines.filter((l) => !l.hideIfZero || shown.some((q) => Math.abs(l.get(q)) >= 0.5)).map((l) => {
            const on = uses.has(l.key);
            const cell = (q: Quarter) => (common && base ? pct(base(q) ? l.get(q) / base(q) : 0) : acct(l.get(q)));
            const d = prev ? (common && base ? (base(last) ? l.get(last) / base(last) : 0) - (base(prev) ? l.get(prev) / base(prev) : 0) : l.get(last) - l.get(prev)) : 0;
            const flat = common && base ? Math.abs(d) < 0.0005 : Math.abs(d) < 0.5;
            const tone = flat || !l.good ? "text-inksoft" : (d > 0) === (l.good === "up") ? "text-hop" : "text-brick";
            const rule = l.kind === "total" ? "border-t-2 border-ink/70 font-bold" : l.kind === "sub" ? "border-t border-ink/40 font-semibold" : "border-t border-line";
            return (
              <tr key={l.key} className={`${rule} ${on ? "bg-gold/25" : ""} transition-colors`}>
                <td className={`sticky left-0 z-[1] py-1 pr-2 text-left ${on ? "bg-[color-mix(in_srgb,var(--color-gold)_25%,var(--color-panel))] shadow-[inset_3px_0_0_var(--color-gold)] pl-1.5" : "bg-panel"} ${l.kind ? "text-ink" : "text-ink/85"}`}>
                  {l.label}
                  {l.note && <InfoDot title={l.label}>{typeof l.note === "function" ? l.note(view) : l.note}</InfoDot>}
                </td>
                {shown.map((q, i) => <td key={q.round} className={`whitespace-nowrap px-2 py-1 text-right ${l.get(q) < -0.5 && l.kind ? "text-brick" : ""} ${i === shown.length - 1 ? "text-ink" : "text-ink/70"}`}>{cell(q)}</td>)}
                {prev && <td className={`whitespace-nowrap px-2 py-1 text-right ${tone}`}>{flat ? "—" : common && base ? `${d > 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pt` : `${d > 0 ? "+" : "−"}${money0.format(Math.round(Math.abs(d)))}`}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  /** Operating data — units, price and margin by category, then brewing cost and utilization. */
  const opsRow = (label: React.ReactNode, get: (q: Quarter) => string, key: string, strong = false) => (
    <tr key={key} className={`border-t ${strong ? "border-ink/40 font-semibold" : "border-line"}`}>
      <td className="sticky left-0 z-[1] bg-panel py-1 pr-2 text-left text-ink/85">{label}</td>
      {shown.map((q, i) => <td key={q.round} className={`whitespace-nowrap px-2 py-1 text-right ${i === shown.length - 1 ? "text-ink" : "text-ink/70"}`}>{get(q)}</td>)}
      {prev && <td />}
    </tr>
  );
  const sold = (q: Quarter) => Object.values(q.categories).reduce((a, c) => a + c.sold, 0);

  const bands = bandsForRound(view.scoring, last?.round ?? 0);
  const tierOf = (def: RatioDef, v: number | null): { text: string; cls: string } | null => {
    const b = def.band ? bands[def.band] : undefined;
    // Same suppression rule as the scorecard: no tier where the round's band is degenerate.
    if (!bandIsMeaningful(b) || v == null) return null;
    // Three zones, identical to Scorecard.tsx's `tierOf` — the two screens read the same
    // bands and must not disagree. `b.sound` is deliberately NOT a boundary here: it is the
    // industry MEDIAN, which Scorecard's BandGauge draws as a tick inside the sound zone.
    return v < b.weak
      ? { text: "weak", cls: "border-brick text-brick" }
      : v >= b.strong
        ? { text: "strong", cls: "border-hop text-hop" }
        : { text: "sound", cls: "border-copper text-copperdeep" };
  };

  return (
    <div className="grid gap-4">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="text-[0.78rem] text-inksoft">
          Each round is one fiscal quarter. Costs print in parentheses, so a <i>positive</i> change
          on a cost line means that cost came down — the Δ column is always coloured by whether
          the news is good, not by its sign.
          {partial && <span className="text-brick"> {missingLabel}</span>}
        </div>
        <span className="flex-1" />
        <div className="inline-flex gap-0.5 rounded-[9px] border border-line2 bg-panel2 p-0.5 font-mono text-[0.6rem] uppercase tracking-wide">
          {([[false, "Dollars"], [true, "% of revenue / assets"]] as [boolean, string][]).map(([v, label]) => (
            <button key={label} onClick={() => setCommon(v)} className="rounded-[7px] px-2.5 py-1" style={{ background: common === v ? "var(--color-panel)" : "transparent", color: common === v ? "var(--color-copperdeep)" : "var(--color-inksoft)", fontWeight: common === v ? 700 : 500 }}>{label}</button>
          ))}
        </div>
        {all.length > cols && (
          <button onClick={() => setFull((f) => !f)} className="rounded-[9px] border border-line2 bg-panel2 px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-wide text-copperdeep">
            {full ? `Last ${cols} quarters` : `Full history · ${all.length} quarters`}
          </button>
        )}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* ── the three statements ── */}
        <div className="order-1 grid min-w-0 gap-4">
          <Card>
            <Eyebrow>Income statement</Eyebrow>
            {table(PNL, common ? (q) => q.pnl.revenue : null)}
            <div className="mt-3 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-copperdeep">Operating data</div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[0.8rem]">
                <thead>{colHead(false)}</thead>
                <tbody className="tnum">
                  {cats.map((id) => (
                    <Fragment key={id}>
                      <tr><td colSpan={shown.length + 2} className="sticky left-0 pb-0.5 pt-2 text-[0.72rem] font-semibold text-ink">{SEG_LABEL[id] ?? id}</td></tr>
                      {opsRow(<span className="pl-3">Units sold</span>, (q) => (q.categories[id] ? fmt.int(q.categories[id].sold) : "—"), `${id}u`)}
                      {opsRow(<span className="pl-3">Price</span>, (q) => (q.categories[id]?.sold ? fmt.price(q.categories[id].price) : "—"), `${id}p`)}
                      {opsRow(<span className="pl-3">Revenue</span>, (q) => (q.categories[id] ? acct(q.categories[id].revenue) : "—"), `${id}r`)}
                      {/* Named for what it actually is: the engine brews one recipe at one cost,
                          so this uses the FIRM's unit cost, not a per-category one. Calling it
                          "gross margin" implied a per-category cost build that does not exist —
                          and with equal prices every category showed an identical figure. */}
                      {opsRow(<span className="pl-3">Contribution per drink <InfoDot title="Contribution per drink">Price less the firm's unit cost, so it reads the same across categories whenever you price them the same. You brew one recipe at one cost; what differs between categories is the price buyers will pay and how many of them there are, not what the drink costs to make.</InfoDot></span>, (q) => { const c = q.categories[id]; return c?.sold && c.price > 0 ? `${fmt.price(c.price - q.unitCost)} · ${pct((c.price - q.unitCost) / c.price)}` : "—"; }, `${id}m`)}
                      {shown.some((q) => (q.categories[id]?.wanted ?? 0) - (q.categories[id]?.sold ?? 0) > 1) &&
                        opsRow(<span className="pl-3">Unserved demand <InfoDot title="Unserved demand">Drinks buyers wanted from you at your price that you could not supply. It is lost revenue, and the signal that capacity — not appeal — is what is holding sales back.</InfoDot></span>, (q) => { const c = q.categories[id]; const gap = c ? c.wanted - c.sold : 0; return gap > 1 ? fmt.int(gap) : "—"; }, `${id}g`)}
                      {shown.some((q) => (q.categories[id]?.sold ?? 0) - (q.categories[id]?.wanted ?? 0) > 1) &&
                        opsRow(<span className="pl-3">Spillover from rivals <InfoDot title="Spillover">Units you sold beyond the demand you won outright. When a rival runs out of product, some of its buyers settle for a brewery that still has beer — in proportion to appeal, and only if you have spare tanks. It is already counted in units sold. It is real revenue, but it is borrowed: it disappears the quarter that rival adds capacity.</InfoDot></span>, (q) => { const c = q.categories[id]; const x = c ? c.sold - c.wanted : 0; return x > 1 ? fmt.int(x) : "—"; }, `${id}s`)}
                    </Fragment>
                  ))}
                  {opsRow("Total units sold", (q) => fmt.int(sold(q)), "tu", true)}
                  {opsRow(<>Cost to brew one drink <InfoDot title="Unit cost">The full build-up — experience, operations, recipe, location, crew — is on the Operations &amp; Demand tab.</InfoDot></>, (q) => fmt.price(q.unitCost), "uc")}
                  {opsRow("Tank capacity", (q) => (q.capacity > 0 ? fmt.int(q.capacity) : "—"), "cap")}
                  {opsRow(<>Capacity utilization <InfoDot title="Capacity utilization">Units sold ÷ tank capacity. Every unit of capacity costs upkeep whether you brew into it or not, so low utilization is money spent on idle tanks; at 100% you are turning buyers away.</InfoDot></>, (q) => (q.capacity > 0 ? pct(sold(q) / q.capacity) : "—"), "util")}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <Eyebrow>Balance sheet</Eyebrow>
            {table(BS, common ? (q) => q.bs.assets : null)}
          </Card>
          <Card>
            <Eyebrow>Cash flow statement</Eyebrow>
            {table(CF, null)}
            {common && <div className="mt-1.5 text-[0.68rem] text-inksoft">Cash flow stays in dollars; it has no natural common-size base.</div>}
          </Card>
        </div>

        {/* ── ratios, built from the lines at left ── */}
        {/* Ratios follow the statements on a narrow window and sit beside them on a wide one.
            They used to come FIRST below 1024px, so a student on a windowed browser or an iPad
            scrolled past thirteen ratios before reaching the income statement they are derived
            from — the exact opposite of this page's "read the sheets first" pitch. */}
        <div className="order-2 min-w-0 lg:sticky lg:top-[7.5rem]">
          <Card>
            <div className="flex items-center gap-1.5">
              <Eyebrow>Key ratios · R{last.round + 1}</Eyebrow>
              <InfoDot title="Reading the ratios" align="right">Every ratio here is computed from the statements beside it. Point at one to light up the lines it uses and see the arithmetic in this quarter's figures; click to keep it open. The small line is the trend over the quarters shown. Where the economy has a benchmark, a tag says how the figure reads by industry standards.</InfoDot>
            </div>
            <div className="mb-1 text-[0.7rem] text-inksoft">Point at a ratio to see which statement lines it comes from.</div>
            {RATIO_GROUPS.map((g) => (
              <div key={g.id} className="mt-2">
                <div className="font-mono text-[0.58rem] uppercase tracking-[0.12em] text-copperdeep">{g.label}</div>
                {RATIO_DEFS.filter((d) => d.group === g.id).map((def) => {
                  const v = def.compute(ratioInput(last));
                  const pv = prev ? def.compute(ratioInput(prev)) : null;
                  const d = v != null && pv != null ? v - pv : null;
                  const flat = d == null || Math.abs(d) < (def.fmt === "pct" ? 0.0005 : 0.05);
                  const tone = flat ? "text-inksoft" : (d! > 0) === (def.better === "high") ? "text-hop" : "text-brick";
                  const series = shown.map((q) => def.compute(ratioInput(q))).filter((x): x is number => x != null);
                  const tier = tierOf(def, v);
                  const open = hot === def.key;
                  return (
                    <div key={def.key} onMouseEnter={() => setHover(def.key)} onMouseLeave={() => setHover(null)} onClick={() => setPinned((p) => (p === def.key ? null : def.key))}
                      className={`cursor-pointer border-t border-line px-1.5 py-1.5 transition-colors ${open ? "bg-gold/20" : ""}`}>
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-[0.8rem] text-ink/85">{def.label}</span>
                        {tier && <span className={`rounded-full border px-1.5 font-mono text-[0.5rem] uppercase tracking-wide ${tier.cls}`}>{tier.text}</span>}
                        {series.length > 1 && <Sparkline values={series} width={56} height={18} color="var(--color-inksoft)" />}
                        <span className="tnum w-[4.6rem] text-right text-[0.86rem] font-semibold text-ink">{ratioDisplay(def, v)}</span>
                        <span className={`tnum w-[3.4rem] text-right text-[0.66rem] ${tone}`}>{flat ? "" : `${d! > 0 ? "▲" : "▼"} ${def.fmt === "pct" ? `${Math.abs(d! * 100).toFixed(1)}${ratioDeltaUnit(def)}` : `${Math.abs(d!).toFixed(1)}${ratioDeltaUnit(def)}`}`}</span>
                      </div>
                      {open && (
                        <div className="mt-1 text-[0.7rem] leading-snug text-inksoft">
                          <div className="tnum text-ink/90">{def.formula} = {def.uses.map((k) => `${LINE_BY_KEY.get(k)?.label ?? k} ${acct(NEGATED_LINES.has(k) ? Math.abs(LINE_BY_KEY.get(k)?.get(last) ?? 0) : LINE_BY_KEY.get(k)?.get(last) ?? 0)}`).join("  ·  ")}</div>
                          <div className="mt-0.5">{def.meaning}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
