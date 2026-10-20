/**
 * DW-068 phase 2 — the debrief has two implementations of one rule set: the canonical
 * `src/debrief.ts` (live Debrief tab) and `scripts/teach-brief.py` `analyze()` (offline export →
 * brief / deck). This runs BOTH on the same fixture payloads, every resolved round, and compares
 * the WHOLE result: every sentence exactly, every number to a relative 1e-9. A rule changed in
 * one and not the other fails here.
 *
 * Fixtures (test/fixtures/debrief-fixture.ts): one scripted in-memory game — current payload and
 * the same game as a pre-DW-067 payload (no q_desired / pull) — covering a shock round, a forced
 * exit, price cuts into full tanks, idle builds, fading quality, wrong rank calls.
 * Skipped (not failed) when python3 is not installed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDebrief, debriefDeck, debriefRounds, type Debrief } from "../src/debrief.js";
import type { InstructorDashboard } from "../src/dashboard.js";
import { asPre067, buildDebriefFixture } from "./fixtures/debrief-fixture.js";

const here = dirname(fileURLToPath(import.meta.url));
const PY = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("teach_brief", sys.argv[1])
tb = importlib.util.module_from_spec(spec); spec.loader.exec_module(tb)
j = json.load(open(sys.argv[2]))
rounds = sorted({p["round"] for p in j["panel"]})
json.dump({str(r): tb.analyze(j, r) for r in rounds}, sys.stdout, ensure_ascii=False, allow_nan=False)
`;
const hasPython = spawnSync("python3", ["--version"]).status === 0;

function pythonAnalyze(payload: InstructorDashboard): Record<string, unknown> {
  const file = join(mkdtempSync(join(tmpdir(), "dw-debrief-")), "export.json");
  writeFileSync(file, JSON.stringify(payload));
  const out = spawnSync("python3", ["-c", PY, join(here, "../scripts/teach-brief.py"), file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(out.status, 0, `teach-brief.py failed:\n${out.stderr}`);
  return JSON.parse(out.stdout);
}

/** Deep compare: strings / booleans / null exact, numbers to rel 1e-9, same keys, same order of arrays. */
function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (out.length > 12) return;
  if (typeof a === "number" && typeof b === "number") {
    if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) out.push(`${path}: ts ${a} ≠ py ${b}`);
  } else if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ts ${a.length} ≠ py ${b.length}\n   ts ${JSON.stringify(a).slice(0, 300)}\n   py ${JSON.stringify(b).slice(0, 300)}`);
    else a.forEach((x, i) => diff(x, b[i], `${path}[${i}]`, out));
  } else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
    if (ka.join() !== kb.join()) out.push(`${path}: keys ts [${ka}] ≠ py [${kb}]`);
    else for (const key of ka) diff((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, out);
  } else if (a !== b) {
    out.push(`${path}: ts ${JSON.stringify(a)} ≠ py ${JSON.stringify(b)}`);
  }
}

let fixture: Promise<InstructorDashboard> | null = null;
const game = () => (fixture ??= buildDebriefFixture());

function parity(payload: InstructorDashboard, tag: string): Debrief[] {
  const py = pythonAnalyze(payload);
  const all: Debrief[] = [];
  for (const r of debriefRounds(payload)) {
    const ts = JSON.parse(JSON.stringify(analyzeDebrief(payload, r))); // through JSON: undefined keys drop, as in the browser
    const problems: string[] = [];
    diff(ts, py[String(r)], `${tag} r${r}`, problems);
    assert.deepEqual(problems, [], `TS and Python debrief disagree:\n${problems.join("\n")}`);
    all.push(ts);
  }
  return all;
}

test("debrief parity: current payload, every round — TS and teach-brief.py say the same thing", { skip: !hasPython && "python3 not installed" }, async () => {
  const all = parity(await game(), "current");
  // The fixture must actually exercise the rules, or parity proves nothing.
  assert.ok(all.every((b) => b.rich), "current payload carries q_desired + pull");
  const kinds = new Set(all.flatMap((b) => b.moves.map((m) => m.kind)));
  assert.deepEqual([...kinds].sort(), ["cut", "raise", "stock", "tanks"], "every kind of move appears");
  assert.ok(all.some((b) => b.exits.length), "a firm is forced out in some round");
  assert.ok(all.some((b) => b.events.some((e) => /SHOCK|water/i.test(e))), "the planted shock shows in the events feed");
  assert.ok(all.some((b) => b.trouble.some((t) => t.acquirable)), "a firm stays under the safety line long enough to be bought");
  assert.ok(all.some((b) => b.pull?.pair), "a pull pair is found");
  const chairs = new Set(all.flatMap((b) => b.focus.flatMap((f) => f.prompts.map((p) => p.chair))));
  for (const c of ["COO", "CMO", "CFO", "CEO"]) assert.ok(chairs.has(c as never), `a focus prompt is routed to the ${c}`);
  assert.ok(all.every((b) => b.focus.every((f) => f.prompts.length <= 3)), "at most three prompts per firm");
  assert.ok(all.every((b) => b.ask.length <= 3 && new Set(b.ask.map((a) => a.lesson)).size === b.ask.length), "≤3 questions, no lesson twice");
});

test("debrief parity: pre-DW-067 payload (no q_desired / pull), every round", { skip: !hasPython && "python3 not installed" }, async () => {
  const all = parity(asPre067(await game()), "pre067");
  assert.ok(all.every((b) => !b.rich && b.pull === null), "old payloads skip WHY SHOPPERS CHOSE");
});

test("debrief parity: people module off + a payload missing the newer optional fields", { skip: !hasPython && "python3 not installed" }, async () => {
  const d = await buildDebriefFixture({ modules: [] });
  for (const p of d.panel) { delete (p as Partial<typeof p>).roundsBelowSafety; delete (p as Partial<typeof p>).cashSafetyThreshold; }
  parity(d, "bare");
});

test("the projectable deck carries nothing team-private; NPCs get no focus page", async () => {
  const d = await game();
  for (const r of debriefRounds(d)) {
    const b = analyzeDebrief(d, r);
    assert.ok(!("focus" in debriefDeck(b)), "deck has no focus pages");
    assert.ok(b.focus.every((f) => !/^NPC/.test(f.name)), "no page for an NPC");
  }
  assert.equal(analyzeDebrief(d).round, Math.max(...debriefRounds(d)), "defaults to the latest resolved round");
  assert.throws(() => analyzeDebrief(d, 99), /not in this export/);
});

test("number formatting matches Python on exact ties (half-to-even), commas and signs", async () => {
  const { debriefFmt: f } = await import("../src/debrief.js");
  assert.equal(f.k(12_500), "12k"); // Python f"{12.5:,.0f}" == "12" — JS toFixed alone says 13
  assert.equal(f.k(13_500), "14k");
  assert.equal(f.k(1_250), "1.2k"); // 1.25 is an exact tie at one decimal → even
  assert.equal(f.k(999.5), "1,000");
  assert.equal(f.usd(-1_234_567), "−$1,235k");
  assert.equal(f.usd(2_500.5), "$2,500");
  assert.equal(f.money(-9_999), "−$9,999");
  assert.equal(f.pct(0.125), "12%");
  assert.equal(f.fx(0.125, 2), "0.12");
  assert.equal(f.fx(2.675, 2), "2.67"); // not a tie in binary: both languages round the true value
  assert.equal(f.fx(-0.4, 0), "-0");
});
