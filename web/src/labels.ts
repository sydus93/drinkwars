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

/** City/market presentation for the City View — a fictional city name, region, globe
 *  coordinates [lon, lat], coastline (for the procedural map), and a stable layout seed.
 *  Keyed by the engine market id; falls back to the engine label for any unlisted id. */
export const MARKET_META: Record<string, { city: string; region: string; geo: [number, number]; coast: "right" | "bottom" | null; seed: number }> = {
  home: { city: "Front Range", region: "Mountain West", geo: [-105.3, 39.7], coast: null, seed: 7 },
  heartland: { city: "Cedar Falls", region: "Upper Midwest", geo: [-92.5, 41.6], coast: null, seed: 21 },
  coastal: { city: "Harbor City", region: "Eastern Seaboard", geo: [-74.0, 40.6], coast: "right", seed: 39 },
  export_eu: { city: "London", region: "Northwest Europe", geo: [-0.1, 51.5], coast: "right", seed: 88 },
  export_asia: { city: "Shanghai", region: "East Asia", geo: [121.5, 31.2], coast: "right", seed: 103 },
};

/** Zoning per district kind — which facility types its land use permits (City View siting
 *  guidance). Reinforces each district's economics: production breweries belong in the
 *  industrial yards, taprooms on commercial/retail streets. */
export const ZONE_OF: Record<string, { zone: string; allow: string[] }> = {
  downtown: { zone: "Commercial", allow: ["taproom", "canning_line"] },
  riverside: { zone: "Mixed-use", allow: ["taproom", "brewery_small", "canning_line"] },
  industrial: { zone: "Industrial", allow: ["brewery_large", "brewery_small", "canning_line"] },
  suburban: { zone: "Residential", allow: ["brewery_small", "taproom", "canning_line"] },
};
export const ZONE_TONE: Record<string, string> = {
  Commercial: "var(--color-copper)",
  Industrial: "var(--color-plum)",
  Residential: "var(--color-hop)",
  "Mixed-use": "var(--color-gold)",
  Waterfront: "var(--color-aero)",
};

/** Single-letter tags + a one-line role note for each facility type (City View pins/cards). */
export const FAC_TAG: Record<string, string> = { brewery_small: "n", brewery_large: "B", taproom: "T", canning_line: "C" };
export const FAC_NOTE: Record<string, string> = {
  brewery_small: "A small, flexible base of output — a cheap first footprint.",
  brewery_large: "Heavy output for the cost-and-scale game. Wants cheap industrial land.",
  taproom: "Little output, but a brand magnet — best where foot traffic runs high.",
  canning_line: "Solid packaged output that travels — fits most districts.",
};
