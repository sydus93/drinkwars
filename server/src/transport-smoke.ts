/**
 * HTTP smoke for the multiplayer transport — drives the whole loop over fetch:
 * create → join (×2) → view → submit → lock → resolve → published standings.
 * Assumes `npm run serve` is already up (PORT + DW_INSTRUCTOR_PASS via env).
 */
const PORT = process.env.PORT ?? "8787";
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
const BASE = `http://localhost:${PORT}`;

const ok = (label: string) => console.log(`  ✓ ${label}`);
function check(cond: unknown, m: string): asserts cond {
  if (!cond) throw new Error(`assertion failed: ${m}`);
}
const instr: Record<string, string> = { "content-type": "application/json", "x-instructor-pass": PASS };
const post = (path: string, body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  fetch(`${BASE}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

async function main(): Promise<void> {
  const health: any = await (await fetch(`${BASE}/health`)).json();
  check(health.ok, "health responds");
  ok(`health (adapter: ${health.adapter})`);

  check((await post("/instructor/games", {}, { "content-type": "application/json", "x-instructor-pass": "nope" })).status === 401, "bad passcode → 401");
  ok("bad instructor passcode rejected");

  const game: any = await (await post("/instructor/games", { nFirms: 4, nRounds: 2 }, instr)).json();
  check(game.gameId && game.joinCode?.length === 6, "create returns id + 6-char code");
  ok(`instructor created game (code ${game.joinCode}, 4 firms)`);

  check((await post("/join", { code: "ZZZZZZ", name: "x" })).status === 400, "bad join code → 400");
  ok("bad join code rejected");

  const a: any = await (await post("/join", { code: game.joinCode, name: "Alice Brewing" })).json();
  const b: any = await (await post("/join", { code: game.joinCode, name: "Bob's Taproom" })).json();
  check(a.token && a.firmId && a.config, "join returns token + firmId + config");
  check(a.firmId !== b.firmId, "students get distinct firms");
  ok("two students joined (distinct firms, got config)");

  const v1: any = await (await fetch(`${BASE}/view?token=${a.token}`)).json();
  check(v1.own && v1.own.id === a.firmId, "view returns own firm");
  check(v1.lifecycle === "open" && v1.round === 0, "round 0 open");
  ok("student view: own firm + open round");

  const segs = v1.segments as { id: string; active: boolean }[];
  const price: Record<string, number> = {};
  const presence: Record<string, number> = {};
  for (const s of segs) { price[s.id] = 0; presence[s.id] = 0; }
  for (const s of segs.filter((x) => x.active)) { price[s.id] = (v1.own.unit_cost || 3) * 1.8; presence[s.id] = 1; }
  const decision = {
    firm_id: a.firmId, price, presence,
    invest_cap: 0, invest_process: 0, invest_Q: 0, invest_B: 0, invest_T_emp: 0, invest_T_inv: 0, invest_T_gov: 0,
    debt_draw: 0, debt_repay: 0, equity_raise: 0, dividend: 0, buy_info: false, agreement_actions: [], exit_action: null,
  };
  check((await post("/submit", { token: a.token, decision })).status === 200, "submit accepted");
  const v1b: any = await (await fetch(`${BASE}/view?token=${a.token}`)).json();
  check(v1b.submitted === true, "view reflects the submission");
  ok("decision submitted; view reflects it");

  const lock: any = await (await post(`/instructor/games/${game.gameId}/lock`, {}, instr)).json();
  ok(`instructor locked (non-submitters: ${lock.nonSubmitters?.length ?? 0})`);
  const res: any = await (await post(`/instructor/games/${game.gameId}/resolve`, {}, instr)).json();
  check(res.round === 0, "resolved round 0");
  ok(`resolved round 0 → ${res.lifecycle} (auto-advanced)`);

  const v2: any = await (await fetch(`${BASE}/view?token=${a.token}`)).json();
  check(v2.standings.length === 4, "published standings cover all 4 firms (humans + bot-filled)");
  check(v2.round === 1, "advanced to round 1");
  ok(`student sees published standings (${v2.standings.length} firms), now round ${v2.round}`);

  console.log("\nTransport verified — create → join → submit → lock → resolve → standings works over HTTP.");
}

main().catch((e) => {
  console.error("\nTRANSPORT SMOKE FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
