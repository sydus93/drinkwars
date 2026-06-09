/**
 * Drink Wars category icons (Tap House Tycoon) — bold, single-color via
 * currentColor so they recolor per theme. CategoryCoin wraps one in a metal coin.
 */
import type { SegmentId } from "drinkwars-engine";

export function IconLager({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9h8v9.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 6 18.5V9Z" fill="currentColor" opacity="0.92" />
      <path d="M14 11h2.2A1.8 1.8 0 0 1 18 12.8v2.4A1.8 1.8 0 0 1 16.2 17H14" stroke="currentColor" strokeWidth="1.7" fill="none" />
      <path d="M6.2 9c-.4-2 1-3.3 2.6-3.1.2-1.4 1.7-2.1 3-1.4.9-1.2 3-1 3.4.6 1.7-.2 2.6 1.3 1.8 2.8" fill="currentColor" />
      <rect x="7.6" y="11" width="1.4" height="6" rx="0.7" fill="#fff" opacity="0.35" />
    </svg>
  );
}

export function IconCraft({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3c.5 1.2.4 2.2-.2 3 1.3-.3 2.3 0 3 .9-1 .4-1.6 1-1.9 1.9 1.3-.1 2.2.4 2.7 1.4-1 .2-1.7.7-2.1 1.6 1.2.1 2 .8 2.2 1.9-1.6.5-3.1.2-4.4-.7-1.4 1-3 1.3-4.6.7.3-1.1 1-1.8 2.2-1.9-.4-.9-1.1-1.4-2.1-1.6.5-1 1.4-1.5 2.7-1.4-.3-.9-.9-1.5-1.9-1.9.7-.9 1.7-1.2 3-.9-.6-.8-.7-1.8-.2-3Z" fill="currentColor" />
      <path d="M12 8v10" stroke="#fff" strokeWidth="1.3" opacity="0.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconNonAlc({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="7.5" y="6" width="9" height="15" rx="2.4" fill="currentColor" />
      <rect x="9" y="4.6" width="6" height="2.2" rx="1" fill="currentColor" />
      <circle cx="12" cy="12.5" r="1.5" fill="#fff" opacity="0.55" />
      <circle cx="10.4" cy="16" r="0.9" fill="#fff" opacity="0.4" />
      <circle cx="13.6" cy="17" r="0.7" fill="#fff" opacity="0.35" />
      <path d="M19 5l.5 1.4L21 7l-1.5.6L19 9l-.6-1.4L17 7l1.4-.6L19 5Z" fill="currentColor" />
    </svg>
  );
}

/** A category icon framed in a metal coin, colored by segment. */
export function CategoryCoin({ seg, size = 34 }: { seg: SegmentId; size?: number }) {
  const inner = Math.round(size * 0.62);
  const color = seg === "niche" ? "var(--color-hop)" : seg === "frontier" ? "var(--color-aero)" : "var(--color-copper)";
  return (
    <span className="tt-coin shrink-0" style={{ width: size, height: size, color }}>
      {seg === "niche" ? <IconCraft size={inner} /> : seg === "frontier" ? <IconNonAlc size={inner} /> : <IconLager size={inner} />}
    </span>
  );
}
