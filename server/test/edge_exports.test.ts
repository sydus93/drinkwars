/**
 * The Edge Function imports its game logic from ./drinkwars-core.js, which esbuild bundles from
 * src/edge-core.ts — a SEPARATE entry from src/index.ts. A name the function imports but the
 * entry doesn't re-export makes Deno fail to link the module, and the whole function answers
 * BOOT_ERROR. That has now happened twice (withRequestCache 2026-08-24; visibleEvents in the
 * DW-071c deploy, 2026-10-01). This guard reads both source files and fails before a deploy can.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

test("every name the Edge Function imports from drinkwars-core.js is re-exported by edge-core.ts", () => {
  const fn = read("../supabase/functions/drinkwars/index.ts");
  const m = fn.match(/import\s*\{([^}]*)\}\s*from\s*"\.\/drinkwars-core\.js"/);
  assert.ok(m, "could not find the drinkwars-core.js import in the Edge Function — the guard's parser is stale");
  const wanted = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean);

  const entry = read("../src/edge-core.ts").replace(/\/\/[^\n]*/g, "");
  const exported = new Set<string>();
  for (const e of entry.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const n of e[1].split(",")) {
      const name = n.trim().split(/\s+as\s+/).pop();
      if (name) exported.add(name);
    }
  }
  assert.ok(exported.size > 10, `parsed only ${exported.size} exports from edge-core.ts — the guard's parser is stale`);
  const missing = wanted.filter((w) => !exported.has(w));
  assert.deepEqual(missing, [], `the Edge Function imports names edge-core.ts never exports (deploy would BOOT_ERROR): ${missing.join(", ")}`);
});
