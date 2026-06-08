/**
 * Node-only entry (`drinkwars-engine/node`). Re-exports everything from the
 * browser-safe main entry, plus the filesystem/YAML config loader. Node consumers
 * (harness, instructor config-file loading) import from here; browser code imports
 * from the package root, which never pulls in `node:fs`.
 */
export * from "./index.js";
export { loadConfig } from "./config/load.js";
