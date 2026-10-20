/**
 * Calls — forecast commitment (DW-074; DW-077 design pass). Each seat may fill up to three
 * tickets before the round locks; once the round resolves the app settles them one by one
 * ("you called X · it came in Y" with a NAILED / CLOSE / MISSED verdict) and keeps a running
 * record. The fast right/wrong signal the main loop can't give, and the expectation-formation
 * record for research.
 *
 * A strictly PARALLEL channel (Decision_Log DW-053): calls have their own rows and their own
 * endpoint. They never enter FirmDecision, the seat merge, compose, lock or resolve, and the
 * season score never reads them. Settling happens on READ from the stored round results —
 * nothing is written at resolve — so the channel is deterministic and replay-neutral.
 *
 * Gated per game by `config.classroom.forecasts.enabled` (absent ⇒ off). With the flag off no
 * function here touches the forecasts table and the client makes no request.
 *
 * DW-077 — the three tickets every seat sees (design/round-ux-2026-10 §D):
 *   WHERE WE FINISH      #1 … #nFirms            NAILED exact · CLOSE one place off
 *   MY GROSS MARGIN      four 4-point buckets    NAILED inside the bucket · CLOSE within 2 points of
 *                        anchored on last round's margin                    the bucket's nearer edge
 *   {TOP RIVAL}'S PRICE  Cut / Hold / Raise      NAILED same direction (Hold = within ±2%)
 * The record counts NAILED and CLOSE as hits. `score` is 1 / 0.5 / 0 so the calibration mean and
 * the export roll-up keep working. Bucket calls are stored self-describingly ("<28", "28:32",
 * ">36" — bounds in the string) so settling never needs the anchor that produced them.
 */
import { rankStandings } from "drinkwars-engine";
import type { Config, FirmId, FirmRoundResult, RoundResult } from "drinkwars-engine";
import type { ForecastCall, ForecastRecord, StorageAdapter, TeamRecord } from "./types.js";

export const MAX_CALLS_PER_SEAT = 3;
/** A rival's average price within ±2% of last round reads as "flat" (Hold). */
export const FLAT_BAND = 0.02;
/** Margin tickets: bucket width in points, the round-1 anchor, and the CLOSE tolerance. */
export const MARGIN_BUCKET_PTS = 4;
export const MARGIN_ANCHOR_DEFAULT = 28;
export const CLOSE_MARGIN_PTS = 2;

export type ForecastItemId = "team_rank" | "own_share" | "gross_margin" | "rival_price";
export type Verdict = "nailed" | "close" | "missed";
type Realized = number | string | null;

/** What a realized-value reader may look at: this round's result, the prior round's (for
 *  moves), the calling firm, and the call's target (a segment id or a rival's firm id). */
interface RealizedCtx { result: RoundResult; prev: RoundResult | null; firmId: FirmId; target: string | null }

export interface ForecastOption { value: number | string; label: string }

export interface ForecastItem {
  id: ForecastItemId;
  /** rank = #1…#nFirms · bucket = a self-describing margin band · choice = a price direction ·
   *  number = a free number (legacy own_share: stored data still settles, no seat is asked). */
  kind: "rank" | "bucket" | "choice" | "number";
  short: string; // column header / chip
  /** Ticket title; `{target}` is replaced by the rival's name. Shown in caps. */
  title: string;
  options?: string[]; // choice items
  target?: "segment" | "rival";
  /** Seats asked. A seat's prompts appear in catalog order, at most MAX_CALLS_PER_SEAT.
   *  "member" = a solo player or an unassigned seat. */
  roles: string[];
  realized: (c: RealizedCtx) => Realized;
}

