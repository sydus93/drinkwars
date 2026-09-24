/**
 * DW-062 guard — the two lists that must agree about a lever's desk.
 *
 * `DESK_LEVERS` (engine/src/engine/seats.ts) decides WHOSE VALUE WINS at merge.
 * The `className={deskCls(...)}` on each <Card> in DecisionForm.tsx decides WHO SEES the
 * control. They are hand-maintained, in different packages, and nothing compared them —
 * which is how `presence` came to render in the COO's card while the CMO owned it at merge,
 * silently reverting every split the COO dragged (DW-062).
 *
 * This is a STATIC ANALYSIS of two source files. It imports no app code, renders nothing,
 * and is not reachable from the Vite entry or the edge bundle — it cannot affect what ships.
 *
 * The invariant: a lever's OWNING desk must be able to see the card its control lives in.
 * Cards visible to non-owners are fine and deliberate (a non-owner's edit becomes a
 * suggestion) — but such a card must be declared in SHARED_CARDS, so a new one is a
 * decision someone made on purpose rather than a drift nobody noticed.
 *
 * Run: npm run -w web test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SEATS = readFileSync(join(here, "../../engine/src/engine/seats.ts"), "utf8");
const FORM = readFileSync(join(here, "../src/components/DecisionForm.tsx"), "utf8");

const DESKS = ["all", "commercial", "operations", "people", "finance", "strategy"];

/** Cards deliberately shared across desks, keyed by their <Eyebrow> text. The owner of every
 *  lever inside still has to be able to SEE the card — that part is never waived. */
const SHARED_CARDS = new Set(["Build the Brewery", "Plays & Programs"]);

/** Levers whose control this scan cannot locate inside a card — they are written through a
 *  local helper or another screen (City & Globe), so there is no `d.<lever>` / `set({ <lever>`
 *  in DecisionForm to anchor on. Listed explicitly so the guard cannot quietly decay into
 *  checking nothing: if this set stops matching reality, the test fails and someone looks. */
const NOT_IN_FORM = new Set([
  "market_presence", "market_supply",                     // City & Globe (cityActions)
  "build_facilities", "maintain_facilities", "mothball_facilities",
  "reactivate_facilities", "divest_facilities",           // City & Globe
  "hire_employees", "hire_bids", "fire_employees", "raise_employees", "poach_employees",
  "hire_roles", "fire_roles",                             // People screen / hiring market
  "public_good_contributions", "lobby_spend",
  "agreement_actions", "exit_action", "buy_vertical",
]);

// ── parse DESK_LEVERS → owner desk per lever ────────────────────────────────
const ownerOf = new Map();
{
  const body = SEATS.slice(SEATS.indexOf("export const DESK_LEVERS"));
  for (const desk of DESKS.filter((d) => d !== "all")) {
    const m = new RegExp(`\\n  ${desk}: \\[([\\s\\S]*?)\\],\\n`).exec(body);
    assert.ok(m, `could not parse DESK_LEVERS.${desk} — the guard's parser is stale, fix it before trusting a green run`);
    // strip // comments so a lever named inside prose is not mistaken for a member
    const list = m[1].replace(/\/\/[^\n]*/g, "");
    for (const f of list.matchAll(/"(\w+)"/g)) ownerOf.set(f[1], desk);
  }
}

// ── parse the <Card> tree of DecisionForm, with each card's gate expression ──
const cards = [];
{
  const balanced = (src, from) => { // read {...} starting at `from`, respecting nesting
    let depth = 0;
    for (let i = from; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return { expr: src.slice(from + 1, i), end: i };
    }
    return null;
  };
  const events = [];
  for (const m of FORM.matchAll(/<Card\b|<\/Card>/g)) events.push({ at: m.index, open: m[0] === "<Card" });
  const stack = [];
  for (const ev of events) {
    if (!ev.open) { const c = stack.pop(); if (c) c.end = ev.at; continue; }
    const cn = FORM.indexOf("className={", ev.at);
    const b = cn > -1 && cn < ev.at + 200 ? balanced(FORM, cn + "className=".length) : null;
    const card = { start: ev.at, end: FORM.length, gate: b ? b.expr.trim() : "" };
    cards.push(card); stack.push(card);
  }
  assert.equal(stack.length, 0, "unbalanced <Card> tags — parser is out of step with the file");
}

