/**
 * DW-070: itemized statement lines reach the instructor export (JSON panel + CSV) and appending
 * them moved no existing CSV column. In-memory adapter.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "drinkwars-engine/node";
import { GameOrchestrator, InMemoryAdapter } from "../src/index.js";
import { buildInstructorDashboard, dashboardToCsv } from "../src/dashboard.js";

test("export carries opex / cash-flow / debt lines; CSV appends them after every old column", async () => {
  const config = loadConfig({ game: { n_firms: 3, n_rounds: 4 } } as never);
  const store = new InMemoryAdapter();
  const orch = new GameOrchestrator(store, () => 1000, { botFillEmptySlots: true, noShowPolicy: "carry" });
  const code = GameOrchestrator.makeJoinCode();
  const gameId = await orch.createGame({ config, joinCode: code, firmMode: "team", teams: [{ name: "F1" }, { name: "F2" }, { name: "F3" }] });
  const [f1] = await store.getTeams(gameId);
  await orch.joinGame(code, "Ana", "u-ana", { teamId: f1.id, role: "ceo" });
  await orch.submitMemberDecision(gameId, f1.id, "u-ana", { invest_Q: 12_345, debt_draw: 50_000 }, "ceo");
  await orch.lockRound(gameId);
  await orch.resolveRound(gameId);

  const d = await buildInstructorDashboard(store, gameId);
  const row = d.panel.find((p) => p.firmId === f1.firm_id && p.round === 0)!;
  assert.equal(row.opexLines?.quality, 12_345);
  assert.equal(row.cfLines?.financing.debt_draw, 50_000);
  const opexSum = Object.values(row.opexLines ?? {}).reduce((a, v) => a + (v ?? 0), 0);
  assert.ok(Math.abs(opexSum - row.opex) < 1e-6, `opex lines ${opexSum} vs opex ${row.opex}`);

  const [header, ...lines] = dashboardToCsv(d).split("\n");
  const cols = header.split(",");
  // The old schema ended at `reflection`; everything after it is DW-070's.
  const tail = cols.slice(cols.indexOf("reflection") + 1);
  assert.equal(tail[0], "opex");
  assert.ok(tail.includes("opex_quality") && tail.includes("cf_financing_debt_draw") && tail.includes("debt_bank"));
  assert.equal(cols.indexOf("game_id"), 0);
  const mine = lines.map((l) => l.split(",")).find((c) => c[cols.indexOf("firm_id")] === f1.firm_id && c[cols.indexOf("round")] === "0")!;
  assert.equal(Number(mine[cols.indexOf("opex_quality")]), 12_345);
  assert.equal(mine.length, cols.length);
});
