/**
 * Board-meeting debrief (DW-068 phase 2) — every number and sentence the debrief shows, as one
 * plain object computed from the instructor dashboard payload (which IS the JSON export).
 *
 * This is the CANONICAL rule set. `server/scripts/teach-brief.py` `analyze()` is the offline
 * fallback (export file → text brief / HTML deck) and must say the same thing: the parity test
 * (`server/test/debrief_parity.test.ts`) runs both on the same fixtures and compares the whole
 * result, sentences included. Change a rule here → change it there, or the test fails.
 *
 * Pure and dependency-free (type imports only): no clock, no RNG, no I/O. Lives in the server
 * package beside dashboard.ts — the web already imports this package at runtime, and the edge
 * function can serve the same analysis later without a second copy.
 *
 * Vocabulary, as the engine means it (use these words with students):
 *   shoppers  share of a category's drinkers who picked your beer (price, quality, brand, focus)
 *   sold      cans you actually poured — capped by your tanks
 *   flat out  sold ≥ 97% of what shoppers wanted: a price cut buys nothing, a raise costs no sales
 *   pull      why shoppers chose you. A pull gap of g = e^g times the shoppers.
 * Tanks: the payload's `cap` is the generic tank stock only. Facilities add tanks it does not
 * count, so tank use is shown only where sold ≤ cap; "idle" is a floor, never an overstatement.
 */
import type { DashEngagementRow, DashPanelRow, DashSegmentResult, InstructorDashboard } from "./dashboard.js";

// ── constants (= teach-brief.py) ────────────────────────────────────────────────
const SEG: Record<string, string> = { mass: "Lagers & Light", niche: "Craft Premium", frontier: "Non-Alc / Functional" }; // = web/src/labels.ts SEG_LABEL
const L = (s: string): string => SEG[s] ?? s;
export const DEBRIEF_RUNWAY = 5; // engine default solvency_runway_rounds
export const DEBRIEF_ACQUIRABLE = 3; // engine default ma.min_distress_rounds
const RUNWAY = DEBRIEF_RUNWAY, ACQUIRABLE = DEBRIEF_ACQUIRABLE;
const FULL = 0.97, IDLE = 0.85, FADE = 0.75; // tanks full · idle after building · pull fading (vs the last 3 rounds' peak)
const TEACH_ROUNDS = 2; // rounds that teach supply vs demand constraint up front; after that it is a side note
const DEBT = 500; // interest below this is "no real debt": coverage is then a meaningless ratio
const EVENT_ORDER = ["FORCED EXIT", "ACQUI", "MERGER", "SHOCK", "MARKET SHIFT", "DISTRESS", "GUILD", "REGULAT", "FACILITY", "EXPANSION",
  "", "FINANCING", "EQUITY", "PR PLAY", "POACHED", "DEPARTURE", "LAYOFF", "HIRE FAILED", "HIRE", "PARCEL", "CANDIDATE"];
const EXIT_WORD: Record<string, string> = { bankrupt: "went bankrupt", acquired: "was acquired" };
export type DebriefChair = "CEO" | "CMO" | "COO" | "CFO" | "CHRO";
/** Where each chair looks in the student app (web/src/screens/Play.tsx tabs; desks = engine seats.ts DESK_LEVERS). */
const WHERE: Record<DebriefChair, string> = {
  COO: "Decide › Operations desk (tanks, facilities, quality) · Review › Operations & Demand",
  CMO: "Decide › Marketing desk (price, brand) · Review › Operations & Demand",
  CFO: "Decide › Finance desk (loans, repayments, dividends) · Review › Statements & Ratios",
  CEO: "Review › Statements & Ratios · Review › Field & Intel · Map",
  CHRO: "Decide › People desk (hires, raises, morale)",
};

