/**
 * Footprint & Firm visual system (LOCKED primitive — see the design doc
 * "Footprint & Firm System"). Three INDEPENDENT channels, never conflated:
 *
 *   1. SHAPE  = role     — producer → rounded square · mixed → house · retail → circle
 *   2. GLYPH  = type     — a white mark inside the shape (six facility types)
 *   3. COLOUR = firm     — the owner's identity hue; YOUR sites carry a cream ring
 *
 * Role/shape derives from the facility type id (the engine fields production_capacity /
 * retail_draw set the economics; the id sets the read). Everything that draws a facility
 * — map pins, the info-panel footprint, the popup header, legends, the create-a-firm
 * preview — renders through these so the grammar stays identical across the app.
 */
import type { CSSProperties, ReactNode } from "react";

export type FacilityRole = "producer" | "mixed" | "retail";

/** Role ⇄ type mapping (drives shape from type). brewery_small/nano reads producer
 *  even though it has a little retail draw; brewpub is the lone mixed today. */
export const ROLE_BY_TYPE: Record<string, FacilityRole> = {
  brewery_large: "producer",
  canning_line: "producer",
  brewery_small: "producer",
  brewpub: "mixed",
  taproom: "retail",
  bottle_shop: "retail",
};

/** Resolve a type id to its role. Unknown (custom-config) types fall back to the
 *  economics: more retail draw than production ⇒ retail, else producer. */
export function roleOf(type: string, cfg?: { production_capacity?: number; retail_draw?: number; capacity_contribution?: number }): FacilityRole {
  const known = ROLE_BY_TYPE[type];
  if (known) return known;
  if (cfg) {
    const prod = cfg.production_capacity ?? cfg.capacity_contribution ?? 0;
    const retail = cfg.retail_draw ?? 0;
    if (retail > 0 && prod <= 0) return "retail";
    if (retail > prod) return "mixed";
  }
  return "producer";
}

const HOUSE_CLIP = "polygon(50% 0,100% 34%,100% 100%,0 100%,0 34%)";