// evaluate each gate for every desk → which desks can see the card
const deskCls = (dk) => (d) => (d === "all" || d === dk ? "" : "hidden");
const INVEST_FIELDS = [...FORM.matchAll(/\{ key: "(\w+)",[\s\S]*?desk: "(\w+)" \}/g)].map((m) => ({ key: m[1], desk: m[2] }));
for (const c of cards) {
  c.visible = new Set();
  for (const d of DESKS) {
    let cls;
    try {
      cls = new Function("desk", "INVEST_FIELDS", "deskCls", `return (${c.gate || '""'})`)(d, INVEST_FIELDS, (x) => deskCls(x)(d));
    } catch (e) { assert.fail(`could not evaluate a Card gate — parser stale: ${c.gate}\n${e.message}`); }
    if (!String(cls).includes("hidden")) c.visible.add(d);
  }
  const eb = /<Eyebrow>([^<]*)<\/Eyebrow>/.exec(FORM.slice(c.start, c.end));
  c.name = eb ? eb[1].replace(/&amp;/g, "&").trim() : `card@${c.start}`;
}

const cardAt = (i) => cards.filter((c) => c.start <= i && i <= c.end).sort((a, b) => b.start - a.start)[0] ?? null;

test("guard parses both sources (a green run must mean something)", () => {
  assert.equal(ownerOf.size, 44, `expected 44 levers in DESK_LEVERS, parsed ${ownerOf.size}`);
  assert.equal(cards.length, 12, `expected 12 <Card>s in DecisionForm, parsed ${cards.length}`);
  assert.equal(INVEST_FIELDS.length, 6, `expected 6 INVEST_FIELDS, parsed ${INVEST_FIELDS.length}`);
  for (const c of cards) assert.ok(c.visible.has("all"), `card "${c.name}" is hidden even from the CEO's All view`);
});

test("Build the Brewery still gates each slider by its own desk field", () => {
  // If this wrapper ever hardcodes a desk, the INVEST_FIELDS check below stops meaning anything.
  assert.match(FORM, /<div key=\{f\.key\} className=\{deskCls\(f\.desk\)\}>/,
    "the Build the Brewery sliders no longer derive their gate from INVEST_FIELDS[].desk");
});

test("INVEST_FIELDS desks agree with DESK_LEVERS", () => {
  // Build the Brewery gates each slider by its OWN desk field — a second desk table that can
  // drift from the first exactly the way the Card gates did.
  for (const f of INVEST_FIELDS) {
    assert.equal(f.desk, ownerOf.get(f.key), `INVEST_FIELDS "${f.key}" is gated to ${f.desk} but DESK_LEVERS gives it to ${ownerOf.get(f.key)}`);
  }
});

test("every lever's owning desk can see the card its control renders in", () => {
  const located = new Set();
  const problems = new Set();
  for (const [lever, owner] of ownerOf) {
    const re = new RegExp(`(?:set\\(\\{\\s*${lever}\\b|\\bd\\.${lever}\\b|\\bd\\?\\.${lever}\\b|\\b${lever}:\\s*next\\b|key:\\s*"${lever}")`, "g");
    for (const m of FORM.matchAll(re)) {
      const c = cardAt(m.index);
      if (!c) continue;                 // a derived value above the JSX, not a control
      located.add(lever);
      if (!c.visible.has(owner)) {
        problems.add(`${lever} is owned by ${owner} but its control lives in "${c.name}", visible only to ${[...c.visible].join("/")}`);
      } else if (c.visible.size > 2 && !SHARED_CARDS.has(c.name)) {
        problems.add(`${lever} renders in "${c.name}", which is visible to ${[...c.visible].join("/")} but is not declared in SHARED_CARDS`);
      }
    }
  }
  assert.deepEqual([...problems], [], `\n  ${[...problems].join("\n  ")}\n`);

  // the six Build the Brewery sliders render from INVEST_FIELDS.map, so there is no
  // `d.<lever>` to anchor on — they are covered by the two INVEST_FIELDS tests above.
  for (const f of INVEST_FIELDS) located.add(f.key);

  // the scan must still be finding what it used to find
  const missing = [...ownerOf.keys()].filter((l) => !located.has(l) && !NOT_IN_FORM.has(l));
  assert.deepEqual(missing, [], `these levers used to be checked and are no longer locatable in DecisionForm — the scan lost coverage: ${missing.join(", ")}`);
  const stale = [...NOT_IN_FORM].filter((l) => located.has(l));
  assert.deepEqual(stale, [], `NOT_IN_FORM lists levers the scan CAN now find — drop them from the list so they get checked: ${stale.join(", ")}`);
});
