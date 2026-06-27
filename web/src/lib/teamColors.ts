/** Stable identity color per team, by index — so a team keeps one color across
 *  every chart, legend, and table on the instructor dashboard. Cycles if there are
 *  more teams than colors (8 distinct hues from the Tap House palette). */
export const TEAM_COLORS = [
  "var(--color-copper)",
  "var(--color-hop)",
  "var(--color-aero)",
  "var(--color-gold)",
  "var(--color-plum)",
  "var(--color-clay)",
  "var(--color-brick)",
  "var(--color-copperdeep)",
] as const;

export const teamColor = (i: number): string => TEAM_COLORS[((i % TEAM_COLORS.length) + TEAM_COLORS.length) % TEAM_COLORS.length];

/** Stable identity color for a firm by its id ("firm_1", "firm_2", …). The human
 *  is firm_1 → copper (the brand primary), so "your" color matches the self-accent
 *  used elsewhere; rivals spread across the rest of the palette. One color per firm,
 *  everywhere it appears — map pin, standings dot, dossier. */
/** The player can choose their own brewery color in the firm builder. Solo runs one
 *  game at a time, so a module-level override for the human (firm_1) is enough — it
 *  threads everywhere firmColor() is already called without refactoring every caller.
 *  (Multiplayer assigns by id; the builder override only applies to single-player.) */
let playerColorOverride: string | null = null;
export const setPlayerColor = (c: string | null): void => { playerColorOverride = c; };

/** Firm-builder palette (curated to sit alongside the Tap House tokens). */
export const FIRM_PALETTE = [
  "var(--color-copper)", "var(--color-hop)", "var(--color-aero)",
  "var(--color-gold)", "var(--color-plum)", "var(--color-brick)",
] as const;

/** The eight named house colours offered in Create-a-Firm (design palette). Stored
 *  as hex so setPlayerColor threads the choice straight through firmColor(). */
export const FIRM_COLORS = [
  { id: "copper", name: "Copper", hex: "#c0703a" },
  { id: "plum", name: "Plum", hex: "#7c4f86" },
  { id: "forest", name: "Forest", hex: "#5a8a2a" },
  { id: "teal", name: "Teal", hex: "#1f8c93" },
  { id: "gold", name: "Gold", hex: "#d99b2b" },
  { id: "brick", name: "Brick", hex: "#b0533f" },
  { id: "indigo", name: "Indigo", hex: "#4f5a9a" },
  { id: "slate", name: "Slate", hex: "#5a6b72" },
] as const;

/** The player's chosen house mark (emblem id), set in the firm builder; null = none.
 *  Mirrors setPlayerColor so the badge threads everywhere without prop drilling. */
let playerEmblemOverride: string | null = null;
export const setPlayerEmblem = (e: string | null): void => { playerEmblemOverride = e; };
export const playerEmblem = (): string | null => playerEmblemOverride;

export const firmColor = (firmId: string): string => {
  if (playerColorOverride && firmId === "firm_1") return playerColorOverride;
  const n = parseInt(String(firmId).replace(/^\D+/, ""), 10);
  return teamColor(Number.isFinite(n) ? n - 1 : 0);
};