const firmIn = (r: RoundResult | null, id: FirmId): FirmRoundResult | null => r?.firm_results.find((f) => f.firm_id === id) ?? null;
/** Revenue-weighted average price across the categories a firm sold in (null if it sold nothing). */
export function avgPrice(f: FirmRoundResult | null): number | null {
  if (!f) return null;
  let rev = 0, q = 0;
  for (const s of Object.values(f.segments)) { rev += s.revenue; q += s.q_sold; }
  return q > 0 ? rev / q : null;
}
/** Gross margin in points (gross ÷ revenue × 100); null when the firm sold nothing. */
export function grossMarginOf(f: FirmRoundResult | null): number | null {
  const p = f?.pnl;
  return p && p.revenue > 0 ? (p.gross / p.revenue) * 100 : null;
}
const rankOf = (r: RoundResult, firmId: FirmId): number | null => { const i = rankStandings(r.firm_results).findIndex((f) => f.firm_id === firmId); return i < 0 ? null : i + 1; };

export const FORECAST_CATALOG: ForecastItem[] = [
  {
    id: "team_rank", short: "Rank", kind: "rank", title: "Where we finish",
    roles: ["ceo", "cfo", "cmo", "coo", "chro", "member"],
    realized: ({ result, firmId }) => rankOf(result, firmId),
  },
  {
    id: "gross_margin", short: "Gross margin", kind: "bucket", title: "My gross margin",
    roles: ["ceo", "cfo", "cmo", "coo", "chro", "member"],
    realized: ({ result, firmId }) => grossMarginOf(firmIn(result, firmId)),
  },
  {
    id: "rival_price", short: "Rival's price", kind: "choice", title: "{target}’s price", options: ["down", "flat", "up"], target: "rival",
    roles: ["ceo", "cfo", "cmo", "coo", "chro", "member"],
    realized: ({ result, prev, target }) => {
      const now = avgPrice(firmIn(result, target ?? "")), was = avgPrice(firmIn(prev, target ?? ""));
      if (now == null || was == null || was <= 0) return null; // first round, or the rival sold nothing
      const d = now / was - 1;
      return d > FLAT_BAND ? "up" : d < -FLAT_BAND ? "down" : "flat";
    },
  },
  // Dropped from the prompts in DW-077 (roles: []) — kept so rows stored by the DW-074 surface still settle.
  {
    id: "own_share", short: "Shopper share", kind: "number", title: "My {target} share", target: "segment",
    roles: [],
    realized: ({ result, firmId, target }) => { const s = target ? firmIn(result, firmId)?.segments[target] : null; return s ? s.share * 100 : null; },
  },
];
const ITEM = new Map(FORECAST_CATALOG.map((i) => [i.id as string, i]));

export const forecastsEnabled = (config: Config | null | undefined): boolean => !!config?.classroom?.forecasts?.enabled;
/** The items one seat is asked, at most MAX_CALLS_PER_SEAT, in catalog order. */
export const itemsForRole = (role: string | null | undefined): ForecastItem[] => {
  const r = role && FORECAST_CATALOG.some((i) => i.roles.includes(role)) ? role : "member";
  return FORECAST_CATALOG.filter((i) => i.roles.includes(r)).slice(0, MAX_CALLS_PER_SEAT);
};

// ── margin buckets ────────────────────────────────────────────────────────────────────────────
/** The anchor a = floor(m / 4) × 4 of last round's margin m (28 with no history). */
export const marginAnchor = (lastMargin: number | null | undefined): number =>
  lastMargin == null || !Number.isFinite(lastMargin) ? MARGIN_ANCHOR_DEFAULT : Math.floor(lastMargin / MARGIN_BUCKET_PTS) * MARGIN_BUCKET_PTS;
