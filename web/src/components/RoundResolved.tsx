/**
 * Round resolved — the results page (DW-077, design/round-ux-2026-10 §D).
 *
 * Opens once per round when a round resolves (Play.tsx detects the change; multiplayer when the
 * instructor resolves, solo after each brew). In order: the rank, what hit the market and what
 * it did to this desk, the desk's before/after numbers, then — on the right — the seat's calls
 * settled one by one with the running record. "ON TO ROUND n →" dismisses it; the dismissal is
 * remembered per game + round in localStorage so a reload never re-opens a page already read.
 *
 * Audits: Play.tsx never auto-opens this when `navigator.webdriver` is true (headless Chrome
 * drives the classroom audits through Decide/Review and must not be covered by an overlay).
 *
 * Every figure comes from the view the screen already has (`view.history`, `view.ownResult`,
 * `view.own`, `view.standings`, `view.events`) plus the calls read (`SeatForecasts`).
 */
import type { GameView } from "../game/controller.js";
import type { ScoredCall, SeatForecasts } from "drinkwars-server";
import { ROLE_DESK } from "drinkwars-engine";
import { SHOCK_META, fmt, marketName } from "../labels.js";
import { parseEvents } from "./eventFeed.js";
import type { GameEvent } from "./EventModal.js";
import { VERDICT_COLOR, VERDICT_LABEL, recordText, settledMine } from "./Calls.js";

const SEAT_LABEL: Record<string, string> = { ceo: "CEO", cfo: "CFO", cmo: "CMO", coo: "COO", chro: "CHRO" };
const DESK_TITLE: Record<string, string> = { finance: "Finance", operations: "Operations", commercial: "Marketing", people: "People", all: "Whole firm" };
// Seat colours per the handoff's shared tokens (dark / light). The page edge + "On your desk" lead use them.
const SEAT_COLOR: Record<string, { dark: string; light: string }> = {
  ceo: { dark: "#bf9ae0", light: "#6c4294" }, cfo: { dark: "#9bcb5e", light: "#3d6b18" }, coo: { dark: "#4cc0cb", light: "#1d7a83" },
  cmo: { dark: "#ee9a4a", light: "#a65424" }, chro: { dark: "#edbe48", light: "#855a08" },
};
const seatColor = (role: string | null | undefined): string => {
  const c = SEAT_COLOR[role ?? ""];
  if (!c) return "var(--color-copper)";
  const night = typeof document !== "undefined" && /night|sectional/.test(document.documentElement.dataset.mode ?? "");
  return night ? c.dark : c.light;
};

/** "On your desk" — one short line per market event × desk. Keyed by the shock type (via its
 *  SHOCK_META label) or the event title; falls back to a line per event kind. */
