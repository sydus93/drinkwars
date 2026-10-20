// DW-076: `MODULES=` for the browser audits — a preset id from engine PRESETS ("full", "global", …) or a
// comma list of module ids ("geography,facilities,employees"). Unset ⇒ each script's own default set,
// so existing runs are unchanged. These scripts run under plain `node` (no tsx), so the preset library
// is read out of engine/src/config/modules.ts by text rather than imported: literal `modules: [...]`
// for every preset, and the registry's ids for the computed "full" preset. If that parse ever fails
// the id is reported, not guessed.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../engine/src/config/modules.ts");

/** The preset library as { id: [moduleId, …] }, parsed from the engine source. */
export function presets() {
  const text = readFileSync(SRC, "utf8");
  const out = {};
  const block = text.slice(text.indexOf("export const PRESETS"));
  for (const m of block.matchAll(/\{\s*id:\s*"([\w-]+)"[^\n]*?modules:\s*\[([^\]]*)\]/g)) out[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  // "full" = every registry module except asymmetricStarts (see PRESETS in modules.ts).
  const regStart = text.indexOf("export const MODULE_REGISTRY");
  const regEnd = text.indexOf("\nexport ", regStart + 1); // the registry runs to the next top-level export
  const reg = text.slice(regStart, regEnd > 0 ? regEnd : undefined);
  const ids = [...reg.matchAll(/^\s*id:\s*"(\w+)"/gm)].map((x) => x[1]);
  if (ids.length) out.full = ids.filter((id) => id !== "asymmetricStarts");
  return out;
}

/** Module id → the name the instructor form shows (MODULE_REGISTRY `name`), for UI-driven set-up. */
export function moduleNames() {
  const text = readFileSync(SRC, "utf8");
  const out = {};
  for (const m of text.matchAll(/^\s*id:\s*"(\w+)",\s*code:[^\n]*?name:\s*"([^"]+)"/gm)) out[m[1]] = m[2];
  return out;
}

/** Module ids for this run: MODULES env (preset id | comma list) or the script's default list. */
export function moduleIds(defaults) {
  const want = (process.env.MODULES ?? "").trim();
  if (!want) return defaults;
  if (want.includes(",") || !/^[\w-]+$/.test(want)) return want.split(",").map((s) => s.trim()).filter(Boolean);
  const lib = presets();
  if (lib[want]) return lib[want];
  // a single bare module id is a one-item list; anything else is a typo worth stopping on
  if (/^[a-z][A-Za-z]+$/.test(want)) return [want];
  throw new Error(`MODULES="${want}": not a preset (${Object.keys(lib).join(", ")}) and not a module list`);
}

/** The `modules` block the create endpoint takes: { id: { enabled: true } }. */
export const modulesBlock = (ids) => Object.fromEntries(ids.map((id) => [id, { enabled: true }]));
export const describeModules = (ids) => (ids.length ? ids.join(", ") : "(strategy core only)");