/** Bucket bounds from a stored value: "<28" · "28:32" · ">36" (lo inclusive, hi exclusive). */
export function bucketOf(value: number | string): { lo: number | null; hi: number | null } | null {
  const s = String(value).trim();
  let m = s.match(/^<(-?\d+(?:\.\d+)?)$/);
  if (m) return { lo: null, hi: Number(m[1]) };
  m = s.match(/^>(-?\d+(?:\.\d+)?)$/);
  if (m) return { lo: Number(m[1]), hi: null };
  m = s.match(/^(-?\d+(?:\.\d+)?):(-?\d+(?:\.\d+)?)$/);
  if (m && Number(m[1]) < Number(m[2])) return { lo: Number(m[1]), hi: Number(m[2]) };
  return null;
}
export const bucketLabel = (value: number | string): string => {
  const b = bucketOf(value);
  if (!b) return String(value);
  if (b.lo == null) return `<${b.hi}%`;
  if (b.hi == null) return `>${b.lo}%`;
  return `${b.lo}–${b.hi}%`;
};
/** The four tickets' options for an anchor a: <a · a–a+4 · a+4–a+8 · >a+8. */
export function marginBuckets(anchor: number): ForecastOption[] {
  const w = MARGIN_BUCKET_PTS;
  const vals = [`<${anchor}`, `${anchor}:${anchor + w}`, `${anchor + w}:${anchor + 2 * w}`, `>${anchor + 2 * w}`];
  return vals.map((value) => ({ value, label: bucketLabel(value) }));
}

const MOVE_LABEL: Record<string, string> = { up: "Raise", flat: "Hold", down: "Cut" };
const MOVE_VERB: Record<string, string> = { up: "raised", flat: "held", down: "cut" };
const pts = (n: number) => `${(Math.round(Math.abs(n) * 10) / 10).toFixed(1)}`;
const money2 = (n: number) => `$${n.toFixed(2)}`;
const places = (n: number) => (n === 1 ? "One place" : n === 2 ? "Two places" : n === 3 ? "Three places" : `${n} places`);

/** One call, settled. `verdict`/`score` are null until the round resolves or when the realized
 *  value doesn't exist (a rival's move in round 1; a firm that sold nothing) — `note` says why. */
export interface ScoredCall {
  round: number; teamId: string; firmId: FirmId; userId: string; name: string | null; role: string | null;
  item: ForecastItemId; target: string | null; targetName: string | null;
  value: number | string; valueLabel: string;
  realized: Realized; realizedLabel: string | null;
  /** rank / number: called − realized · bucket: signed distance of the realized value from the
   *  bucket's nearer edge (0 inside) · choice: null */
  error: number | null;
  score: number | null; // 1 / 0.5 / 0 — the calibration mean and the export roll-up read this
  verdict: Verdict | null;
  note: string;
}
export interface Calibration { calls: number; scored: number; hits: number; score: number | null }

/** The label a student reads for a call value. */
export function valueLabel(item: ForecastItem, value: number | string): string {
  if (item.kind === "rank") return `#${Math.round(Number(value))}`;
  if (item.kind === "bucket") return bucketLabel(value);
  if (item.kind === "choice") return MOVE_LABEL[String(value)] ?? String(value);
  return `${Math.round(Number(value) * 10) / 10}%`;
}