const DESK_LINE: Record<string, Partial<Record<string, string>>> = {
  water: { finance: "Unit cost rose with the shortage — watch interest coverage and the cash line.", operations: "Input costs spiked; every drink brewed cost more this round.", commercial: "Costs rose for everyone — rivals may pass it on in price; yours is a choice.", people: "No direct hit to the roster; the margin squeeze may tighten the hiring budget.", all: "Input costs spiked industry-wide; margin took the hit." },
  harvest: { finance: "Grain and hops cost more — the cost line moved, not the price line.", operations: "Input costs rose with the failed harvest; unit cost followed.", commercial: "Everyone's costs rose — watch who passes it on to shoppers.", people: "No direct hit to the roster; margin pressure may limit hiring.", all: "Input costs rose industry-wide with the failed harvest." },
  co2: { finance: "Capacity was constrained — revenue, not cost, is where it shows.", operations: "Tank capacity was squeezed; some demand went unserved.", commercial: "Supply was tight — shoppers you couldn't serve went to rivals.", people: "No direct hit to the roster; output was capped by the squeeze.", all: "Capacity was constrained industry-wide; unserved demand went elsewhere." },
  demand_slump: { finance: "Revenue softened across the board — the cash line felt it.", operations: "Shoppers thinned out; tanks ran below plan.", commercial: "Demand fell for every category — price and brand mattered more.", people: "Fewer sales to carry payroll; watch the margin.", all: "Demand softened across the board." },
  craft_wave: { finance: "Revenue surged with the festival crowd.", operations: "Shoppers surged — capacity was the constraint.", commercial: "Demand surged across categories; brand and price shaped who won it.", people: "A busy quarter for the crew.", all: "Demand surged across the board." },
  health_shift: { finance: "Legacy-beer revenue weakened; the mix moved.", operations: "Shoppers moved toward lighter styles — watch the category mix.", commercial: "Drinkers turned from legacy beer; positioning matters more.", people: "No direct hit to the roster; the mix shift is a strategy question.", all: "Drinkers turned away from legacy beer." },
  na_moment: { finance: "The new category drew demand — revenue follows whoever is positioned there.", operations: "Demand for the new category jumped; capacity there pays.", commercial: "Non-alcoholic went mainstream; the category's shoppers multiplied.", people: "No direct hit to the roster.", all: "Demand for the new category jumped." },
  "Tastes are shifting": { finance: "No hit to finance this round. Quality spend now pays off more, so expect a capex ask.", operations: "Quality is gaining ground — recipe investment pays off more from here.", commercial: "Shoppers weigh quality more now; brand alone carries less.", people: "No direct hit; quality-minded hires are worth more now.", all: "Quality is gaining ground in the mainstream — recipe spend pays off more." },
};
/** A regional shock hit only producers in one market, scaled by the share of production there. */
const regionalLine = (region: string, exposure: number | undefined): string =>
  exposure == null ? `It hit breweries producing in ${region} only, in proportion to the capacity each has there.`
  : exposure <= 0 ? `It hit breweries producing in ${region} only — none of yours is there, so your costs held.`
  : exposure >= 0.995 ? `It hit breweries producing in ${region} — all of your production is there, so you took the full hit.`
  : `It hit breweries producing in ${region} — about ${Math.round(exposure * 100)}% of yours is there, so you took that share of it.`;
const KIND_LINE: Record<string, string> = { shock: "A market disruption this round — the numbers below carry it.", market: "A move in the market — see the Dispatch for the full story." };
const shockKey = (e: GameEvent): string | null => {
  for (const [k, m] of Object.entries(SHOCK_META)) if (m.label === e.title) return k;
  return e.title in DESK_LINE ? e.title : null;
};

