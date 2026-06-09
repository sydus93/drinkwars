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