/** Settle one call against its realized value. Pure; `detail` carries what the note names. */
export function scoreCall(item: ForecastItem, value: number | string, realized: Realized, detail: { targetName?: string | null; now?: number | null; was?: number | null; inResult?: boolean } = {}): Pick<ScoredCall, "error" | "score" | "verdict" | "note" | "realizedLabel"> {
  const rival = detail.targetName ?? "The rival";
  const unsettled = (why: string) => ({ error: null, score: null, verdict: null, note: why, realizedLabel: null });
  if (realized == null) {
    if (item.kind === "choice") {
      if (detail.was == null) return unsettled("Not settled — no earlier price to compare against.");
      if (detail.now == null) return unsettled(`Not settled — ${rival} sold nothing this round.`);
      return unsettled("Not settled — no price move to read.");
    }
    if (detail.inResult === false) return unsettled("Not settled — your brewery didn't trade this round.");
    return unsettled(item.kind === "bucket" ? "Not settled — no sales, so no margin to read." : "Not settled.");
  }
  const V = (verdict: Verdict, error: number | null, note: string, realizedLabel: string) => ({ verdict, score: verdict === "nailed" ? 1 : verdict === "close" ? 0.5 : 0, error, note, realizedLabel });
  if (item.kind === "rank") {
    const called = Math.round(Number(value)), got = Math.round(Number(realized));
    const off = Math.abs(called - got);
    const lbl = `#${got}`;
    if (off === 0) return V("nailed", 0, "Spot on.", lbl);
    const dir = got > called ? "below" : "above";
    return V(off === 1 ? "close" : "missed", called - got, `${places(off)} off, ${dir} your call.`, lbl);
  }
  if (item.kind === "bucket") {
    const m = Number(realized);
    const lbl = `${(Math.round(m * 10) / 10).toFixed(1)}%`;
    const b = bucketOf(value);
    if (!b) return V("missed", null, "Unreadable call.", lbl);
    const under = b.lo != null && m < b.lo, over = b.hi != null && m >= b.hi; // lo inclusive, hi exclusive
    if (!under && !over) return V("nailed", 0, "Inside your bucket.", lbl);
    const gap = under ? (b.lo as number) - m : m - (b.hi as number);
    const note = `${pts(gap)} points ${under ? "under" : "over"}.`;
    return V(gap <= CLOSE_MARGIN_PTS ? "close" : "missed", under ? -gap : gap, note, lbl);
  }
  if (item.kind === "choice") {
    const got = String(realized);
    const delta = detail.now != null && detail.was != null ? detail.now - detail.was : null;
    const lbl = got === "flat" ? `Held${detail.now != null ? ` at ${money2(detail.now)}` : ""}` : `${MOVE_VERB[got] === "raised" ? "Raised" : "Cut"}${delta != null ? ` ${money2(Math.abs(delta))}` : ""}`;
    const what = got === "flat" ? `${rival} held its average price${detail.now != null ? ` at ${money2(detail.now)}` : ""}` : `${rival} ${MOVE_VERB[got]} its average price${delta != null ? ` ${money2(Math.abs(delta))}` : ""}`;
    if (String(value) === got) return V("nailed", null, `Right direction. ${what}.`, lbl);
    return V("missed", null, `Wrong way. ${what}.`, lbl);
  }
  // legacy number (own_share): a continuous call, settled by distance
  const error = Number(value) - Number(realized);
  const lbl = `${Math.round(Number(realized) * 10) / 10}%`;
  const a = Math.abs(error);
  return V(a <= CLOSE_MARGIN_PTS ? "nailed" : a <= 5 ? "close" : "missed", error, a <= CLOSE_MARGIN_PTS ? "Within 2 points." : `${pts(a)} points ${error > 0 ? "over" : "under"}.`, lbl);
}

export function calibrationOf(calls: ScoredCall[]): Calibration {
  const scored = calls.filter((c) => c.score != null);
  const hits = scored.filter((c) => c.verdict === "nailed" || c.verdict === "close").length;
  return { calls: calls.length, scored: scored.length, hits, score: scored.length ? scored.reduce((a, c) => a + (c.score as number), 0) / scored.length : null };
}

/** Stored rows → settled calls, in a stable order (round, firm, role, user, catalog order). */
export function scoreForecasts(rows: ForecastRecord[], results: { round: number; result: RoundResult }[], teams: TeamRecord[]): ScoredCall[] {
  const byRound = new Map(results.map((r) => [r.round, r.result]));
  const team = new Map(teams.map((t) => [t.id, t]));
  const nameOfFirm = new Map(teams.map((t) => [t.firm_id, t.name]));
  const out: ScoredCall[] = [];
  for (const row of rows) {
    const t = team.get(row.team_id);
    if (!t) continue;
    const result = byRound.get(row.round) ?? null;
    const prev = byRound.get(row.round - 1) ?? null;
    const name = t.members?.find((m) => m.user_id === row.user_id)?.display_name ?? null;
    for (const item of FORECAST_CATALOG) {
      const call = row.calls[item.id];
      if (!call) continue;
      const target = call.target ?? null;
      const targetName = item.target === "rival" && target ? nameOfFirm.get(target) ?? target : null;
      const base = { round: row.round, teamId: t.id, firmId: t.firm_id, userId: row.user_id, name, role: row.role, item: item.id, target, targetName, value: call.value, valueLabel: valueLabel(item, call.value) };
      if (!result) { out.push({ ...base, realized: null, realizedLabel: null, error: null, score: null, verdict: null, note: "Settles when the round resolves." }); continue; }
      const realized = item.realized({ result, prev, firmId: t.firm_id, target });
      const detail = item.kind === "choice"
        ? { targetName, now: avgPrice(firmIn(result, target ?? "")), was: avgPrice(firmIn(prev, target ?? "")) }
        : { inResult: !!firmIn(result, t.firm_id) };
      out.push({ ...base, realized, ...scoreCall(item, call.value, realized, detail) });
    }
  }
  const pos = new Map(FORECAST_CATALOG.map((i, k) => [i.id as string, k]));
  const byNum = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  return out.sort((a, b) => a.round - b.round || byNum(a.firmId, b.firmId) || (a.role ?? "").localeCompare(b.role ?? "") || a.userId.localeCompare(b.userId) || (pos.get(a.item)! - pos.get(b.item)!));
}

