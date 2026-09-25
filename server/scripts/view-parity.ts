/**
 * /view behaviour-parity capture (DW-064).
 *
 * `viewFor` is the hottest endpoint in the game and it is about to be restructured for
 * latency. A refactor of a read path is only safe if you can show the bytes did not move,
 * so this drives a FIXED-SEED game to a resolved round and dumps the complete /view payload
 * for every seat, normalised so two runs are comparable:
 *
 *   npx tsx scripts/view-parity.ts before.json     # on the old code
 *   npx tsx scripts/view-parity.ts after.json      # on the new code
 *   diff before.json after.json                    # must be empty
 *
 * Normalisation replaces UUIDs with stable `<id:N>` tokens in first-appearance order and
 * blanks the genuinely volatile fields (clock stamps, join/claim codes, tokens). Everything
 * else — every projection, every number the engine produced — is compared verbatim.
 *
 * Runs against a LOCAL memory transport (BASE overrides). Nothing here touches prod.
 */
const BASE = process.env.BASE ?? "http://localhost:8787";
const PASS = process.env.DW_INSTRUCTOR_PASS ?? "letmein";
const OUT = process.argv[2] ?? "view-parity.json";
const SEED = Number(process.env.SEED ?? 12345);
const FIRMS = Number(process.env.FIRMS ?? 4);

const ih = { "content-type": "application/json", "x-instructor-pass": PASS };
const post = async (p: string, body?: unknown, instructor = false) =>
  (await fetch(BASE + p, { method: "POST", headers: instructor ? ih : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })).json();
const get = async (p: string) => (await fetch(BASE + p)).json();

const CHAIRS = ["ceo", "cfo", "cmo", "coo", "chro"] as const;

// ── normalisation ────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fields whose value is a clock reading or a random credential — never engine output. */
const VOLATILE = new Set(["created_at", "updated_at", "submitted_at", "deadline_at", "stamp", "claim_code", "claim", "join_code", "joinCode", "token", "now", "seed_hint", "createdAt", "updatedAt"]);
function normalise(v: unknown, ids: Map<string, string>): unknown {
  if (Array.isArray(v)) return v.map((x) => normalise(x, ids));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = VOLATILE.has(k) ? `<volatile:${k}>` : normalise((v as Record<string, unknown>)[k], ids);
    }
    return out;
  }
  if (typeof v === "string") {
    if (UUID.test(v)) { if (!ids.has(v)) ids.set(v, `<id:${ids.size}>`); return ids.get(v); }
    // ids also appear embedded in text (briefings, event copy)
    return v.replace(new RegExp([...ids.keys()].map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "\\u0000", "g"), (m) => ids.get(m)!);
  }
  return v;
}

async function main() {
  const game = await post("/instructor/games", {
    nFirms: FIRMS, nRounds: 8, firmMode: "team",
    modules: { inventory: { enabled: true }, laborMarket: { enabled: true }, sustainability: { enabled: true }, geography: { enabled: true }, teamRoles: { enabled: true } },
    configOverride: { game: { seed: SEED } }, // pinned — the whole point
    title: "VIEW PARITY",
  }, true);
  if (!game?.gameId) throw new Error(`create failed: ${JSON.stringify(game).slice(0, 200)}`);

  const students = [];
  let n = 0;
  for (let f = 1; f <= FIRMS; f++) for (const chair of CHAIRS) { n++; students.push({ ext: `vp${String(n).padStart(2, "0")}`, name: `Parity ${n}`, firm: f, chair }); }
  const roster: any = await post("/instructor/roster", { cohort: "parity", roster: students.map((s) => ({ external_id: s.ext, name: s.name })) }, true);
  for (const s of students as any[]) s.claim = roster.students.find((r: any) => r.external_id === s.ext)?.claim_code ?? roster.students.find((r: any) => r.external_id === s.ext)?.claim;
  await post(`/instructor/games/${game.gameId}/seats`, { plan: students.map((s: any) => ({ external_id: s.ext, team: `Group ${s.firm}`, role: s.chair })) }, true);

  for (const s of students as any[]) s.token = (await post("/join", { code: game.joinCode, claim: s.claim }))?.token;

  // Deterministic slices so the resolved world is identical run to run.
  const segs = ((await get(`/view?token=${(students as any[])[0].token}`))?.segments ?? []).filter((x: any) => x.active).map((x: any) => x.id);
  for (const s of students as any[]) {
    const d: Record<string, unknown> = {};
    if (s.chair === "cmo") { d.price = Object.fromEntries(segs.map((g: string, i: number) => [g, 7 + i])); d.invest_B = 4000; d.buy_info = s.firm === 1; }
    if (s.chair === "coo") { d.presence = Object.fromEntries(segs.map((g: string, i: number) => [g, i === 0 ? 3 : 1])); d.invest_cap = 6000; }
    if (s.chair === "cfo") { d.invest_T_inv = 5000; d.dividend = 1000; }
    if (s.chair === "chro") { d.invest_T_emp = 3000; }
    if (s.chair === "ceo") { d.invest_T_gov = 1000; }
    await post("/submit", { token: s.token, decision: d });
  }
  await post(`/instructor/games/${game.gameId}/lock`, {}, true);
  await post(`/instructor/games/${game.gameId}/resolve`, {}, true);

  // The payload under test: every seat's complete view, after a real resolve.
  const ids = new Map<string, string>();
  const dump: Record<string, unknown> = {};
  for (const s of students as any[]) dump[`${s.firm}:${s.chair}`] = normalise(await get(`/view?token=${s.token}`), ids);
  // DW-065: the instructor console's status + roster payloads ride the same read path.
  const ih2 = { "x-instructor-pass": PASS };
  dump["instructor:status"] = normalise(await (await fetch(`${BASE}/instructor/games/${game.gameId}/status`, { headers: ih2 })).json(), ids);
  dump["instructor:roster"] = normalise(await (await fetch(`${BASE}/instructor/games/${game.gameId}/roster`, { headers: ih2 })).json(), ids);
  await post(`/instructor/games/${game.gameId}/end`, {}, true);

  const { writeFileSync } = await import("node:fs");
  writeFileSync(OUT, JSON.stringify(dump, null, 1));
  console.log(`wrote ${OUT} — ${students.length} seats, ${Object.keys(dump).length} views, ${ids.size} ids normalised`);
}
main().catch((e) => { console.error("PARITY CAPTURE FAILED:", e.message); process.exit(1); });
