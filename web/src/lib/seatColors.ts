/**
 * DW-077 seat identity (design/round-ux-2026-10 §B) — the colour, label and desk words for a
 * C-suite seat. The hex values live in web/src/index.css (`--seat-*`, light + dark); this file
 * only hands out the CSS variables so every surface (plate, page edge, desk card, takeover tag,
 * commit panel) reads the same token. Pure, no React.
 */
import { ROLE_DESK } from "drinkwars-engine";

export type SeatRole = "ceo" | "cfo" | "coo" | "cmo" | "chro";
export const SEAT_ROLES: readonly SeatRole[] = ["ceo", "cfo", "coo", "cmo", "chro"] as const;

const isSeat = (r: string | null | undefined): r is SeatRole => !!r && (SEAT_ROLES as readonly string[]).includes(r);

/** The seat's colour as a CSS var — `var(--seat-cfo)`. Unknown/solo → the muted ink. */
export const seatColor = (role: string | null | undefined): string => (isSeat(role) ? `var(--seat-${role})` : "var(--color-inksoft)");
/** Text colour ON a seat-coloured block (dark ink in dark mode, cream in light). */
export const SEAT_INK = "var(--seat-ink)";
/** The tinted plate background: the seat hue at very low chroma over the panel. */
export const seatTint = (role: string | null | undefined, pct = 12): string => `color-mix(in srgb, ${seatColor(role)} ${pct}%, var(--color-panel))`;

export const seatLabel = (role: string | null | undefined): string => (isSeat(role) ? role.toUpperCase() : "YOU");

/** "Finance desk" / "Whole-firm desk" — the long desk name under the student's name. */
const DESK_LONG: Record<string, string> = { commercial: "Marketing desk", operations: "Operations desk", people: "People desk", finance: "Finance desk", strategy: "Strategy desk", all: "Whole-firm desk" };
/** "FINANCE" / "WHOLE FIRM" — the short label on the mobile seat bar. */
const DESK_SHORT: Record<string, string> = { commercial: "Marketing", operations: "Operations", people: "People", finance: "Finance", strategy: "Strategy", all: "Whole firm" };

export const seatDesk = (role: string | null | undefined): string => (role ? ROLE_DESK[role] ?? "all" : "all");
export const seatDeskLong = (role: string | null | undefined): string => DESK_LONG[seatDesk(role)] ?? "Your desk";
export const seatDeskShort = (role: string | null | undefined): string => DESK_SHORT[seatDesk(role)] ?? "Your desk";