export class ForecastError extends Error {}

/** Clean one seat's submitted calls against the catalog: only items asked of this seat, values
 *  well-formed, targets that exist. A blank value clears the call. Throws on a malformed call. */
export function sanitizeCalls(raw: unknown, role: string | null, ctx: { nFirms: number; segments: string[]; rivals: string[] }): Record<string, ForecastCall> {
  const out: Record<string, ForecastCall> = {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) throw new ForecastError("calls must be an object keyed by item id");
  const asked = new Set(itemsForRole(role).map((i) => i.id as string));
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const item = ITEM.get(id);
    if (!item || !asked.has(id)) throw new ForecastError(`"${id}" is not a call this seat is asked for`);
    const c = (v ?? {}) as { value?: unknown; target?: unknown };
    if (c.value == null || c.value === "") continue; // cleared
    let target: string | undefined;
    if (item.target) {
      target = String(c.target ?? "");
      if (!(item.target === "segment" ? ctx.segments : ctx.rivals).includes(target)) throw new ForecastError(`${item.short}: pick a ${item.target === "segment" ? "category" : "rival"}`);
    }
    if (item.kind === "choice") {
      if (!item.options!.includes(String(c.value))) throw new ForecastError(`${item.short}: choose one of ${item.options!.map((o) => MOVE_LABEL[o] ?? o).join(" / ")}`);
      out[id] = { value: String(c.value), ...(target ? { target } : {}) };
    } else if (item.kind === "bucket") {
      if (!bucketOf(String(c.value))) throw new ForecastError(`${item.short}: pick one of the four bands`);
      out[id] = { value: String(c.value).trim() };
    } else {
      const n = Number(c.value);
      const max = item.kind === "rank" ? ctx.nFirms : 100, min = item.kind === "rank" ? 1 : 0;
      if (!Number.isFinite(n) || n < min || n > max) throw new ForecastError(`${item.short}: enter a number from ${min} to ${max}`);
      out[id] = { value: item.kind === "rank" ? Math.round(n) : Math.round(n * 10) / 10, ...(target ? { target } : {}) };
    }
  }
  return out;
}

/** Who is asking: the session's game + user. The team comes from membership, never the token —
 *  an instructor move must not leave a player reading (or calling for) their old firm (DW-066). */
export interface ForecastSeat { gameId: string; userId: string }
const seatOf = (teams: TeamRecord[], userId: string) => {
  const t = teams.find((x) => x.member_user_ids.includes(userId));
  return t ? { team: t, role: t.members?.find((m) => m.user_id === userId)?.role ?? null } : null;
};

/** One ticket as the student sees it: title, hint, the options to tap, and (for the rival's
 *  price) the pre-selected top rival. Everything the client renders comes from here. */
export interface ForecastPrompt {
  id: ForecastItemId; title: string; short: string; kind: ForecastItem["kind"];
  hint: string;
  options: ForecastOption[];
  target?: string; targetLabel?: string; // rival firm id + name (pre-selected, stored with the call)
}

/** The top rival = the highest-ranked OTHER firm after the last resolved round (first rival in
 *  firm order before any round has resolved). */
