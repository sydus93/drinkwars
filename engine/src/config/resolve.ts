/**
 * Browser-safe config resolution: merge an override over the baseline and
 * validate. No filesystem or YAML — those live in the Node-only loader
 * (`load.ts`). This is what the in-browser single-player prototype uses.
 */
import type { Config, ConfigOverride } from "../types.js";
import { defaultConfig } from "./defaults.js";
import { validateConfig } from "./schema.js";

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Deep merge `override` into a structural clone of `base`. Arrays replace. */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return override === undefined ? base : (override as T);
  const out: Record<string, unknown> = Array.isArray(base)
    ? ([...(base as unknown[])] as unknown as Record<string, unknown>)
    : { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override)) {
    const bv = (out as Record<string, unknown>)[k];
    if (isPlainObject(v) && isPlainObject(bv)) out[k] = deepMerge(bv, v);
    else out[k] = v;
  }
  return out as T;
}

function structuralClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Resolve a validated Config from an optional override object (baseline ⊕ override). */
export function resolveConfig(override?: ConfigOverride): Config {
  const base = structuralClone(defaultConfig);
  if (override === undefined) return validateConfig(base);
  return validateConfig(deepMerge(base, override) as Config);
}
