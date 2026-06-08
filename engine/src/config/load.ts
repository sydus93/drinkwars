/**
 * Node-only config loader (§14, application-spec §7.4). Accepts a plain object, a
 * JSON string, a YAML string, or a file path (.json/.yaml/.yml), and resolves it
 * over the baseline. Filesystem access lives here and ONLY here, so the engine's
 * main entry stays browser-safe — import this from `drinkwars-engine/node`, not
 * the package root. The pure merge/validate is in `resolve.ts`.
 */
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import YAML from "yaml";
import type { Config, ConfigOverride } from "../types.js";
import { resolveConfig } from "./resolve.js";

function parseSource(source: string): ConfigOverride {
  const trimmed = source.trim();
  const looksLikePath = !trimmed.includes("\n") && /\.(json|ya?ml)$/i.test(trimmed);
  if (looksLikePath) {
    const text = readFileSync(trimmed, "utf8");
    return extname(trimmed).toLowerCase() === ".json" ? JSON.parse(text) : YAML.parse(text);
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return YAML.parse(trimmed);
  }
}

/**
 * Load a fully-resolved, validated Config.
 *  - `loadConfig()` → the baseline.
 *  - `loadConfig(overrideObject)` → baseline ⊕ object.
 *  - `loadConfig(pathOrText)` → baseline ⊕ parsed file/string.
 */
export function loadConfig(input?: ConfigOverride | string): Config {
  if (input === undefined) return resolveConfig();
  const override = typeof input === "string" ? parseSource(input) : input;
  return resolveConfig(override);
}