// ── number formatting: Python's format() rounds an exact tie half-to-EVEN, JS toFixed rounds it
// up. $12,500 → "12k" there and "13k" here would be a visible disagreement, so ties are matched.
function fx(x: number, d: number): string {
  if (!Number.isFinite(x)) return x !== x ? "nan" : x > 0 ? "inf" : "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let s = a.toFixed(d);
  const exact = a.toFixed(d + 25); // toFixed is exact to 100 digits: a true tie reads …5 then zeros
  if (/^50*$/.test(exact.slice(exact.length - 25))) {
    const down = exact.slice(0, exact.length - 25).replace(/\.$/, "");
    const last = Number(down[down.length - 1]);
    if (last % 2 === 0) s = down; // half-even: stay on the even digit (toFixed already went up otherwise)
  }
  return (neg ? "-" : "") + s;
}
const commas = (s: string): string => { const [i, f] = s.split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (f !== undefined ? "." + f : ""); };
const fc = (x: number, d: number): string => commas(fx(x, d)); // = f"{x:,.{d}f}"
const k = (x: number): string => (Math.abs(x) >= 10000 ? `${fc(x / 1000, 0)}k` : Math.abs(x) >= 1000 ? `${fx(x / 1000, 1)}k` : fc(x, 0));
const pct = (x: number): string => `${fx(100 * x, 0)}%`;
const pts = (x: number): string => `${fx(100 * x, 0)} pts`;
const sgn = (x: number, f: (v: number) => string): string => (x >= 0 ? "+" : "−") + f(Math.abs(x));
const money = (x: number): string => sgn(x, (v) => (v >= 10000 ? `$${fc(v / 1000, 0)}k` : `$${fc(v, 0)}`));
const usd = (x: number): string => (x < 0 ? "−" : "") + (Math.abs(x) >= 10000 ? `$${fc(Math.abs(x) / 1000, 0)}k` : `$${fc(Math.abs(x), 0)}`);
const both = (xs: string[]): string => (xs.length < 3 ? xs.join(" and ") : xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1]);
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
/** Python max()/min() with a key: the FIRST extreme wins a tie. */
function maxBy<T>(xs: T[], key: (x: T) => number): T { let best = xs[0], bk = key(xs[0]); for (let i = 1; i < xs.length; i++) { const v = key(xs[i]); if (v > bk) { best = xs[i]; bk = v; } } return best; }
function minBy<T>(xs: T[], key: (x: T) => number): T { let best = xs[0], bk = key(xs[0]); for (let i = 1; i < xs.length; i++) { const v = key(xs[i]); if (v < bk) { best = xs[i]; bk = v; } } return best; }
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0); // code-unit order, as Python compares ASCII
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ── result shape ────────────────────────────────────────────────────────────────
export interface DebriefCards { UNITS: string; TEAM: string; MAP_VOL: string; MAP_COST: string; MAP_Q: string; RATIOS: string; CANARY: string; SCORE: string; PULL: string; TANKS: string }
export interface DebriefStory { seg: string; label: string; kind: "FLAT OUT" | "MIXED" | "SLACK"; D: number; dD: number | null; wanted: number | null; sold: number; away: number | null; out: string[]; spare: string[]; n: number; tail: string }
export interface DebriefTank { name: string; sold: number; wanted: number | null; cap: number; util: number | null; full: boolean }
export interface DebriefMove {
  w: number; kind: "cut" | "raise" | "tanks" | "stock"; fid: string; name: string; what: string; change: string; detail: string; verdict: string;
  s?: string; dp?: number; st?: string; drev?: number; ds?: number; dq?: number; // price moves
  dc?: number; caught?: string[]; idle?: number | null; // tank moves
  stock?: string; d?: number; // quality / brand moves
}
export interface DebriefPosition { fid: string; name: string; npc: boolean; rank: number; price: number; cost: number; margin: number; cans: number; gross: number; running: number; operating: number; ni: number; cash: number }
export interface DebriefPullPair { seg: string; a: string; b: string; gap: number; mult: number; prem: number; ratio: number; terms: Record<"price" | "quality" | "brand" | "fit" | "other", number>; exact: boolean; only_price: boolean; sentence: string }
export interface DebriefPull { sens: { label: string; cost: number }[]; pair: DebriefPullPair | null }
export interface DebriefTrouble { name: string; npc: boolean; why: string; short: string; n: number; acquirable: boolean; clock: string; loss: string | null; coverage: number; interest: number }
export interface DebriefAsk { q: string; show: string; lesson: string }
export interface DebriefPrompt { chair: DebriefChair; q: string; evidence: string; where: string }
export interface DebriefMetric { label: string; you: string; field: string; last: string }
/** PRIVATE to one team — competitive information. Never render inside anything projected. */
export interface DebriefFocus { fid: string; name: string; rank: number; n: number; called: number | null; metrics: DebriefMetric[]; moves: string[]; trouble: string | null; prompts: DebriefPrompt[] }
export interface Debrief {
  round: number; label: string; n_rounds: number; rich: boolean; cards: DebriefCards; teach: boolean; width: number;
  events: string[]; ranked_events: string[]; top_events: string[];
  story: DebriefStory[]; story_head: string; tanks: DebriefTank[]; moves: DebriefMove[]; moved_note: string | null;
  positions: DebriefPosition[]; leaders_line: string | null; pull: DebriefPull | null; trouble: DebriefTrouble[]; threshold: number; exits: { name: string; word: string }[];
  leaders: { dim: string; weight: number; name: string }[]; process: string[]; reflections: { name: string; text: string }[];
  ask: DebriefAsk[]; focus: DebriefFocus[];
}

/** Dashboard cards as deployed today (DW-067). Pre-067 payloads point at the older cards. */
function cards(rich: boolean): DebriefCards {
  const c: DebriefCards = {
    UNITS: "Market tab › “Who holds each segment” (cans sold, by firm)",
    TEAM: "Team drill-down › pick the team › “Last round · category economics”",
    MAP_VOL: "Strategy map › x: Avg price · y: Market share",
    MAP_COST: "Strategy map › x: Unit cost · y: Avg price",
    MAP_Q: "Strategy map › x: Avg price · y: Recipe quality",
    RATIOS: "Finance & health › “Financial ratios” (Gross margin, Operating margin rows)",
    CANARY: "Finance & health › “Solvency canaries” (Coverage column) + “Distress watch”",
    SCORE: "Score anatomy",
    PULL: "Market tab › “Why shoppers chose”",
    TANKS: "",
  };
  c.TANKS = rich ? "Market tab › “Price, shoppers & tanks”" : c.TEAM;
  if (rich) { // the DW-067 deploy also added the Positions card and the safety-line rule on Solvency canaries
    c.MAP_COST = "Market tab › “Positions · margin × volume”";
    c.MAP_VOL = "its scatter (cans →, margin per can ↑)";
  }
  return c;
}

/** The name a firm shows under on the dashboard (= InstructorDashboard shortName). */
export const debriefName = (t: { name: string; joined?: boolean }): string => (t.joined ?? true ? t.name : t.name.replace(/^Open slot/i, "NPC"));
/** Resolved wire rounds present in the payload, ascending. */
export const debriefRounds = (j: Pick<InstructorDashboard, "panel">): number[] => [...new Set(j.panel.map((p) => p.round))].sort((a, b) => a - b);

type Seg = DashSegmentResult;
type Row = DashPanelRow;