const staffOf = (t: { headcount?: number; keyHires?: number } | undefined): number | null => (t && (t.headcount != null || t.keyHires != null) ? (t.headcount ?? 0) + (t.keyHires ?? 0) : null);
const pct1 = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n.toFixed(1)}%`);
/** DW-080: ONE share across categories — shoppers who chose you ÷ shoppers in the categories you
 *  sell in (each category's total = your shoppers ÷ your share there). It was the SUM of the
 *  per-category shares: 25% of lagers + 20% of craft read "45%". Older payloads fall back. */
const shopperShare = (t: { share: number; categories?: Record<string, { wanted: number; share: number }> } | undefined): number | null => {
  if (!t) return null;
  if (!t.categories) return t.share * 100;
  let won = 0, total = 0;
  for (const c of Object.values(t.categories)) if (c.share > 0) { won += c.wanted; total += c.wanted / c.share; }
  return total > 0 ? (won / total) * 100 : 0;
};
const cov = (ebit: number | undefined, interest: number | undefined): string => (ebit == null || interest == null ? "—" : interest <= 0 ? "no interest" : ebit / interest > 99 ? ">99×" : `${(ebit / interest).toFixed(1)}×`);
const marginOf = (h: { revenue?: number; gross?: number } | undefined): number | null => (h?.revenue ? ((h.gross ?? 0) / h.revenue) * 100 : null);

interface DeskRow { label: string; before: string; after: string; tone: "up" | "down" | "flat" }
const tone = (before: number | null | undefined, after: number | null | undefined, lowerIsBetter = false): DeskRow["tone"] => {
  if (before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after)) return "flat";
  const d = after - before;
  if (Math.abs(d) < 1e-9) return "flat";
  return (d > 0) !== lowerIsBetter ? "up" : "down";
};
const toneColor = (t: DeskRow["tone"]) => (t === "up" ? "var(--color-hop)" : t === "down" ? "var(--color-brick)" : "var(--color-ink)");

/** Before/after rows for this seat's desk. All from history (last two resolved rounds) + ownResult. */
function deskRows(view: GameView, desk: string): DeskRow[] {
  const h = view.history, cur = h[h.length - 1]?.own, prev = h.length > 1 ? h[h.length - 2].own : undefined;
  const r = view.ownResult;
  const row = (label: string, b: number | null | undefined, a: number | null | undefined, f: (n: number) => string, lowerIsBetter = false): DeskRow =>
    ({ label, before: b == null || !Number.isFinite(b) ? "—" : f(b), after: a == null || !Number.isFinite(a) ? "—" : f(a), tone: tone(b, a, lowerIsBetter) });
  const money = (n: number) => fmt.money(n);
  const trust = (t?: { T_emp?: number }) => (t as { T_emp?: number } | undefined)?.T_emp;
  const avgPriceOf = (t?: { categories?: Record<string, { revenue: number; sold: number }> }) => { let rev = 0, q = 0; for (const c of Object.values(t?.categories ?? {})) { rev += c.revenue; q += c.sold; } return q > 0 ? rev / q : null; };
  const payroll = (p?: { opex_lines?: Partial<Record<string, number>> }) => (p?.opex_lines ? (p.opex_lines.staff ?? 0) + (p.opex_lines.key_hires ?? 0) : null);
  const used = (t?: { unitsSold?: number; capacity?: number }) => (t?.capacity ? (t.unitsSold ?? 0) / t.capacity * 100 : null);
  switch (desk) {
    case "finance": return [
      row("Cash", prev?.cash, cur?.cash, money),
      row("Debt", prev?.debt, cur?.debt, money, true),
      { label: "Interest coverage", before: cov(prev?.ebit, prev?.interest), after: cov(cur?.ebit, cur?.interest), tone: tone(prev?.interest ? prev.ebit! / prev.interest : null, cur?.interest ? cur.ebit! / cur.interest : null) },
      row("Return on equity", prev?.equity ? (prev.netIncome / prev.equity) * 100 : null, cur?.equity ? (cur.netIncome / cur.equity) * 100 : null, pct1),
    ];
    case "operations": return [
      row("Tanks used", used(prev), used(cur), pct1),
      row("Unit cost", prev?.unitCost, cur?.unitCost ?? r?.unit_cost, fmt.price, true),
      row("Capacity", prev?.capacity, cur?.capacity ?? r?.effective_cap, (n) => `${fmt.int(n)} drinks`),
    ];
    case "commercial": return [
      row("Average price", avgPriceOf(prev), avgPriceOf(cur), fmt.price),
      row("Shopper share", shopperShare(prev), shopperShare(cur), pct1),
      row("Brand", prev?.B, cur?.B ?? view.own?.B, (n) => n.toFixed(1)),
    ];
    case "people": return [
      // staff = the named roster + key hires (DW-080: key hires were left out, so a laborMarket-only game read 0)
      ...(cur?.headcount != null || cur?.keyHires != null || r?.state.headcount != null ? [row("Staff", staffOf(prev), staffOf(cur) ?? (r ? (r.state.headcount ?? 0) + (r.state.key_hires ?? 0) : null), (n) => `${Math.round(n)}`)] : []),
      row("Employee trust", trust(prev as never), trust(cur as never) ?? view.own?.T_emp, (n) => n.toFixed(2)),
      row("Payroll", payroll(prev?.pnl), payroll(cur?.pnl ?? r?.pnl), money, true),
    ];
    default: return [
      row("Revenue", prev?.revenue, cur?.revenue, money),
      row("Net income", prev?.netIncome, cur?.netIncome, money),
      row("Season score", prev?.score, cur?.score, (n) => n.toFixed(3)), // the Standings precision — at 1 dp a small dip read "0.1 → 0.1" in red
    ];
  }
}

export function RoundResolved({ view, round, mp, seatRole, calls, onDismiss, onStatements, onDispatch }: {
  view: GameView;
  round: number; // the resolved round (0-based)
  mp: boolean;
  seatRole?: string | null;
  calls: SeatForecasts | null; // null = calls off (or not loaded yet) — the right column adapts
  onDismiss: () => void;
  onStatements: () => void;
  onDispatch: () => void;
}) {
  const h = view.history, cur = h[h.length - 1]?.own, prev = h.length > 1 ? h[h.length - 2].own : undefined;
  const n = view.standings.length;
  const rank = cur?.rank || view.standings.findIndex((s) => s.isYou) + 1;
  const leader = view.standings[0];
  const youName = view.names[view.own.id] ?? "";
  const next = round + 2; // 1-based label of the round that opens next
  const final = view.complete || next > view.nRounds;
  const seat = seatColor(seatRole);
  const desk = seatRole ? (ROLE_DESK[seatRole] ?? "all") : "all";

  const move = !prev ? "First round in the books." : prev.rank === rank ? `Held at #${rank}.` : prev.rank > rank ? `Up ${prev.rank - rank === 1 ? "one place" : `${prev.rank - rank} places`} from #${prev.rank}.` : `Down ${rank - prev.rank === 1 ? "one place" : `${rank - prev.rank} places`} from #${prev.rank}.`;
  const lead = leader ? (leader.isYou ? "You lead the field." : `${leader.name} leads.`) : "";

  const kpis = [
    { label: "Net income", value: fmt.money(cur?.netIncome ?? view.ownResult?.pnl.net_income ?? 0), d: prev ? (cur?.netIncome ?? 0) - prev.netIncome : null, f: fmt.money, suffix: prev ? ` vs R${prev.round + 1}` : "" },
    { label: "Cash", value: fmt.money(cur?.cash ?? view.own.cash), d: prev ? (cur?.cash ?? 0) - prev.cash : null, f: fmt.money, suffix: "" },
    { label: "Gross margin", value: pct1(marginOf(cur)), d: prev && marginOf(prev) != null && marginOf(cur) != null ? marginOf(cur)! - marginOf(prev)! : null, f: (x: number) => `${x.toFixed(1)} pts`, suffix: "" },
  ];

  const events = parseEvents(view.events, youName).filter((e) => e.kind === "shock" || e.kind === "market");
  const rows = deskRows(view, desk);

  const settled: ScoredCall[] = (calls?.calls ?? []).filter((c) => c.round === round && c.userId === calls?.me);
  const judged = settled.filter((c) => c.verdict != null);
  const hits = judged.filter((c) => c.verdict !== "missed").length;
  const record = recordText(calls?.calibration?.me);
  const streak = settledMine(calls).slice(-6);
  const callsOn = !!calls?.enabled;

  const btnLabel = final ? "SEE THE SEASON →" : `ON TO ROUND ${next} →`;
  // an ELEMENT, not a component defined in render — a new component type every clock tick remounted the button and dropped taps
  const button = <button onClick={onDismiss} className="tt-btn tt-btn--go w-full py-3.5 text-[0.82rem]" data-dw="on-to-round">{btnLabel}</button>;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-paper text-ink" role="dialog" aria-modal="true" aria-label={`Round ${round + 1} resolved`} data-dw="round-resolved" style={{ borderLeft: `8px solid ${seat}` }}>
      <div className="flex min-h-full flex-col">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line2 bg-panel2/60 px-4 py-3 sm:px-7">
          <div>
            <div className="eyebrow">Drink Wars · {youName || "Your brewery"}</div>
            <div className="display text-[1.7rem] sm:text-[2.1rem]">Round {round + 1} resolved</div>
          </div>
          {seatRole && (
            <div className="flex items-stretch overflow-hidden rounded-[12px] border-2" style={{ borderColor: seat }}>
              <div className="flex items-center px-3 font-mono text-[1rem] font-bold" style={{ background: seat, color: "var(--color-paper)" }}>{SEAT_LABEL[seatRole] ?? seatRole.toUpperCase()}</div>
              <div className="px-3 py-1 font-mono text-[0.6rem] font-semibold uppercase tracking-[0.1em] text-inksoft">Your seat<br />{DESK_TITLE[desk]} desk</div>
            </div>
          )}
          <span className="flex-1" />
          <div className="flex flex-col items-end rounded-[10px] border border-line px-3 py-1.5">
            <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-inksoft">{final ? "Season" : `Round ${next}`}</span>
            {/* the next round is usually already open when this page shows — say so (it read "opens when ready") */}
            <span className="font-mono text-[1rem] font-semibold">{final ? "complete" : !mp || view.lifecycle === "open" ? "open now" : "opens soon"}</span>
          </div>
        </header>

        <div className="mx-auto grid w-full max-w-[1440px] flex-1 gap-6 px-4 py-5 sm:px-7 lg:grid-cols-[minmax(0,1fr)_540px]">
          {/* ── left: rank · KPIs · market · desk numbers ── */}
          <div className="grid content-start gap-5">
            <div className="grid gap-1">
              <span className="font-mono text-[0.72rem] font-bold uppercase tracking-[0.16em] text-copperdeep">Round {round + 1} is in</span>
              <span className="display text-[2.4rem] leading-none sm:text-[3.6rem]">You finished #{rank || "—"}<span className="hidden sm:inline"> of {n}</span></span>
              <span className="text-[1.05rem] text-inksoft sm:text-[1.3rem]">{move} {lead}</span>
            </div>
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3.5">
              {kpis.map((k) => {
                const c = k.d == null || Math.abs(k.d) < 0.5 ? "var(--color-inksoft)" : k.d > 0 ? "var(--color-hop)" : "var(--color-brick)";
                return (
                  <div key={k.label} className="card grid gap-0.5 px-3 py-3 sm:px-4">
                    {/* phone: the label keeps two lines and the "vs R2" tail drops, so the three values share a baseline */}
                    <span className="min-h-[2.3em] font-mono text-[0.6rem] font-semibold uppercase leading-tight tracking-[0.12em] text-inksoft sm:min-h-0">{k.label}</span>
                    <span className="tnum text-[1.3rem] font-semibold leading-tight sm:text-[1.9rem]">{k.value}</span>
                    <span className="tnum text-[0.8rem] sm:text-[0.95rem]" style={{ color: c }}>{k.d == null ? "first round" : <>{k.d > 0 ? "▲" : k.d < 0 ? "▼" : "•"} {k.f(Math.abs(k.d))}<span className="hidden sm:inline">{k.suffix}</span></>}</span>
                  </div>
                );
              })}
            </div>
            <div className="card grid gap-3 px-4 py-4 sm:px-5">
              <span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-inksoft">What hit the market</span>
              {events.length === 0 && <span className="text-[1rem] text-inksoft">A quiet round. No shocks; results came from your team's choices and your rivals'.</span>}
              {events.map((e) => {
                const key = shockKey(e);
                const line = (e.region ? regionalLine(e.region, view.shocks.find((s) => s.typeId === key && marketName(s.region, s.regionLabel) === e.region)?.exposure) : null)
                  ?? (key && DESK_LINE[key]?.[desk]) ?? (key && DESK_LINE[key]?.all) ?? KIND_LINE[e.kind] ?? "";
                return (
                  <div key={e.id} className="grid grid-cols-[8px_minmax(0,1fr)] gap-3.5">
                    <span className="rounded-[4px]" style={{ background: e.kind === "shock" ? "var(--color-brick)" : "var(--color-gold)" }} />
                    <div className="grid gap-0.5">
                      <span className="display text-[1.15rem] font-semibold sm:text-[1.3rem]">{e.title || "Market move"}</span>
                      <span className="text-[0.95rem] leading-snug sm:text-[1.05rem]"><b style={{ color: seat }}>On your desk:</b> {line || e.body}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="card grid gap-2 px-4 py-4 sm:px-5">
              <span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-inksoft">Your desk's numbers · {DESK_TITLE[desk]}</span>
              {/* the two columns are named (they read as two unexplained numbers) */}
              <div className="grid grid-cols-[minmax(0,1fr)_110px_110px] font-mono text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-inksoft sm:grid-cols-[minmax(0,1fr)_140px_140px]">
                <span />
                <span className="text-right">{prev ? `Round ${prev.round + 1}` : "Before"}</span>
                <span className="text-right">Round {round + 1}</span>
              </div>
              {rows.map((r) => (
                <div key={r.label} className="grid grid-cols-[minmax(0,1fr)_110px_110px] border-t border-line pt-2 text-[1rem] sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:text-[1.1rem]">
                  <span>{r.label}</span>
                  <span className="tnum text-right text-inksoft">{r.before}</span>
                  <span className="tnum text-right font-semibold" style={{ color: toneColor(r.tone) }}>{r.after}</span>
                </div>
              ))}
              <div className="mt-2 flex flex-wrap gap-2.5">
                <button onClick={onStatements} className="rounded-[10px] border border-line2 px-4 py-2.5 font-mono text-[0.72rem] font-bold text-ink hover:bg-panel2">Full statements →</button>
                <button onClick={onDispatch} className="rounded-[10px] border border-line2 px-4 py-2.5 font-mono text-[0.72rem] font-bold text-ink hover:bg-panel2">The Tap Dispatch →</button>
              </div>
            </div>
          </div>

          {/* ── right: calls settled ── */}
          <div className="grid content-start gap-4">
            <div className="overflow-hidden rounded-[16px] border border-line bg-panel2/50" data-dw="calls-settled">
              <div className="flex items-end justify-between gap-3 border-b border-dashed border-line px-5 pb-4 pt-5">
                <div className="grid gap-0.5">
                  <span className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.14em] text-copperdeep">Your calls · settled</span>
                  <span className="display text-[1.5rem] font-semibold sm:text-[1.8rem]">{!callsOn ? "Calls are off" : settled.length === 0 ? "No calls this round" : judged.length === 0 ? "Nothing to settle yet" : `${hits} of ${judged.length} came good`}</span>
                </div>
                {callsOn && (
                  <div className="flex flex-col items-end">
                    <span className="font-mono text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-inksoft">Season record</span>
                    <span className="tnum text-[1.5rem] font-semibold sm:text-[1.8rem]">{record}</span>
                  </div>
                )}
              </div>
              {!callsOn && <div className="border-b border-dashed border-line px-5 py-5 text-[1.05rem] leading-snug text-inksoft">This game runs without calls. The numbers on the left are the whole story.</div>}
              {callsOn && settled.length === 0 && <div className="border-b border-dashed border-line px-5 py-5 text-[1.05rem] leading-snug text-inksoft">You made no calls in Round {round + 1}, so there's nothing to settle. Your record holds at {record}.</div>}
              {settled.map((c) => {
                const v = c.verdict;
                const color = v ? VERDICT_COLOR[v] : "var(--color-inksoft)";
                return (
                  <div key={c.item} className="grid gap-2 border-b border-dashed border-line px-5 py-4" data-dw-verdict={v ?? "unsettled"}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-inksoft">{c.item === "team_rank" ? "Team rank" : c.item === "gross_margin" ? "Your gross margin" : c.item === "rival_price" ? `${c.targetName ?? "Rival"} price move` : "Shopper share"}</span>
                      <span className="rounded-[6px] px-2.5 py-1 font-mono text-[0.62rem] font-bold uppercase tracking-[0.1em]" style={{ background: color, color: "var(--color-paper)" }}>{v ? VERDICT_LABEL[v] : "Not settled"}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="grid"><span className="text-[0.85rem] text-inksoft">You called</span><span className="tnum text-[1.5rem] font-semibold leading-tight sm:text-[1.8rem]">{c.valueLabel}</span></div>
                      <div className="grid"><span className="text-[0.85rem] text-inksoft">It came in</span><span className="tnum text-[1.5rem] font-semibold leading-tight sm:text-[1.8rem]" style={{ color }}>{c.realizedLabel ?? "—"}</span></div>
                    </div>
                    <span className="text-[0.95rem] text-inksoft">{c.note}</span>
                  </div>
                );
              })}
              {callsOn && (
                <div className="grid gap-2 px-5 py-4">
                  <div className="flex gap-1.5" aria-label="Last six calls">
                    {Array.from({ length: 6 }, (_, i) => streak[i]).map((c, i) => <span key={i} className="h-2.5 flex-1 rounded-[5px]" style={{ background: c ? VERDICT_COLOR[c.verdict as keyof typeof VERDICT_COLOR] : "var(--color-line)" }} />)}
                  </div>
                  <span className="text-[0.95rem] text-inksoft">Last 6 calls. Close means within 2 points or one rank place.</span>
                </div>
              )}
              <div className="hidden px-5 pb-5 lg:block">{button}</div>
            </div>
          </div>
        </div>
        {/* mobile: the way forward is pinned */}
        <div className="sticky bottom-0 border-t border-line2 bg-panel2/95 px-4 py-3 backdrop-blur lg:hidden" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>{button}</div>
      </div>
    </div>
  );
}
