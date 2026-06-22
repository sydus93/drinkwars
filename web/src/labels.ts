/** Beverage vocabulary for the UI (presentation layer only — engine keys stay generic). */
export const SEG_LABEL: Record<string, string> = {
  mass: "Lagers & Light",
  niche: "Craft Premium",
  frontier: "Non-Alc / Functional",
};
export const SEG_TAG: Record<string, string> = { mass: "Mass", niche: "Niche", frontier: "New category" };

/** District character for the market map — plain-language "what wins here," so a
 *  player reads the landscape without seeing engine sensitivity coefficients. */
export const SEG_CHARACTER: Record<string, { tagline: string; rewards: string; hue: string }> = {
  mass: {
    tagline: "High-volume, price-led. Thin margins, big tanks.",
    rewards: "Shoppers here chase price. Win on cost and scale, not polish.",
    hue: "var(--color-copper)",
  },
  niche: {
    tagline: "Premium craft. Quality and brand command the markup.",
    rewards: "Drinkers pay up for quality and a brand they trust. Execution matters.",
    hue: "var(--color-hop)",
  },
  frontier: {
    tagline: "The new category. First movers set the terms.",
    rewards: "An emerging non-alc / functional scene — early quality builds the lead.",
    hue: "var(--color-aero)",
  },
};

/** Friendly names for the labor-market roles (MOD-B03) and vertical assets (MOD-B06)
 *  a firm can own. Fallback title-cases any id not listed. Presentation only. */
export const ROLE_LABEL: Record<string, string> = {
  head_brewer: "Head Brewer",
  sales_director: "Sales Director",
  ops_manager: "Operations Manager",
  taproom_manager: "Taproom Manager",
  finance_lead: "Finance Lead",
  brand_manager: "Brand Manager",
  sustainability_lead: "Sustainability Lead",
};
export const ASSET_LABEL: Record<string, string> = {
  hop_supplier: "Hop & Grain Supplier",
  distributor: "Regional Distributor",
};
export const humanizeId = (id: string): string => id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** District character for the city map — a one-line "what to build here," so the
 *  siting tradeoff reads at a glance (exact rent/capacity/brand numbers come from
 *  config). Falls back to the district blurb for any id not listed. */
export const DISTRICT_BEST: Record<string, string> = {
  downtown: "Best for a taproom — visibility & foot traffic",
  riverside: "Balanced — a steady brand draw",
  southside: "Best for production — cheapest, most output",
  suburbs: "Roomy & affordable — a little extra output, quiet trade",
};

/** Map/feed metadata for each shock type (presentation only — engine ids stay generic). */
export const SHOCK_META: Record<string, { label: string; icon: string; note: string }> = {
  water: { label: "Water shortage", icon: "💧", note: "drives up input costs" },
  harvest: { label: "Harvest failure", icon: "🌾", note: "drives up input costs" },
  co2: { label: "CO₂ & packaging squeeze", icon: "📦", note: "constrains capacity" },
};

export const STOCK_LABEL = {
  Q: "Recipe quality",
  B: "Brand",
  T_emp: "Taproom community",
  T_inv: "Investors & lenders",
  T_gov: "Distributors & regulators",
  process: "Brewing operations",
  cap: "Tank capacity",
} as const;

const money0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  money: (n: number) => `$${money0.format(Math.round(n))}`,
  price: (n: number) => `$${money1.format(n)}`,
  int: (n: number) => money0.format(Math.round(n)),
  pct: (n: number) => `${(n * 100).toFixed(0)}%`,
  pct1: (n: number) => `${(n * 100).toFixed(1)}%`,
  num: (n: number, d = 1) => n.toFixed(d),
  signed: (n: number) => (n >= 0 ? `+${money0.format(Math.round(n))}` : `-$${money0.format(Math.abs(Math.round(n)))}`),
};
