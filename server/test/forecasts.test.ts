/**
 * DW-074/DW-077 calls (forecast commitment) — a channel parallel to decisions. In-memory adapter.
 * Covers: flag off = inert; the three tickets per seat; margin buckets + anchors; verdicts
 * (NAILED / CLOSE / MISSED) and the hit record; submit / read / replace; own-firm-only reads
 * (rivals' calls never leave the server); closed once the round locks; settling on read;
 * determinism; the decision path never sees a call; the export roll-up.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { rankStandings } from "drinkwars-engine";
import { GameOrchestrator, InMemoryAdapter } from "../src/index.js";
import { buildInstructorDashboard, dashboardToCsv } from "../src/dashboard.js";
import { FORECAST_CATALOG, MAX_CALLS_PER_SEAT, MARGIN_ANCHOR_DEFAULT, avgPrice, bucketOf, bucketLabel, calibrationOf, getGameForecasts, getSeatForecasts, grossMarginOf, itemsForRole, marginAnchor, marginBuckets, scoreCall, scoreForecasts, submitForecasts, topRival } from "../src/forecasts.js";

async function game(on: boolean) {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 4 }, ...(on ? { classroom: { forecasts: { enabled: true } } } : {}) } as never);
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store, () => 1000, { botFillEmptySlots: true, noShowPolicy: "carry" });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const [f1, f2, f3] = await store.getTeams(gameId); // F1 "Hop Theory" / F2 "Low Tide" / F3 "F3" after the joins below
  await orch.joinGame(code, "Ana", "u-ceo", { teamId: f1.id, role: "ceo", teamName: "Hop Theory" });
  await orch.joinGame(code, "Ben", "u-cmo", { teamId: f1.id, role: "cmo" });
  await orch.joinGame(code, "Cy", "u-rival", { teamId: f2.id, role: "ceo", teamName: "Low Tide" });
  const playRound = async (rivalPrice?: number) => {
    const g = (await store.getGame(gameId))!;
    await orch.submitMemberDecision(gameId, f1.id, "u-ceo", { invest_Q: 10_000 + g.current_round }, "ceo");
    await orch.submitMemberDecision(gameId, f2.id, "u-rival", { invest_B: 5_000, ...(rivalPrice ? { price: { mass: rivalPrice, niche: rivalPrice, frontier: rivalPrice } } : {}) }, "ceo");
    await orch.lockRound(gameId);
    await orch.resolveRound(gameId);
    await orch.advanceRound(gameId);
  };
  return { store, orch, gameId, f1, f2, f3, playRound };
}
const seat = (gameId: string, userId: string) => ({ gameId, userId });
const item = (id: string) => FORECAST_CATALOG.find((i) => i.id === id)!;

test("the flag carries through the config resolver, and is off unless set", async () => {
  assert.equal(loadConfig({ game: { n_firms: 3 } } as never).classroom, undefined);
  assert.equal(loadConfig({ classroom: { forecasts: { enabled: true } } } as never).classroom?.forecasts?.enabled, true);
});

test("flag off: the channel is inert — reads say disabled, writes are refused, the table is never touched", async () => {
  const { store, gameId } = await game(false);
  let touched = 0;
  const spy = new Proxy(store, { get: (t, p, r) => { if (p === "getForecasts" || p === "upsertForecast") touched++; return Reflect.get(t, p, r); } });
  assert.deepEqual(await getSeatForecasts(spy, seat(gameId, "u-ceo")), { enabled: false });
  assert.deepEqual(await getGameForecasts(spy, gameId), { enabled: false });
  await assert.rejects(() => submitForecasts(spy, () => 1, seat(gameId, "u-ceo"), { team_rank: { value: 1 } }), /not enabled/);
  assert.equal((await buildInstructorDashboard(spy, gameId)).forecasts, undefined);
  assert.equal(touched, 0);
});

test("every seat (and a solo member) is asked the same three tickets; own_share is kept for stored data only", () => {
  for (const role of ["ceo", "cfo", "cmo", "coo", "chro", "member", null, "made-up"]) {
    assert.deepEqual(itemsForRole(role).map((i) => i.id), ["team_rank", "gross_margin", "rival_price"], String(role));
    assert.ok(itemsForRole(role).length <= MAX_CALLS_PER_SEAT);
  }
  assert.deepEqual(item("own_share").roles, []);
  assert.equal(new Set(FORECAST_CATALOG.map((i) => i.id)).size, FORECAST_CATALOG.length);
});

test("margin buckets: anchor = floor(m/4)×4, 28 with no history; four self-describing bands; bounds parse back", () => {
  assert.equal(marginAnchor(31.9), 28);
  assert.equal(marginAnchor(32), 32);
  assert.equal(marginAnchor(35.99), 32);
  assert.equal(marginAnchor(-3), -4);
  assert.equal(marginAnchor(null), MARGIN_ANCHOR_DEFAULT);
  assert.equal(marginAnchor(NaN), MARGIN_ANCHOR_DEFAULT);
  assert.deepEqual(marginBuckets(28), [
    { value: "<28", label: "<28%" }, { value: "28:32", label: "28–32%" }, { value: "32:36", label: "32–36%" }, { value: ">36", label: ">36%" },
  ]);
  assert.deepEqual(marginBuckets(-4).map((o) => o.value), ["<-4", "-4:0", "0:4", ">4"]);
  assert.deepEqual(bucketOf("<28"), { lo: null, hi: 28 });
  assert.deepEqual(bucketOf("28:32"), { lo: 28, hi: 32 });
  assert.deepEqual(bucketOf(">36"), { lo: 36, hi: null });
  assert.deepEqual(bucketOf("-4:0"), { lo: -4, hi: 0 });
  assert.equal(bucketOf("32:28"), null, "an inverted band is malformed");
  assert.equal(bucketOf("28"), null);
  assert.equal(bucketOf("twenty"), null);
  assert.equal(bucketLabel("32:36"), "32–36%");
});

test("verdicts: rank exact / one place / further; margin inside / within 2 of the nearer edge / beyond; price direction", () => {
  const rank = item("team_rank"), gm = item("gross_margin"), rp = item("rival_price");
  const v = (r: ReturnType<typeof scoreCall>) => [r.verdict, r.score];
  assert.deepEqual(v(scoreCall(rank, 3, 3)), ["nailed", 1]);
  assert.deepEqual(v(scoreCall(rank, 3, 4)), ["close", 0.5]);
  assert.deepEqual(v(scoreCall(rank, 4, 3)), ["close", 0.5]);
  assert.deepEqual(v(scoreCall(rank, 1, 3)), ["missed", 0]);
  assert.equal(scoreCall(rank, 3, 4).note, "One place off, below your call.");
  assert.equal(scoreCall(rank, 3, 1).note, "Two places off, above your call.");
  assert.equal(scoreCall(rank, 2, 2).realizedLabel, "#2");

  assert.deepEqual(v(scoreCall(gm, "28:32", 28)), ["nailed", 1], "lower bound is inside");
  assert.deepEqual(v(scoreCall(gm, "28:32", 31.99)), ["nailed", 1]);
  assert.deepEqual(v(scoreCall(gm, "28:32", 32)), ["close", 0.5], "upper bound belongs to the next band");
  assert.deepEqual(v(scoreCall(gm, "28:32", 34)), ["close", 0.5], "2 points over the nearer edge");
  assert.deepEqual(v(scoreCall(gm, "28:32", 34.01)), ["missed", 0]);
  assert.deepEqual(v(scoreCall(gm, "28:32", 26)), ["close", 0.5], "2 points under");
  assert.deepEqual(v(scoreCall(gm, "28:32", 25.9)), ["missed", 0]);
  assert.deepEqual(v(scoreCall(gm, "<28", 10)), ["nailed", 1]);
  assert.deepEqual(v(scoreCall(gm, "<28", 29.5)), ["close", 0.5]);
  assert.deepEqual(v(scoreCall(gm, ">36", 40)), ["nailed", 1]);
  assert.deepEqual(v(scoreCall(gm, ">36", 35)), ["close", 0.5]);
  assert.deepEqual(v(scoreCall(gm, ">36", 30)), ["missed", 0]);
  assert.equal(scoreCall(gm, ">36", 29.9).note, "6.1 points under.");
  assert.equal(scoreCall(gm, "28:32", 33).note, "1.0 points over.");
  assert.equal(scoreCall(gm, "28:32", 33).error, 1);
  assert.equal(scoreCall(gm, "28:32", 27).error, -1);
  assert.equal(scoreCall(gm, "28:32", 31.94).realizedLabel, "31.9%");

  const d = { targetName: "Low Tide", now: 8.45, was: 8.05 };
  assert.deepEqual(v(scoreCall(rp, "up", "up", d)), ["nailed", 1]);
  assert.equal(scoreCall(rp, "up", "up", d).note, "Right direction. Low Tide raised its average price $0.40.");
  assert.equal(scoreCall(rp, "up", "up", d).realizedLabel, "Raised $0.40");
  assert.deepEqual(v(scoreCall(rp, "flat", "up", d)), ["missed", 0], "no CLOSE on a direction");
  assert.deepEqual(v(scoreCall(rp, "flat", "flat", { targetName: "Low Tide", now: 8.1, was: 8.05 })), ["nailed", 1]);
  assert.equal(scoreCall(rp, "down", "flat", { targetName: "Low Tide", now: 8.1, was: 8.05 }).note, "Wrong way. Low Tide held its average price at $8.10.");

  // unsettled: say why, score null (not counted in the record)
  assert.deepEqual(v(scoreCall(rp, "up", null, { targetName: "Low Tide", now: 8.1, was: null })), [null, null]);
  assert.match(scoreCall(rp, "up", null, { targetName: "Low Tide", now: 8.1, was: null }).note, /no earlier price/);
  assert.match(scoreCall(rp, "up", null, { targetName: "Low Tide", now: null, was: 8 }).note, /Low Tide sold nothing this round/);
  assert.match(scoreCall(gm, "28:32", null, { inResult: false }).note, /didn't trade/);
  assert.match(scoreCall(gm, "28:32", null, { inResult: true }).note, /no margin/);
  assert.deepEqual(v(scoreCall(item("own_share"), 20, null)), [null, null]);
  assert.deepEqual(v(scoreCall(item("own_share"), 20, 21)), ["nailed", 1], "legacy continuous call still settles");
});

test("the record counts NAILED and CLOSE as hits of settled calls", () => {
  const mk = (verdict: "nailed" | "close" | "missed" | null) => ({ verdict, score: verdict === "nailed" ? 1 : verdict === "close" ? 0.5 : verdict === "missed" ? 0 : null }) as never;
  assert.deepEqual(calibrationOf([mk("nailed"), mk("close"), mk("missed"), mk(null)]), { calls: 4, scored: 3, hits: 2, score: 0.5 });
  assert.deepEqual(calibrationOf([]), { calls: 0, scored: 0, hits: 0, score: null });
});

test("submit → read back; prompts carry anchors, options and the pre-selected top rival; bad calls are refused", async () => {
  const { store, gameId, f2, f3 } = await game(true);
  const s = seat(gameId, "u-ceo");
  const v0 = await getSeatForecasts(store, s);
  assert.equal(v0.enabled, true);
  assert.equal(v0.open, true);
  assert.equal(v0.nFirms, 3);
  const [pr, pm, pp] = v0.prompts!;
  assert.deepEqual(v0.prompts!.map((p) => p.id), ["team_rank", "gross_margin", "rival_price"]);
  assert.deepEqual(pr.options.map((o) => o.label), ["#1", "#2", "#3"], "rank is bounded by the number of firms");
  assert.equal(pr.hint, "of 3 firms");
  assert.deepEqual(pm.options.map((o) => o.value), ["<28", "28:32", "32:36", ">36"], "round 1 anchors on 28");
  assert.match(pm.hint, /anchored at 28%/);
  assert.equal(pp.target, f2.firm_id, "the top rival is pre-selected (firm order before any round)");
  assert.equal(pp.targetLabel, "Low Tide");
  assert.equal(pp.title, "Low Tide’s price");
  assert.equal(pp.hint, "no price yet");
  assert.deepEqual(pp.options.map((o) => o.label), ["Cut", "Hold", "Raise"]);

  await submitForecasts(store, () => 5, s, { team_rank: { value: 2 }, gross_margin: { value: "28:32" }, rival_price: { value: "up", target: f2.firm_id } });
  let v = await getSeatForecasts(store, s);
  assert.deepEqual(v.mine, { team_rank: { value: 2 }, gross_margin: { value: "28:32" }, rival_price: { value: "up", target: f2.firm_id } });
  assert.equal(v.calls!.length, 3);
  assert.ok(v.calls!.every((c) => c.realized === null && c.score === null && c.verdict === null), "nothing is settled before the round resolves");
  assert.ok(v.calls!.every((c) => /Settles when/.test(c.note)));
  assert.deepEqual(v.calls!.map((c) => c.valueLabel), ["#2", "28–32%", "Raise"]);
  assert.equal(v.calls![2].targetName, "Low Tide");

  await submitForecasts(store, () => 6, s, { team_rank: { value: 1 }, gross_margin: { value: "" } });
  v = await getSeatForecasts(store, s);
  assert.deepEqual(v.mine, { team_rank: { value: 1 } }, "the latest submit is the whole set");

  await assert.rejects(() => submitForecasts(store, () => 7, s, { own_share: { value: 20, target: "mass" } }), /not a call this seat is asked for/);
  await assert.rejects(() => submitForecasts(store, () => 7, s, { team_rank: { value: 9 } }), /from 1 to 3/);
  await assert.rejects(() => submitForecasts(store, () => 7, s, { gross_margin: { value: "30" } }), /four bands/);
  await assert.rejects(() => submitForecasts(store, () => 7, s, { gross_margin: { value: "32:28" } }), /four bands/);
  await assert.rejects(() => submitForecasts(store, () => 7, s, { rival_price: { value: "sideways", target: f2.firm_id } }), /choose one of Cut \/ Hold \/ Raise/);
  await assert.rejects(() => submitForecasts(store, () => 7, s, { rival_price: { value: "up", target: "firm_1" } }), /pick a rival/);
  await assert.rejects(() => submitForecasts(store, () => 7, s, { rival_price: { value: "up" } }), /pick a rival/);
  await assert.rejects(() => submitForecasts(store, () => 7, s, [1, 2]), /keyed by item id/);
  await assert.rejects(() => submitForecasts(store, () => 7, seat(gameId, "u-nobody"), {}), /no longer seated/);
  assert.deepEqual((await getSeatForecasts(store, s)).mine, { team_rank: { value: 1 } }, "a refused submit changes nothing");
  assert.ok((await getSeatForecasts(store, seat(gameId, "u-rival"))).prompts![2].target !== f2.firm_id, "a rival's own firm is never its target");
  void f3;
});

test("privacy: a seat reads its own firm's calls only — a rival's calls never leave the server", async () => {
  const { store, gameId, f1, f3 } = await game(true);
  await submitForecasts(store, () => 1, seat(gameId, "u-ceo"), { team_rank: { value: 1 } });
  await submitForecasts(store, () => 2, seat(gameId, "u-cmo"), { team_rank: { value: 2 }, gross_margin: { value: "<28" } });
  await submitForecasts(store, () => 3, seat(gameId, "u-rival"), { team_rank: { value: 3 }, rival_price: { value: "down", target: f1.firm_id } });
  const mine = await getSeatForecasts(store, seat(gameId, "u-cmo"));
  assert.deepEqual(mine.calls!.map((c) => c.userId).sort(), ["u-ceo", "u-cmo", "u-cmo"], "teammates' calls are visible");
  const rival = await getSeatForecasts(store, seat(gameId, "u-rival"));
  assert.deepEqual(rival.calls!.map((c) => c.userId), ["u-rival", "u-rival"]);
  const wire = JSON.stringify(rival);
  assert.ok(!wire.includes("u-ceo") && !wire.includes("u-cmo") && !wire.includes("Ana") && !wire.includes("Ben"), "no rival seat or player name on the wire (brewery names are public)");
  const all = await getGameForecasts(store, gameId);
  assert.equal(all.calls!.length, 5, "the instructor sees every seat");
  assert.equal(all.teams!.find((t) => t.teamId === f1.id)!.seats.find((x) => x.userId === "u-cmo")!.calledThisRound, 2);
  void f3;
});

test("calls close when the round locks, and a locked round cannot be re-called", async () => {
  const { store, orch, gameId } = await game(true);
  const s = seat(gameId, "u-ceo");
  await submitForecasts(store, () => 1, s, { team_rank: { value: 2 } });
  await orch.submitMemberDecision(gameId, (await store.getTeams(gameId))[0].id, "u-ceo", { invest_Q: 1 }, "ceo");
  await orch.lockRound(gameId);
  await assert.rejects(() => submitForecasts(store, () => 2, s, { team_rank: { value: 1 } }), /calls are closed/);
  const v = await getSeatForecasts(store, s);
  assert.equal(v.open, false);
  assert.deepEqual(v.mine, { team_rank: { value: 2 } });
});

test("after resolve: calls settle off the stored result; verdicts, record and next-round anchors follow", async () => {
  const { store, gameId, f1, f2, playRound } = await game(true);
  await submitForecasts(store, () => 1, seat(gameId, "u-ceo"), { team_rank: { value: 1 }, gross_margin: { value: "28:32" }, rival_price: { value: "flat", target: f2.firm_id } });
  await submitForecasts(store, () => 1, seat(gameId, "u-cmo"), { team_rank: { value: 3 } });
  await playRound();

  const results = await store.getRoundResults(gameId);
  const r0 = results[0].result, me0 = r0.firm_results.find((f) => f.firm_id === f1.firm_id)!;
  let v = await getSeatForecasts(store, seat(gameId, "u-ceo"));
  const call = (round: number, item: string, user = "u-ceo") => v.calls!.find((c) => c.round === round && c.item === item && c.userId === user)!;

  const rank = rankStandings(r0.firm_results).findIndex((f) => f.firm_id === f1.firm_id) + 1;
  assert.equal(call(0, "team_rank").realized, rank);
  assert.equal(call(0, "team_rank").verdict, rank === 1 ? "nailed" : rank === 2 ? "close" : "missed");
  assert.equal(call(0, "team_rank").realizedLabel, `#${rank}`);
  const gm = grossMarginOf(me0)!;
  assert.equal(call(0, "gross_margin").realized, gm);
  const expect = gm >= 28 && gm < 32 ? "nailed" : (gm < 28 && 28 - gm <= 2) || (gm >= 32 && gm - 32 <= 2) ? "close" : "missed";
  assert.equal(call(0, "gross_margin").verdict, expect);
  assert.equal(call(0, "gross_margin").realizedLabel, `${(Math.round(gm * 10) / 10).toFixed(1)}%`);
  assert.equal(call(0, "rival_price").realized, null, "no prior round ⇒ a price MOVE has no realized value");
  assert.equal(call(0, "rival_price").verdict, null);
  assert.match(call(0, "rival_price").note, /no earlier price/);
  assert.equal(call(0, "team_rank", "u-cmo").verdict, rank === 3 ? "nailed" : rank === 2 ? "close" : "missed");

  // the record: hits of settled calls, pooled per seat and per team
  const mine = v.calls!.filter((c) => c.userId === "u-ceo");
  const settled = mine.filter((c) => c.verdict != null);
  assert.equal(v.calibration!.me.calls, 3);
  assert.equal(v.calibration!.me.scored, settled.length);
  assert.equal(v.calibration!.me.hits, settled.filter((c) => c.verdict !== "missed").length);
  assert.equal(v.calibration!.me.score, settled.reduce((a, c) => a + c.score!, 0) / settled.length);
  assert.equal(v.calibration!.team.calls, 4, "the team's record pools every seat");
  assert.deepEqual(v.mine, {}, "a new round starts with no calls");

  // round-2 prompts: anchored on last round's margin, the top rival is the best-ranked OTHER firm, hint carries its price
  const [pr, pm, pp] = v.prompts!;
  assert.equal(pr.hint, `last round #${rank}`);
  assert.equal(pm.hint, `last round ${(Math.round(gm * 10) / 10).toFixed(1)}%`);
  assert.deepEqual(pm.options.map((o) => o.value), marginBuckets(marginAnchor(gm)).map((o) => o.value));
  const rivals = (await store.getTeams(gameId)).filter((t) => t.id !== f1.id).map((t) => ({ id: t.firm_id, label: t.name }));
  const top = topRival(r0, rivals)!;
  assert.equal(top.id, rankStandings(r0.firm_results).map((f) => f.firm_id).filter((id) => id !== f1.firm_id)[0]);
  assert.equal(pp.target, top.id);
  assert.equal(pp.title, `${top.label}’s price`);
  assert.equal(pp.hint, `now $${avgPrice(r0.firm_results.find((f) => f.firm_id === top.id)!)!.toFixed(2)}`);

  // round 2: a rival price move settles from round 2 on
  await submitForecasts(store, () => 2, seat(gameId, "u-ceo"), { rival_price: { value: "up", target: f2.firm_id } });
  await playRound(12); // F2 raises its price sharply
  v = await getSeatForecasts(store, seat(gameId, "u-ceo"));
  assert.equal(call(1, "rival_price").realized, "up");
  assert.equal(call(1, "rival_price").verdict, "nailed");
  assert.match(call(1, "rival_price").note, /^Right direction\. Low Tide raised its average price \$/);
  assert.match(call(1, "rival_price").realizedLabel!, /^Raised \$/);

  // export: JSON carries every call; the CSV appends the roll-up after every existing column
  const d = await buildInstructorDashboard(store, gameId);
  assert.equal(d.forecasts!.length, 5);
  const [header, ...lines] = dashboardToCsv(d).split("\n");
  const cols = header.split(",");
  assert.deepEqual(cols.slice(-3), ["calls_made", "calls_scored", "calls_score"]);
  assert.equal(cols.indexOf("debt_rbf"), cols.length - 4, "appended after DW-070's last column");
  const row = lines.map((l) => l.split(",")).find((c) => c[cols.indexOf("firm_id")] === f1.firm_id && c[cols.indexOf("round")] === "0")!;
  assert.equal(row[cols.length - 3], "4");
  assert.equal(row[cols.length - 2], "3", "the unsettled price call is not scored");
});

test("deterministic: same rows + results ⇒ same verdicts, whatever order the rows arrive in", async () => {
  const { store, gameId, f2, playRound } = await game(true);
  await submitForecasts(store, () => 1, seat(gameId, "u-ceo"), { team_rank: { value: 2 }, gross_margin: { value: "32:36" } });
  await submitForecasts(store, () => 1, seat(gameId, "u-cmo"), { team_rank: { value: 1 }, gross_margin: { value: "<28" } });
  await submitForecasts(store, () => 1, seat(gameId, "u-rival"), { team_rank: { value: 3 }, rival_price: { value: "down", target: "firm_1" } });
  await playRound();
  await submitForecasts(store, () => 2, seat(gameId, "u-ceo"), { rival_price: { value: "up", target: f2.firm_id } });
  await playRound();
  const rows = await store.getForecasts(gameId), results = await store.getRoundResults(gameId), teams = await store.getTeams(gameId);
  const a = scoreForecasts(rows, results, teams);
  const b = scoreForecasts([...rows].reverse(), [...results].reverse(), [...teams].reverse());
  assert.deepEqual(a, b);
  assert.deepEqual(await getGameForecasts(store, gameId), await getGameForecasts(store, gameId));
  assert.deepEqual(calibrationOf(a), calibrationOf(b));
});

test("legacy DW-074 rows (own_share, numeric margins) still settle instead of crashing the read", async () => {
  const { store, gameId, f1, playRound } = await game(true);
  await playRound();
  // a row the old surface wrote: a shopper-share call + a numeric margin (not a band)
  await store.upsertForecast({ game_id: gameId, round: 0, team_id: f1.id, user_id: "u-cmo", role: "cmo", calls: { own_share: { value: 30, target: "mass" }, gross_margin: { value: 40 } }, updated_at: 1 });
  const v = await getSeatForecasts(store, seat(gameId, "u-cmo"));
  const share = v.calls!.find((c) => c.item === "own_share")!;
  assert.ok(["nailed", "close", "missed"].includes(share.verdict!));
  assert.equal(share.valueLabel, "30%");
  const gm = v.calls!.find((c) => c.item === "gross_margin")!;
  assert.equal(gm.verdict, "missed", "a bandless margin call cannot be nailed");
  assert.equal(gm.note, "Unreadable call.");
});

test("parallel channel: calls never reach the decision, and a game replays identically with them", async () => {
  const on = await game(true), off = await game(false);
  await submitForecasts(on.store, () => 1, seat(on.gameId, "u-ceo"), { team_rank: { value: 1 }, gross_margin: { value: ">36" } });
  await submitForecasts(on.store, () => 1, seat(on.gameId, "u-cmo"), { team_rank: { value: 3 } });
  await on.playRound();
  await off.playRound();
  const dOn = await on.store.getDecision(on.gameId, 0, on.f1.id), dOff = await off.store.getDecision(off.gameId, 0, off.f1.id);
  assert.deepEqual(dOn!.decision, dOff!.decision, "the composed decision is identical with and without calls");
  assert.ok(!/team_rank|gross_margin|own_share|forecast/.test(JSON.stringify(dOn)));
  assert.ok(!/forecast|team_rank/.test(JSON.stringify(await on.store.getMemberDecisions(on.gameId, 0, on.f1.id))));
  const score = (r: Awaited<ReturnType<typeof on.store.getRoundResults>>) => r[0].result.firm_results.map((f) => [f.firm_id, f.scorecard_cumulative, f.state.cash]);
  assert.deepEqual(score(await on.store.getRoundResults(on.gameId)), score(await off.store.getRoundResults(off.gameId)), "results are untouched by calls");
  assert.equal((await on.orch.replay(on.gameId)).ok, true);
});