/** Every number and sentence the debrief shows. `r` = wire round (0 = round 1); default latest. */
export function analyzeDebrief(j: InstructorDashboard, r?: number | null): Debrief {
  const names = new Map(j.teams.map((t) => [t.firmId as string, debriefName(t)]));
  const npc = new Set(j.teams.filter((t) => !(t.joined ?? true)).map((t) => t.firmId as string));
  const nm = (fid: string): string => names.get(fid) ?? fid;
  const rounds = debriefRounds(j);
  if (!rounds.length) throw new Error("No resolved rounds in this export yet — resolve a round, then export again.");
  const R = r == null ? rounds[rounds.length - 1] : r;
  if (!rounds.includes(R)) throw new Error(`Round ${R} is not in this export (resolved wire rounds: ${rounds.join(", ")}).`);
  const at = (rr: number): Map<string, Row> => new Map(j.panel.filter((p) => p.round === rr).map((p) => [p.firmId as string, p]));
  const here = at(R), prev = at(R - 1);
  const cur = new Map([...here].filter(([, p]) => (p.status ?? "active") === "active"));
  const curRows = [...cur.values()];
  const back: Map<string, Row>[] = [];
  for (let rr = Math.max(0, R - 3); rr < R; rr++) back.push(at(rr)); // up to three prior rounds, for the "falling" rules
  const mkt = new Map(j.market.filter((m) => m.round === R && (m.active ?? true) && m.D > 0).map((m) => [m.segment as string, m]));
  const mktPrev = new Map(j.market.filter((m) => m.round === R - 1).map((m) => [m.segment as string, m]));
  const eng = new Map<string, DashEngagementRow>(j.engagement.filter((e) => e.round === R).map((e) => [e.firmId as string, e]));
  const segsOf = (p: Row | undefined): Record<string, Seg> => (p?.segments ?? {}) as Record<string, Seg>;
  const rich = curRows.some((p) => Object.values(segsOf(p)).some((s) => s.q_desired !== undefined)); // DW-067 payload
  const modules = new Set(j.meta.setup?.modules ?? []);
  const C = cards(rich);

  const renames = [...names].sort((a, b) => b[0].length - a[0].length).map(([fid, n]) => [new RegExp(`\\b${escapeRe(fid)}\\b`, "g"), n] as const);
  const rename = (line: string): string => renames.reduce((s, [re, n]) => s.replace(re, () => n), line);

  const seg = (p: Row | undefined, s: string): Seg | undefined => segsOf(p)[s];
  const serving = (s: string): [string, Seg][] => {
    const out: [string, Seg][] = [];
    for (const [f, p] of cur) { const x = seg(p, s); if (x && (x.price > 0 || x.q_sold > 0)) out.push([f, x]); }
    return out;
  };
  const wanted = (p: Row): number => sum(Object.values(segsOf(p)).map((x) => x.q_desired || 0));
  /** tank use, or null when sold > cap (facilities add tanks the payload's cap leaves out) */
  const util = (p: Row): number | null => { const c = p.cap || 0; return c && p.totalQSold <= 1.03 * c ? p.totalQSold / c : null; };
  /** the firm had fewer cans than shoppers wanted */
  const full = (p: Row): boolean => (rich ? wanted(p) > 0 && p.totalQSold < FULL * wanted(p) : !!p.cap && p.totalQSold >= FULL * p.cap);
  /** sold out · caught overflow · spare tanks. Per category from sold vs wanted when the payload
   *  has it (DW-067); otherwise per firm from tank use. */
  const status = (fid: string, x: Seg): "sold out" | "caught overflow" | "spare tanks" => {
    const w = x.q_desired;
    if (w) return x.q_sold < FULL * w ? "sold out" : x.q_sold > 1.03 * w ? "caught overflow" : "spare tanks";
    return full(cur.get(fid)!) ? "sold out" : "spare tanks";
  };

  // ── events: dedupe the feed (a hiring round repeats CANDIDATE LOST ×8) ──────
  const counts = new Map<string, number>();
  const seenEvents: string[] = [];
  for (const raw of j.events.find((e) => e.round === R)?.events ?? []) {
    const e = rename(raw);
    if (!counts.has(e)) seenEvents.push(e);
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  const events = seenEvents.map((e) => e + (counts.get(e)! > 1 ? `  ×${counts.get(e)}` : ""));
  const rankEv = (e: string): number => { const i = EVENT_ORDER.findIndex((t) => t && e.startsWith(t)); return i >= 0 ? i : EVENT_ORDER.indexOf(""); };
  const rankedEvents = events.map((e, i) => ({ e, i })).sort((a, b) => rankEv(a.e) - rankEv(b.e) || a.i - b.i).map((x) => x.e); // the title slide shows the first five

  // ── THE STORY ────────────────────────────────────────────────────────────
  const story: DebriefStory[] = [];
  for (const [s, m] of mkt) {
    const rows = serving(s);
    if (!rows.length) continue;
    const sold = sum(rows.map(([, x]) => x.q_sold));
    const out = rows.filter(([f, x]) => status(f, x) === "sold out").map(([f]) => f);
    const spare = rows.filter(([f, x]) => status(f, x) !== "sold out").map(([f]) => f);
    const want = rich ? sum(rows.map(([, x]) => x.q_desired ?? 0)) : null;
    const away = want != null ? Math.max(0, want - sold) : null;
    let kind: DebriefStory["kind"], tail: string;
    if (out.length === rows.length) {
      kind = "FLAT OUT";
      tail = (rich ? `every brewery turned drinkers away (${k(away!)}).` : "every brewery ran its tanks full.") + " Tanks, not price, set sales.";
    } else if (out.length) {
      kind = "MIXED"; tail = `tanks full: ${both(out.map(nm))} · tanks to spare: ${both(spare.map(nm))}.`;
    } else {
      kind = "SLACK"; tail = "everyone had tanks to spare — price and pull decide who sells.";
    }
    const mp = mktPrev.get(s);
    const dD = mp && mp.D ? m.D / mp.D - 1 : null;
    story.push({ seg: s, label: L(s), kind, D: m.D, dD, wanted: want, sold, away, out: out.map(nm), spare: spare.map(nm), n: rows.length, tail });
  }
  const kinds = new Set(story.map((st) => st.kind)), teach = R < TEACH_ROUNDS;
  const trend = (st: DebriefStory): string => (st.dD != null ? (st.dD >= 0.02 ? `grew ${pct(st.dD)}` : st.dD <= -0.02 ? `shrank ${pct(-st.dD)}` : "held steady") : "opened");
  const storyHead = teach
    ? (kinds.has("FLAT OUT") ? "Tanks, not price, set sales in " + both(story.filter((st) => st.kind === "FLAT OUT").map((st) => st.label)) + "."
      : kinds.has("MIXED") ? "Some breweries sold out; others had tanks to spare."
      : "Everyone had tanks to spare: price and pull decided who sold.")
    : new Set(story.map(trend)).size === 1 ? `Demand ${trend(story[0])} in ${both(story.map((st) => st.label))}.`
    : story.map((st) => `${st.label} ${trend(st)}`).join("; ") + ".";
  const tanks: DebriefTank[] = [...cur].map(([f, p]) => ({ name: nm(f), sold: p.totalQSold, wanted: rich ? wanted(p) : null, cap: p.cap, util: util(p), full: full(p) }));
  const tankKey = rich ? (t: DebriefTank) => (t.wanted ? t.sold / t.wanted : 9) : (t: DebriefTank) => -(t.util != null ? t.util : 9);
  tanks.sort((a, b) => tankKey(a) - tankKey(b));

  // ── WHAT MOVED ───────────────────────────────────────────────────────────
  const moves: DebriefMove[] = [];
  for (const [fid, p] of cur) {
    const q = prev.get(fid);
    if (!q) continue;
    for (const s of mkt.keys()) {
      const a = seg(q, s), b = seg(p, s);
      if (!a || !b || !a.price || !b.price || Math.max(a.share, b.share) < 0.01) continue; // under 1% of shoppers both rounds: noise, not a move
      const dp = b.price / a.price - 1;
      if (Math.abs(dp) < 0.03) continue;
      const drev = b.revenue - a.revenue;
      const st = status(fid, b);
      const dq = a.q_sold ? b.q_sold / a.q_sold - 1 : 0;
      const detail = `shoppers ${pct(a.share)}→${pct(b.share)}, sold ${k(b.q_sold)}` + (rich ? ` of ${k(b.q_desired!)} wanted` : "") + (st === "sold out" ? " (tanks full)" : "");
      let verdict: string;
      if (st === "sold out" && Math.abs(dq) < 0.05) {
        verdict = `same cans, ${drev >= 0 ? "more" : "less"} money (${money(drev)})`;
        if (dp < 0) verdict += " — the cut won shoppers it had no beer for";
      } else {
        verdict = `cans ${sgn(dq, pct)}, revenue ${money(drev)}`;
      }
      moves.push({ w: Math.abs(dp), kind: dp < 0 ? "cut" : "raise", fid, name: nm(fid), what: L(s), change: `$${fx(a.price, 2)}→$${fx(b.price, 2)} (${sgn(dp, pct)})`,
        detail, verdict, s, dp, st, drev, ds: b.share - a.share, dq });
    }
    if (q.cap && Math.abs(p.cap / q.cap - 1) >= 0.10) {
      const dc = p.cap / q.cap - 1;
      const caught = [...mkt.keys()].filter((s) => { const x = seg(p, s); return !!x && status(fid, x) === "caught overflow"; });
      const u = util(p);
      const idle = u == null ? null : 1 - u;
      const why = caught.length ? `caught drinkers rivals turned away (${caught.map(L).join(", ")})` : idle != null && idle > 0.1 ? `${pct(idle)} of tanks sat idle` : "";
      moves.push({ w: Math.abs(dc), kind: "tanks", fid, name: nm(fid), what: "tanks", change: `${k(q.cap)}→${k(p.cap)} (${sgn(dc, pct)})`,
        detail: `sold ${k(p.totalQSold)} (${sgn(p.totalQSold - q.totalQSold, k)})`, verdict: why, dc, caught, idle });
    }
    for (const [stock, label] of [["Q", "quality"], ["B", "brand"]] as const) {
      if (q[stock] && Math.abs(p[stock] / q[stock] - 1) >= 0.25) {
        const d = p[stock] / q[stock] - 1;
        moves.push({ w: Math.abs(d) * 0.5, kind: "stock", fid, name: nm(fid), what: label, change: `${fx(q[stock], q[stock] >= 10 ? 0 : 1)}→${fx(p[stock], p[stock] >= 10 ? 0 : 1)} (${sgn(d, pct)})`,
          detail: "", verdict: d > 0 ? "invested" : "fades without investment", stock: label, d });
      }
    }
  }
  moves.sort((a, b) => b.w - a.w);
  const movedNote = !prev.size ? "First round — every firm started identical; this is the baseline."
    : !moves.length ? "Nobody changed price ±3%, tanks ±10%, or quality/brand ±25% — the market moved on its own." : null;

  // ── POSITIONS ────────────────────────────────────────────────────────────
  const perCan = (p: Row, v: number): number => (p.totalQSold ? v / p.totalQSold : 0);
  const positions: DebriefPosition[] = [...cur].sort((a, b) => a[1].rank - b[1].rank).map(([f, p]) => ({
    fid: f, name: nm(f), npc: npc.has(f), rank: p.rank, price: perCan(p, p.revenue), cost: p.unitCost, margin: perCan(p, p.gross),
    cans: p.totalQSold, gross: p.gross, running: p.gross - p.ebit, operating: p.ebit, ni: p.netIncome, cash: p.cash,
  }));
  // (An all-exited round has no one to rank: the Python fallback raises there; the live tab must not.)
  const byM = curRows.length ? (maxBy(curRows, (p) => (p.totalQSold ? p.gross / p.totalQSold : -9)).firmId as string) : "";
  const byV = curRows.length ? (maxBy(curRows, (p) => p.totalQSold).firmId as string) : "";
  const byG = curRows.length ? (maxBy(curRows, (p) => p.gross).firmId as string) : "";
  const leadersLine = curRows.length && byM !== byV ? `Most per can: ${nm(byM)} · most cans: ${nm(byV)} · most gross profit: ${nm(byG)}.` : null;

  // ── WHY SHOPPERS CHOSE (DW-067 payloads only) ─────────────────────────────
  const TERMS = ["price", "quality", "brand", "fit", "other"] as const;
  const pullSum = (x: Seg): number => sum(Object.values(x.pull!));
  let pull: DebriefPull | null = null;
  if (rich) {
    let best: { score: number; s: string; fa: string; xa: Seg; fb: string; xb: Seg; gap: number } | null = null;
    for (const s of mkt.keys()) {
      const rows = serving(s).filter(([, x]) => x.pull && x.share >= 0.03); // a near-zero rival makes e^gap absurd
      for (const [fa, xa] of rows) for (const [fb, xb] of rows) {
        if (xa.share <= xb.share) continue;
        const gap = pullSum(xa) - pullSum(xb);
        const score = gap + (xa.price > xb.price * 1.02 ? 2 : 0);
        if (best === null || score > best.score) best = { score, s, fa, xa, fb, xb, gap };
      }
    }
    const sens: DebriefPull["sens"] = [];
    for (const s of mkt.keys()) {
      const xs = serving(s).map(([, x]) => x).filter((x) => x.pull && x.price > 0);
      if (xs.length) sens.push({ label: L(s), cost: 1 - Math.exp(xs[0].pull!.price / xs[0].price) });
    }
    pull = { sens, pair: null };
    if (best) {
      const { s, fa, xa, fb, xb, gap } = best;
      const prem = xa.price - xb.price;
      const terms = Object.fromEntries(TERMS.map((t) => [t, xa.pull![t] - xb.pull![t]])) as DebriefPullPair["terms"];
      const ratio = xb.share ? xa.share / xb.share : Infinity;
      pull.pair = { seg: L(s), a: nm(fa), b: nm(fb), gap, mult: Math.exp(gap), prem, ratio, terms, exact: !modules.has("geography"),
        only_price: (["quality", "brand", "fit", "other"] as const).every((t) => Math.abs(terms[t]) < 0.01),
        sentence: `${L(s)}: ${nm(fa)} drew ${fx(ratio, 1)}x ${nm(fb)}'s shoppers ` + (prem > 0.01 ? `despite charging $${fx(prem, 2)} more.` : `charging $${fx(-prem, 2)} less.`) };
    }
  }

  // ── TROUBLE ──────────────────────────────────────────────────────────────
  const troubled = [...cur].filter(([, p]) => p.belowSafety || p.creditRationed);
  const thr = (troubled.length ? troubled[0][1].cashSafetyThreshold : null) || 120000;
  const trouble: DebriefTrouble[] = troubled.map(([fid, p]) => {
    const why: string[] = [];
    if (p.cash < thr) why.push(`cash ${usd(p.cash)}`);
    if (p.coverage < 1) why.push(p.ebit < 0 ? `operating loss ${usd(p.ebit)}` + (p.interest >= DEBT ? ` on ${usd(p.interest)} of interest` : "")
      : `coverage ${fx(p.coverage, 1)}x (operating ${usd(p.ebit)} vs interest ${usd(p.interest)})`);
    const n = p.roundsBelowSafety || (p.belowSafety ? 1 : 0);
    const short = [...(p.cash < thr ? [`cash ${usd(p.cash)}`] : []), ...(p.ebit < 0 ? [`operating loss ${usd(p.ebit)}`] : p.coverage < 1 ? [`coverage ${fx(p.coverage, 1)}×`] : [])];
    return { name: nm(fid), npc: npc.has(fid), why: why.join("; ") || "credit-rationed", short: short.join(" · ") || "credit-rationed", n: p.belowSafety ? n : 0, acquirable: p.belowSafety && n >= ACQUIRABLE,
      clock: p.belowSafety ? `quarter ${n} of ${RUNWAY}` + (n >= ACQUIRABLE ? " — acquirable now" : "") : "credit-rationed only",
      loss: p.ebit < 0 ? `gross profit ${usd(p.gross)} didn't cover ${usd(p.gross - p.ebit)} of running costs` : null,
      coverage: p.coverage, interest: p.interest };
  });
  trouble.sort((a, b) => b.n - a.n || Number(a.npc) - Number(b.npc) || cmpStr(a.name, b.name)); // longest clock first; teams before NPCs
  const exits = [...here].filter(([f, p]) => (p.status ?? "active") !== "active" && prev.has(f) && (prev.get(f)!.status ?? "active") === "active")
    .map(([f, p]) => ({ name: nm(f), word: EXIT_WORD[p.status] ?? "exited" }));

  // ── footer: leaders, process, reflections ────────────────────────────────
  const w = j.meta.weights as unknown as Record<string, number>;
  const leaders = curRows.length ? Object.entries(w).map(([d, wt]) => ({ dim: d, weight: wt,
    name: nm(maxBy(curRows, (p) => ((p.scoreNorm ?? {}) as unknown as Record<string, number>)[d] ?? -9).firmId as string) })) : [];
  const process: string[] = [];
  for (const [fid, e] of eng) {
    if (npc.has(fid)) { process.push(`${nm(fid)} NPC`); continue; }
    const bits = e.submitted ? [`${e.revisionCount} rev`] : ["NO SUBMIT"];
    if (e.predictedRank) bits.push(`called #${e.predictedRank}` + (e.realizedRank ? `, got #${e.realizedRank}` : ""));
    process.push(`${nm(fid)} ${bits.join(", ")}`);
  }
  const reflections = [...eng].filter(([, e]) => (e.reflection || "").trim()).map(([f, e]) => ({ name: nm(f), text: Array.from((e.reflection || "").trim()).slice(0, 110).join("") }));

  // ── ASK THE ROOM ─────────────────────────────────────────────────────────
  const ask: [number, string, string, string][] = []; // (priority, question, show, name_it)
  const N_FULL = "With full tanks, price is free money: raise it until you'd just sell out. Tanks are the real limit, and they take a round to build.";
  for (const st of story) {
    const rows = serving(st.seg);
    const hi = maxBy(rows, ([, x]) => x.price), lo = minBy(rows, ([, x]) => x.price);
    if (st.kind === "FLAT OUT") {
      const top = rows.filter(([, x]) => x.price >= hi[1].price * 0.99).map(([f]) => nm(f));
      const who = hi[1].price > lo[1].price * 1.02 ? `${both(top)} charged the most ($${fx(hi[1].price, 2)}) and still sold every can` : `every brewery charged $${fx(hi[1].price, 2)} and sold every can`;
      const gone = st.away ? `, and ${k(st.away)} drinkers went without` : "";
      ask.push([teach ? 9 : 5, `Every brewery's tanks ran full in ${st.label}${gone}; ${who}. If you can't pour more, what should the price be? And who is building tanks?`, C.TANKS, N_FULL]);
    } else if (st.kind === "MIXED" && st.spare.includes(nm(hi[0]))) {
      ask.push([7, `In ${st.label}, ${both(st.out)} ran their tanks full while ${nm(hi[0])}, the priciest at $${fx(hi[1].price, 2)}, had tanks to spare. Too high a price, or the right one?`, C.TANKS,
        "Idle tanks still cost money. The right price is the highest one that still fills them."]);
    }
  }
  for (const m of moves) {
    const who = m.name, what = m.what;
    if (m.kind === "raise" && m.st === "sold out" && m.drev! > 0 && m.ds! < 0 && Math.abs(m.dq!) < 0.05) {
      ask.push([teach ? 8 : 5, `${who} raised ${what} ${pct(m.dp!)} and lost ${pts(-m.ds!)} of shopper share, but not a single sale. Why didn't it hurt?`, C.TANKS, N_FULL]);
    } else if (m.kind === "cut" && m.st === "sold out") {
      ask.push([8.5, `${who} cut ${what} ${pct(-m.dp!)} and sold the same cans for ${usd(Math.abs(m.drev!))} ${m.drev! >= 0 ? "more" : "less"} revenue. What did that cut buy, and what should they have done instead?`, C.TANKS,
        "A price cut only wins sales you can pour. With full tanks it just hands margin to customers."]);
    } else if (m.kind === "cut" && m.drev! > 0) {
      ask.push([7, `${who}'s ${what} price cut paid for itself. How will rivals answer, and who wins a price war at these unit costs?`, C.MAP_COST,
        "Price wars are won on unit cost. Check who can go lowest before starting one."]);
    } else if (m.kind === "raise" && m.dq! < -0.05) {
      ask.push([7, `${who} raised ${what} ${pct(m.dp!)} and sold ${pct(-m.dq!)} fewer cans. Was the margin worth the lost cans?`, C.TANKS,
        "Gross profit = margin/can × cans. A raise pays only if the margin gained beats the cans lost."]);
    } else if (m.kind === "tanks" && m.caught!.length) {
      ask.push([7, `${who} built tanks and caught the drinkers its rivals turned away. Foresight or luck, and what does carrying that capacity cost?`, C.TANKS,
        "Capacity is a bet on next round's demand: too little leaves drinkers on the table, too much bleeds fixed cost."]);
    } else if (m.kind === "tanks" && m.dc! > 0 && m.idle != null && m.idle > 0.15) {
      ask.push([7.8, `${who} built ${pct(m.dc!)} more tanks and left ${pct(m.idle)} of them idle. What would have filled them: a lower price, more quality and brand, or patience?`, C.TANKS,
        "Tanks pay only when shoppers want more than you can pour. Build pull first, then capacity."]);
    }
  }
  const pair = pull?.pair;
  if (pair && pair.prem > 0.01 && pair.ratio > 1.2) {
    ask.push([8, `${pair.a} charged $${fx(pair.prem, 2)} more than ${pair.b} in ${pair.seg} and drew ${fx(pair.ratio, 1)}x the shoppers. Where did that pull come from, and how long does it last without investment?`, `${C.PULL} · ${C.MAP_Q}`,
      "Quality and brand let you charge more and still win shoppers, but they fade every round you stop investing."]);
  }
  if (troubled.length) {
    const [fid, p] = minBy(troubled, ([, x]) => x.coverage);
    ask.push([8.2, `${nm(fid)} is under the safety line${p.ebit < 0 ? " with an operating loss" : ""}. What options just disappeared, and what should they do first?`, C.CANARY,
      "Distress closes doors: no new loans, and the clock to a forced sale or exit starts. Fix coverage first: cut programs and capex, stop expanding, then repay."]);
  }
  if (leadersLine) {
    ask.push([6, `${nm(byM)} earns the most per can and ${nm(byV)} sells the most cans; ${nm(byG)} made the most gross profit. Which position is easier to defend, and how would you attack it?`, `${C.MAP_COST} · then ${C.MAP_VOL}`,
      "Gross profit = margin/can × cans. Either road can win; stuck in the middle on both is the trap."]);
  }
  const misses = [...eng].filter(([, e]) => e.predictedRank && e.realizedRank).map(([fid, e]) => [Math.abs(e.predictedRank! - e.realizedRank!), fid] as const);
  if (misses.length) {
    const worst = misses.reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && b[1] > a[1]) ? b : a)); // = max() over (miss, firm id) tuples
    if (worst[0] >= 2) {
      const e = eng.get(worst[1])!;
      ask.push([5, `${nm(worst[1])} predicted #${e.predictedRank} and landed #${e.realizedRank}. What didn't they know, and could they have bought or inferred it?`, C.TEAM,
        "Market research is a lever too. Anticipating rivals is part of the decision."]);
    }
  }
  const seenLesson = new Set<string>();
  const picked: DebriefAsk[] = [];
  for (const [, q, show, lesson] of ask.map((a, i) => ({ a, i })).sort((x, y) => y.a[0] - x.a[0] || x.i - y.i).map((x) => x.a)) {
    if (!seenLesson.has(lesson)) { seenLesson.add(lesson); picked.push({ q, show, lesson }); }
  }

  // ── FOCUS: private per-team pages (never projected) ───────────────────────
  const n = cur.size;
  const rivals = (fid: string, get: (p: Row) => number): number => { const xs = [...cur].filter(([f]) => f !== fid).map(([, p]) => get(p)); return median(xs.length ? xs : [0]); };
  const rankBy = (key: (x: DebriefPosition) => number): Map<string, number> => new Map(positions.map((x, i) => ({ x, i })).sort((a, b) => key(b.x) - key(a.x) || a.i - b.i).map((v, i) => [v.x.fid, i + 1]));
  const mRank = rankBy((x) => x.margin), vRank = rankBy((x) => x.cans);
  const peopleOn = modules.has("employees") || modules.has("laborMarket");
  const hist = (fid: string): Row[] => back.filter((h) => h.has(fid)).map((h) => h.get(fid)!);
  const peakOf = (xs: number[]): number => (xs.length ? Math.max(...xs) : 0); // = max(..., default=0)

  const prompts = (fid: string, p: Row): DebriefPrompt[] => {
    const cands: [DebriefChair[], string, string][] = []; // (chairs in preference order, question, evidence) — in the §DW-068 rule order
    const sold = p.totalQSold;
    if (full(p)) cands.push([["COO"], "Your tanks ran full; shoppers wanted more. What's your capacity plan, and what should price be meanwhile?",
      rich ? `Shoppers wanted ${k(wanted(p))} cans of yours; you poured ${k(sold)}.` : `You sold ${k(sold)} cans on ${k(p.cap)} of tanks.`]);
    const u = util(p), caps = hist(fid).map((h) => h.cap);
    if (u != null && u <= IDLE && caps.length && p.cap >= 1.10 * Math.min(...caps)) cands.push([["COO", "CMO"], "You built tanks that sat idle. What fills them: price, quality/brand, or patience?",
      `Tanks went ${k(Math.min(...caps))} → ${k(p.cap)}; at least ${pct(1 - u)} sat idle this round.`]);
    const cut = moves.find((m) => m.fid === fid && m.kind === "cut" && m.st === "sold out");
    if (cut) cands.push([["CMO"], "Your cut won shoppers you had no beer for. What did it cost you?", `${cut.what} ${cut.change}: ${cut.detail}; revenue ${money(cut.drev!)}.`]);
    if (p.belowSafety || (p.coverage < 1 && p.interest >= DEBT)) {
      const head = p.interest >= DEBT && p.coverage >= 0 && p.coverage < 1 ? `Coverage is ${fx(p.coverage, 1)}×.`
        : p.interest >= DEBT && p.coverage < 0 ? `Operating profit was ${usd(p.ebit)} against ${usd(p.interest)} of interest.`
        : p.cash < thr ? `Cash is ${usd(p.cash)}, under the ${usd(thr)} safety line.`
        : `Operating profit was ${usd(p.ebit)}, so lenders read coverage as under 1×.`;
      const nq = p.roundsBelowSafety || 1;
      cands.push([["CFO"], `${head} What closes the gap before lenders' clock runs?`,
        `Quarter ${nq} of ${RUNWAY} under the safety line: no new loans now; from quarter ${ACQUIRABLE} a rival can buy you, at ${RUNWAY} you are forced out.`]);
    }
    const fades: string[] = [];
    for (const [stock, label] of [["Q", "Quality"], ["B", "Brand"]] as const) {
      const peak = peakOf(hist(fid).map((h) => h[stock]));
      if (peak && p[stock] <= FADE * peak) fades.push(`${label} ${fx(peak, 0)} → ${fx(p[stock], 0)} (${sgn(p[stock] / peak - 1, pct)})`);
    }
    if (fades.length) cands.push([["CMO", "CEO"], "Your pull is fading. What does it cost to hold it?", fades.join(" · ") + ` over the last ${back.length} rounds.`]);
    const band = Math.floor(n / 3);
    const mr = mRank.get(fid)!, vr = vRank.get(fid)!;
    if (n >= 5 && band < mr && mr <= n - band && band < vr && vr <= n - band) cands.push([["CEO"], "You're neither the cheapest nor the most premium. Which lane?",
      `Margin per can #${mr} of ${n} ($${fx(perCan(p, p.gross), 2)}) · cans #${vr} of ${n} (${k(sold)}).`]);
    if (p.ebit < 0 && p.gross > 0) cands.push([["CEO", "CFO"], "Gross profit didn't cover running costs. Which programs earn their keep?",
      `Gross profit ${usd(p.gross)} − running costs ${usd(p.gross - p.ebit)} = operating ${usd(p.ebit)}.`]);
    if (peopleOn) {
      const peak = peakOf(hist(fid).map((h) => h.T_emp));
      const med = rivals(fid, (x) => x.T_emp);
      if (peak && p.T_emp <= 0.85 * peak && p.T_emp <= med) cands.push([["CHRO"], "Your people are cooling on you while rivals hold theirs. What is it costing you, and what would win them back?",
        `Employee trust ${fx(peak, 1)} → ${fx(p.T_emp, 1)} (${sgn(p.T_emp / peak - 1, pct)}); rivals' median ${fx(med, 1)}.`]);
    }
    const used = new Set<DebriefChair>(), out: DebriefPrompt[] = [];
    for (const [chairs, q, ev] of cands) {
      const chair = chairs.find((c) => !used.has(c));
      if (chair && out.length < 3) { used.add(chair); out.push({ chair, q, evidence: ev, where: WHERE[chair] }); }
    }
    return out;
  };

  const metrics = (fid: string, p: Row): DebriefMetric[] => {
    const q = prev.get(fid);
    const cov = (x: Row): string => (x.interest < DEBT ? "no debt" : `${fx(x.coverage, 1)}×`);
    const d2 = (v: number): string => `$${fx(v, 2)}`;
    const rows: [string, (x: Row) => number, (v: number) => string][] = [
      ["Avg price / can", (x) => perCan(x, x.revenue), d2], ["Unit cost / can", (x) => x.unitCost, d2],
      ["Margin / can", (x) => perCan(x, x.gross), d2], ["Cans sold", (x) => x.totalQSold, k]];
    if (rich) rows.push(["Shoppers wanted", wanted, k]);
    rows.push(["Gross profit", (x) => x.gross, usd], ["Running costs", (x) => x.gross - x.ebit, usd], ["Operating profit", (x) => x.ebit, usd], ["Cash", (x) => x.cash, usd],
      ["Quality", (x) => x.Q, (v) => fx(v, 0)], ["Brand", (x) => x.B, (v) => fx(v, 0)]);
    if (peopleOn) rows.push(["Employee trust", (x) => x.T_emp, (v) => fx(v, 1)]);
    const out: DebriefMetric[] = [{ label: "Season rank", you: `#${p.rank} of ${n}`, field: "", last: q ? `#${q.rank}` : "" }];
    for (const [label, get, f] of rows) out.push({ label, you: f(get(p)), field: f(rivals(fid, get)), last: q ? f(get(q)) : "" });
    out.splice(out.length - (peopleOn ? 3 : 2), 0, { label: "Interest coverage", you: cov(p), field: "", last: q ? cov(q) : "" });
    return out;
  };

  const focus: DebriefFocus[] = [];
  for (const [fid, p] of [...cur].map((e, i) => ({ e, i })).sort((a, b) => cmpStr(nm(a.e[0]).toLowerCase(), nm(b.e[0]).toLowerCase()) || a.i - b.i).map((x) => x.e)) {
    if (npc.has(fid)) continue;
    focus.push({ fid, name: nm(fid), rank: p.rank, n, called: eng.get(fid)?.predictedRank ?? null, metrics: metrics(fid, p),
      moves: moves.filter((m) => m.fid === fid).map((m) => `${m.what} ${m.change}` + (m.detail ? `: ${m.detail}` : "") + (m.verdict ? ` — ${m.verdict}` : "")),
      trouble: trouble.find((t) => t.name === nm(fid))?.clock ?? null, prompts: prompts(fid, p) });
  }

  return { round: R, label: `Round ${R + 1} of ${j.meta.nRounds}`, n_rounds: j.meta.nRounds, rich, cards: C, teach,
    width: Math.max(9, ...[...cur.keys()].map((f) => Array.from(nm(f)).length + 1)), events, ranked_events: rankedEvents, top_events: rankedEvents.slice(0, 5),
    story, story_head: storyHead, tanks, moves, moved_note: movedNote,
    positions, leaders_line: leadersLine, pull, trouble, threshold: thr, exits,
    leaders, process, reflections, ask: picked.slice(0, 3), focus };
}

/** The projectable part only: the same analysis with the private per-team pages removed. A slide
 *  component should take THIS type, so team-private data cannot reach the projector by accident. */
export type DebriefDeck = Omit<Debrief, "focus">;
export function debriefDeck(b: Debrief): DebriefDeck { const { focus: _private, ...deck } = b; return deck; }

/** Display formatters shared with the slides (same rounding as the sentences above). */
export const debriefFmt = { k, pct, usd, money, sgn, fx };