/** The white glyph mark for each facility type (recolored by the pin background). */
export function glyphMark(type: string, size: number): ReactNode {
  const s = { width: size, height: size } as const;
  switch (type) {
    case "brewery_large":
      return (
        <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
          <rect x="3.4" y="9" width="4.3" height="10" rx="1.4" fill="#fff" />
          <rect x="9.85" y="6.4" width="4.3" height="12.6" rx="1.4" fill="#fff" />
          <rect x="16.3" y="10.6" width="4.3" height="8.4" rx="1.4" fill="#fff" />
          <rect x="2.6" y="19.2" width="18.8" height="1.9" rx=".9" fill="#fff" />
        </svg>
      );
    case "canning_line":
      return (
        <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
          <rect x="8" y="4.4" width="8" height="11" rx="1.4" fill="#fff" />
          <circle cx="6" cy="19" r="1.5" fill="#fff" />
          <circle cx="12" cy="19" r="1.5" fill="#fff" />
          <circle cx="18" cy="19" r="1.5" fill="#fff" />
          <rect x="3.4" y="20.8" width="17.2" height="1.3" rx=".6" fill="#fff" opacity=".75" />
        </svg>
      );
    case "brewery_small":
      return (
        <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
          <path d="M7 11h10v5.4a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V11Z" fill="#fff" />
          <rect x="5.8" y="9.3" width="12.4" height="2.1" rx="1" fill="#fff" />
          <path d="M12 3.6c1.5 1.1 1.5 2.3 0 3.4" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "brewpub":
      return (
        <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
          <rect x="8.4" y="6.2" width="7.2" height="2.4" rx="1" fill="#fff" />
          <path d="M7.5 9h9v8a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2Z" fill="#fff" />
          <path d="M16.5 10.6h1.9a2 2 0 0 1 0 4h-1.9" stroke="#fff" strokeWidth="1.6" fill="none" />
        </svg>
      );
    case "taproom":
      return (
        <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
          <rect x="5.6" y="4.4" width="6" height="2.2" rx="1" fill="#fff" />
          <path d="M8.6 6.6v2.4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M8 11h8l-1 7.6a1.5 1.5 0 0 1-1.5 1.3h-3A1.5 1.5 0 0 1 9 18.6Z" fill="#fff" />
          <ellipse cx="12" cy="11" rx="4.1" ry="1.5" fill="#fff" />
        </svg>
      );
    case "bottle_shop":
      return (
        <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
          <path d="M4 7.4 5.6 4.6h12.8L20 7.4Z" fill="#fff" />
          <path d="M5.4 7.4h13.2v1.7H5.4Z" fill="#fff" opacity=".82" />
          <path d="M11.2 10.4h1.6v1.5c0 .5.2.8.5 1.1.5.5.7 1 .7 1.7v3.9a1.4 1.4 0 0 1-1.4 1.4h-.2a1.4 1.4 0 0 1-1.4-1.4v-3.9c0-.7.2-1.2.7-1.7.3-.3.5-.6.5-1.1Z" fill="#fff" />
        </svg>
      );
    default:
      // Generic "facility" mark for any custom type id.
      return (
        <svg viewBox="0 0 24 24" {...s} aria-hidden="true">
          <rect x="5" y="8" width="14" height="11" rx="1.6" fill="#fff" />
          <rect x="8.5" y="4.5" width="7" height="4" rx="1.2" fill="#fff" />
        </svg>
      );
  }
}

/** Shape styling for a role (square / house / circle). */
export function shapeStyle(role: FacilityRole): CSSProperties {
  if (role === "mixed") return { clipPath: HOUSE_CLIP };
  if (role === "retail") return { borderRadius: "50%" };
  return { borderRadius: "28%" }; // producer — rounded square
}

/**
 * A facility footprint mark: the role shape filled with the firm colour, the type
 * glyph in white inside. `mine` adds the cream identity ring (square/circle only —
 * the house silhouette reads as itself). Used in panels, popups, legends, previews.
 */
export function FacilityChip({
  type,
  color,
  size = 28,
  mine = false,
  role,
  title,
  style,
}: {
  type: string;
  color: string;
  size?: number;
  mine?: boolean;
  role?: FacilityRole;
  title?: string;
  style?: CSSProperties;
}) {
  const r = role ?? roleOf(type);
  const isHouse = r === "mixed";
  const base: CSSProperties = {
    display: "grid",
    placeItems: "center",
    width: size,
    height: size,
    flex: "none",
    background: color,
    ...shapeStyle(r),
    ...style,
  };
  if (isHouse) {
    return (
      <span title={title} style={{ ...base, alignItems: "flex-end", paddingBottom: size * 0.13, boxSizing: "border-box", filter: "drop-shadow(0 1px 2px rgba(40,25,8,.28))" }}>
        {glyphMark(type, Math.round(size * 0.5))}
      </span>
    );
  }
  return (
    <span
      title={title}
      style={{
        ...base,
        border: mine ? "2px solid #fff4e0" : "1.5px solid rgba(0,0,0,.2)",
        boxShadow: mine ? `0 0 0 1px ${color}, inset 0 1px 0 rgba(255,255,255,.22)` : "inset 0 1px 0 rgba(255,255,255,.22)",
      }}
    >
      {glyphMark(type, Math.round(size * 0.55))}
    </span>
  );
}

/**
 * A clickable map pin: the footprint mark, anchored bottom-centre (so it "stands"
 * on its lot), with an optional directional trade badge ("↑ ships 140" / "↓ in 90"
 * / "= balanced") underneath. `opacity` dims building / mothballed sites.
 */
export function FacilityPin({
  type,
  color,
  size = 31,
  mine = false,
  badge,
  badgeTone = "neutral",
  opacity = 1,
  onClick,
  title,
}: {
  type: string;
  color: string;
  size?: number;
  mine?: boolean;
  badge?: string;
  badgeTone?: "in" | "out" | "neutral";
  opacity?: number;
  onClick?: () => void;
  title?: string;
}) {
  const badgeStyle =
    badgeTone === "out"
      ? { background: "#c0703a", color: "#fff" }
      : badgeTone === "in"
        ? { background: "#1f8c93", color: "#fff" }
        : { background: "#fcf5e7", color: "#6b513a" };
  return (
    <button
      onClick={onClick}
      title={title}
      style={{ border: "none", background: "none", padding: 0, cursor: onClick ? "pointer" : "default", opacity, display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <span style={{ filter: "drop-shadow(0 3px 6px rgba(40,25,8,.32))" }}>
        <FacilityChip type={type} color={color} size={size} mine={mine} />
      </span>
      {badge && (
        <span
          style={{
            marginTop: 3,
            ...badgeStyle,
            fontFamily: "var(--font-mono)",
            fontSize: 7.5,
            fontWeight: 700,
            padding: "1px 5px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            boxShadow: "0 1px 2px rgba(40,25,8,.25)",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

/** A role shape only (no glyph) — for legends ("brew / mix / sell"). */
export function RoleShape({ role, size = 11, color = "#9a8048" }: { role: FacilityRole; size?: number; color?: string }) {
  return <span style={{ display: "inline-block", width: size, height: size, background: color, ...shapeStyle(role) }} aria-hidden="true" />;
}

/** The directional trade badge text + tone from a facility/market flow balance.
 *  net = produced − consumed: positive ships out, negative ships in. */
export function flowBadge(net: number, eps = 5): { text: string; tone: "in" | "out" | "neutral" } {
  if (net > eps) return { text: `↑ ships ${Math.round(net)}`, tone: "out" };
  if (net < -eps) return { text: `↓ in ${Math.round(-net)}`, tone: "in" };
  return { text: "= balanced", tone: "neutral" };
}