export function topRival(prev: RoundResult | null, rivals: { id: string; label: string }[]): { id: string; label: string } | null {
  if (!rivals.length) return null;
  if (prev) for (const f of rankStandings(prev.firm_results)) { const r = rivals.find((x) => x.id === f.firm_id); if (r) return r; }
  return rivals[0];
}

/** The prompt list one seat sees this round. `prev` = the last resolved round (anchors + hints). */
export function promptsFor(role: string | null, firmId: FirmId, nFirms: number, prev: RoundResult | null, rivals: { id: string; label: string }[]): ForecastPrompt[] {
  const me = firmIn(prev, firmId);
  return itemsForRole(role).map((i) => {
    const base = { id: i.id, short: i.short, kind: i.kind };
    if (i.kind === "rank") {
      const last = prev ? rankOf(prev, firmId) : null;
      return { ...base, title: i.title, hint: last ? `last round #${last}` : `of ${nFirms} firms`, options: Array.from({ length: Math.max(1, nFirms) }, (_, k) => ({ value: k + 1, label: `#${k + 1}` })) };
    }
    if (i.kind === "bucket") {
      const m = grossMarginOf(me);
      return { ...base, title: i.title, hint: m != null ? `last round ${(Math.round(m * 10) / 10).toFixed(1)}%` : `no history yet · anchored at ${MARGIN_ANCHOR_DEFAULT}%`, options: marginBuckets(marginAnchor(m)) };
    }
    if (i.kind === "choice") {
      const r = topRival(prev, rivals);
      const p = r ? avgPrice(firmIn(prev, r.id)) : null;
      return { ...base, title: i.title.replace("{target}", r?.label ?? "Top rival"), hint: p != null ? `now ${money2(p)}` : "no price yet", options: (i.options ?? []).map((o) => ({ value: o, label: MOVE_LABEL[o] ?? o })), ...(r ? { target: r.id, targetLabel: r.label } : {}) };
    }
    return { ...base, title: i.title, hint: "", options: [] };
  });
}

export interface SeatForecasts {
  enabled: boolean;
  me?: string; // the caller's user id — which of `calls` are "you"
  round?: number; lifecycle?: string; open?: boolean; nFirms?: number;
  prompts?: ForecastPrompt[];
  /** this seat's calls for the current round (editable while `open`) */
  mine?: Record<string, ForecastCall>;
  /** every call the FIRM's seats have made, settled where the round has resolved — own firm only */
  calls?: ScoredCall[];
  calibration?: { me: Calibration; team: Calibration };
}

async function context(store: StorageAdapter, gameId: string) {
  const game = await store.getGame(gameId);
  if (!game) throw new ForecastError(`no game ${gameId}`);
  return { game, enabled: forecastsEnabled(game.config) };
}

/** GET /forecasts — this seat's tickets + its own firm's calls. Rivals' calls never leave the server. */
export async function getSeatForecasts(store: StorageAdapter, s: ForecastSeat): Promise<SeatForecasts> {
  const { game, enabled } = await context(store, s.gameId);
  if (!enabled) return { enabled: false };
  const teams = await store.getTeams(s.gameId);
  const seat = seatOf(teams, s.userId);
  if (!seat) throw new ForecastError("you are no longer seated in this game");
  const rivals = teams.filter((t) => t.id !== seat.team.id).map((t) => ({ id: t.firm_id, label: t.name }));
  const rows = (await store.getForecasts(s.gameId)).filter((r) => r.team_id === seat.team.id);
  const results = await store.getRoundResults(s.gameId);
  const prev = results.find((r) => r.round === game.current_round - 1)?.result ?? null;
  const calls = scoreForecasts(rows, results, teams);
  return {
    enabled: true, me: s.userId, round: game.current_round, lifecycle: game.lifecycle, open: game.lifecycle === "open", nFirms: teams.length,
    prompts: promptsFor(seat.role, seat.team.firm_id, teams.length, prev, rivals),
    mine: rows.find((r) => r.round === game.current_round && r.user_id === s.userId)?.calls ?? {},
    calls,
    calibration: { me: calibrationOf(calls.filter((c) => c.userId === s.userId)), team: calibrationOf(calls) },
  };
}

