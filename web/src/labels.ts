/** Beverage vocabulary for the UI (presentation layer only — engine keys stay generic). */
export const SEG_LABEL: Record<string, string> = {
  mass: "Lagers & Light",
  niche: "Craft Premium",
  frontier: "Non-Alc / Functional",
};
export const SEG_TAG: Record<string, string> = { mass: "Mass", niche: "Niche", frontier: "New category" };

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