/** POST /forecasts — replace this seat's calls for the current round. Open rounds only. */
export async function submitForecasts(store: StorageAdapter, clock: () => number, s: ForecastSeat, rawCalls: unknown): Promise<{ ok: true; calls: Record<string, ForecastCall> }> {
  const { game, enabled } = await context(store, s.gameId);
  if (!enabled) throw new ForecastError("calls are not enabled for this game");
  if (game.lifecycle !== "open") throw new ForecastError(`calls are closed: the round is "${game.lifecycle}", not open`);
  const teams = await store.getTeams(s.gameId);
  const seat = seatOf(teams, s.userId);
  if (!seat) throw new ForecastError("you are no longer seated in this game");
  // DW-080: the world state is read only to validate a category-targeted call — most saves carry none
  // (every tap posts here; at class size that was one avoidable read each)
  const asked = rawCalls && typeof rawCalls === "object" && !Array.isArray(rawCalls) ? Object.keys(rawCalls as object) : [];
  const ws = asked.some((id) => ITEM.get(id)?.target === "segment") ? await store.getLatestWorldState(s.gameId) : null;
  const calls = sanitizeCalls(rawCalls, seat.role, {
    nFirms: teams.length,
    segments: (ws?.state.segments ?? []).filter((x) => x.active).map((x) => x.id),
    rivals: teams.filter((t) => t.id !== seat.team.id).map((t) => t.firm_id),
  });
  await store.upsertForecast({ game_id: s.gameId, round: game.current_round, team_id: seat.team.id, user_id: s.userId, role: seat.role, calls, updated_at: clock() });
  return { ok: true, calls };
}

export interface InstructorForecasts {
  enabled: boolean; round?: number; lifecycle?: string;
  teams?: { teamId: string; firmId: FirmId; name: string; calibration: Calibration; seats: { userId: string; name: string | null; role: string | null; calledThisRound: number; calibration: Calibration }[] }[];
  calls?: ScoredCall[];
}

/** GET /instructor/games/:id/forecasts — every seat's calls, realized values and record. */
export async function getGameForecasts(store: StorageAdapter, gameId: string): Promise<InstructorForecasts> {
  const { game, enabled } = await context(store, gameId);
  if (!enabled) return { enabled: false };
  const teams = await store.getTeams(gameId);
  const rows = await store.getForecasts(gameId);
  const calls = scoreForecasts(rows, await store.getRoundResults(gameId), teams);
  return {
    enabled: true, round: game.current_round, lifecycle: game.lifecycle,
    teams: [...teams].sort((a, b) => a.firm_id.localeCompare(b.firm_id, undefined, { numeric: true })).map((t) => ({
      teamId: t.id, firmId: t.firm_id, name: t.name,
      calibration: calibrationOf(calls.filter((c) => c.teamId === t.id)),
      seats: t.member_user_ids.map((uid) => {
        const m = t.members?.find((x) => x.user_id === uid);
        return {
          userId: uid, name: m?.display_name ?? null, role: m?.role ?? null,
          calledThisRound: Object.keys(rows.find((r) => r.round === game.current_round && r.user_id === uid && r.team_id === t.id)?.calls ?? {}).length,
          calibration: calibrationOf(calls.filter((c) => c.userId === uid && c.teamId === t.id)),
        };
      }),
    })),
    calls,
  };
}

/** Export rows (JSON `forecasts` + the CSV's per-firm-round roll-up). Undefined when the flag is
 *  off, so a flag-off export is byte-identical to before and the forecasts table is never read. */
export async function exportForecasts(store: StorageAdapter, gameId: string, config: Config, results: { round: number; result: RoundResult }[], teams: TeamRecord[]): Promise<ScoredCall[] | undefined> {
  if (!forecastsEnabled(config)) return undefined;
  return scoreForecasts(await store.getForecasts(gameId), results, teams);
}
