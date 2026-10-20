import type { MarketConfig } from "drinkwars-engine";
import { fmt, marketName } from "../labels.js";
import { WORLD_LAND_PATH } from "./worldland.js";

export interface MarketPerf {
  revenue: number;
  q_sold: number;
  entered: boolean;
}

/** Where each market sits on Earth ([lon, lat]). The brewery's home is the
 *  Mountain West; unknown custom market ids fall back to spare anchors. */
const MARKET_GEO: Record<string, [number, number]> = {
  home: [-105.3, 39.7], // Front Range
  heartland: [-92.5, 41.6], // upper Midwest
  coastal: [-74.0, 40.5], // Eastern seaboard
  export_eu: [4.4, 50.9], // northwest Europe
  export_asia: [121.5, 31.2], // East Asia
};
const SPARE_ANCHORS: [number, number][] = [[-122.3, 37.8], [-46.6, -23.5], [18.4, -33.9], [151.2, -33.9], [77.2, 28.6]];

const project = ([lon, lat]: [number, number]): [number, number] => [lon + 180, 90 - lat];

/**
 * A real-geography market map. The land silhouette is the actual world; the
 * viewBox auto-crops to the markets in play (a domestic-only game reads as a
 * map of the United States; turn on international and the world opens up).
 * Node size scales with this firm's presence (allocation weight in the decision
 * view, revenue share in the results view); dashed means open to enter; export
 * routes arc across the ocean from home.
 */
export function WorldMap({
  markets,
  weights,
  breakdown,
  entered = ["home"],
}: {
  markets: MarketConfig[];
  weights?: Record<string, number>; // decision view: capacity-allocation weights
  breakdown?: Record<string, MarketPerf> | null; // results view: per-market performance
  entered?: string[];
}) {
  const home = markets.find((m) => m.kind === "home") ?? markets[0];

  // Pin positions (projected). Unknown ids take spare anchors so a custom
  // market config still renders somewhere sensible.
  let spare = 0;
  const pos: Record<string, [number, number]> = {};
  for (const m of markets) pos[m.id] = project(MARKET_GEO[m.id] ?? SPARE_ANCHORS[spare++ % SPARE_ANCHORS.length]);

  // Auto-crop: bound the pins, pad generously, keep a map-ish aspect (between
  // a 1.3 card and a 2.4 banner), and never leave the world. A domestic-only
  // game reads as a US map; with exports on it becomes a wide world banner.
  const xs = markets.map((m) => pos[m.id][0]);
  const ys = markets.map((m) => pos[m.id][1]);
  let w = Math.min(360, Math.max(24, Math.max(...xs) - Math.min(...xs)) * 1.55);
  let h = Math.min(180, Math.max(18, Math.max(...ys) - Math.min(...ys)) * 1.9);
  if (w / h > 2.4) h = Math.min(180, w / 2.4);
  if (w / h < 1.3) w = Math.min(360, h * 1.3);
  const cx0 = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy0 = (Math.min(...ys) + Math.max(...ys)) / 2;
  const vb = {
    x: Math.max(0, Math.min(360 - w, cx0 - w / 2)),
    y: Math.max(0, Math.min(180 - h, cy0 - h / 2)),
    w, h,
  };
  const u = w / 320; // unit scalar: stroke widths & text sizes match the old 320-wide design

  // Node "weight" for sizing: allocation share (decision) or revenue share (results).
  const totalRev = breakdown ? Object.values(breakdown).reduce((a, m) => a + Math.max(0, m.revenue), 0) : 0;
  const totalW = weights ? Object.values(weights).reduce((a, x) => a + Math.max(0, x), 0) : 0;
  const sizeOf = (id: string): number => {
    if (breakdown) return totalRev > 0 ? (breakdown[id]?.revenue ?? 0) / totalRev : 0;
    if (weights) return totalW > 0 ? Math.max(0, weights[id] ?? 0) / totalW : id === home.id ? 1 : 0;
    return id === home.id ? 1 : 0;
  };
  const isIn = (id: string): boolean => id === home.id || entered.includes(id) || (breakdown?.[id]?.entered ?? false);
  const radius = (id: string) => (7 + Math.sqrt(sizeOf(id)) * 12) * u;

  const fill = (m: MarketConfig, inMkt: boolean) =>
    !inMkt ? "var(--color-paper)" : m.kind === "export" ? "var(--color-hop)" : m.kind === "domestic" ? "var(--color-copper)" : "var(--color-copperdeep)";

  // Trade routes from home: gentle arcs (bulge ∝ distance) so export lanes read
  // as shipping routes, not chords through the landmass.
  const [hx, hy] = pos[home.id];
  const route = (m: MarketConfig): string => {
    const [x, y] = pos[m.id];
    const mx = (hx + x) / 2, my = (hy + y) / 2;
    const dist = Math.hypot(x - hx, y - hy);
    const lift = m.kind === "export" ? dist * 0.18 : dist * 0.1;
    return `M${hx} ${hy} Q${mx} ${my - lift} ${x} ${y}`;
  };

  return (
    <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="w-full" role="img" aria-label="Market map">
      {/* the world */}
      <path d={WORLD_LAND_PATH} fill="var(--color-line)" fillOpacity={0.45} stroke="var(--color-line2)" strokeWidth={0.4 * u} strokeLinejoin="round" />
      {/* trade routes */}
      {markets.filter((m) => m.id !== home.id).map((m) => {
        const inMkt = isIn(m.id);
        return (
          <path
            key={`r-${m.id}`}
            d={route(m)}
            fill="none"
            stroke={inMkt ? "var(--color-copper)" : "var(--color-inksoft)"}
            strokeWidth={(inMkt ? 1.3 : 0.9) * u}
            strokeDasharray={inMkt ? "0" : `${3 * u} ${3 * u}`}
            opacity={inMkt ? 0.85 : 0.45}
          />
        );
      })}
      {/* market pins */}
      {(() => {
        // DW-080: one name per market (the City View's city), and a label drops BELOW its pin when it
        // would print over a neighbour's — Front Range / Cedar Falls / Harbor City crowd on a phone.
        const below = new Set<string>();
        const placed: { x: number; y: number; w: number }[] = [];
        const hits = (x: number, y: number, w: number, h: number) => placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + 2 * u && Math.abs(p.y - y) < h);
        for (const m of [...markets].sort((a, b) => pos[a.id][0] - pos[b.id][0])) {
          const [x, y] = pos[m.id];
          const w = marketName(m.id, m.label).length * 4.8 * u, ly = y - radius(m.id) - 4 * u;
          if (hits(x, ly, w, 10 * u)) { below.add(m.id); placed.push({ x, y: y + radius(m.id) + 9 * u, w }); }
          else placed.push({ x, y: ly, w });
        }
        // the "$X to enter" captions collide the same way — step each down until it is clear (two tries)
        const entryY = new Map<string, number>();
        for (const m of [...markets].sort((a, b) => pos[a.id][0] - pos[b.id][0])) {
          if (isIn(m.id) || !(m.entry_cost > 0)) continue;
          const [x, y] = pos[m.id];
          const w = `${fmt.money(m.entry_cost)} to enter`.length * 3.6 * u;
          let ey = y + radius(m.id) + (below.has(m.id) ? 17 : 8.5) * u;
          for (let k = 0; k < 2 && hits(x, ey, w, 7.5 * u); k++) ey += 7.5 * u;
          entryY.set(m.id, ey);
          placed.push({ x, y: ey, w });
        }
        return markets.map((m) => {
        const [x, y] = pos[m.id];
        const inMkt = isIn(m.id);
        const r = radius(m.id);
        const perf = breakdown?.[m.id];
        const share = breakdown && totalRev > 0 ? Math.round(((perf?.revenue ?? 0) / totalRev) * 100) : null;
        return (
          <g key={m.id}>
            <circle
              cx={x} cy={y} r={r}
              fill={fill(m, inMkt)} fillOpacity={inMkt ? 0.88 : 1}
              stroke={inMkt ? "var(--color-copperdeep)" : "var(--color-inksoft)"}
              strokeWidth={1.2 * u}
              strokeDasharray={inMkt ? "0" : `${2.5 * u} ${2.5 * u}`}
            />
            <text x={x} y={below.has(m.id) ? y + r + 9 * u : y - r - 4 * u} textAnchor="middle" className="fill-ink font-semibold" fontSize={8.5 * u} paintOrder="stroke" stroke="var(--color-paper)" strokeWidth={2.4 * u} strokeLinejoin="round">
              {marketName(m.id, m.label)}
            </text>
            {m.kind === "export" && inMkt && <text x={x} y={y + 2.6 * u} textAnchor="middle" className="fill-paper font-bold" fontSize={6.5 * u}>FX</text>}
            {share != null && inMkt && m.kind !== "export" && share > 0 && (
              <text x={x} y={y + 2.6 * u} textAnchor="middle" className="fill-paper font-bold" fontSize={7 * u}>{share}%</text>
            )}
            {!inMkt && m.entry_cost > 0 && (
              <text x={x} y={entryY.get(m.id) ?? y + r + 8.5 * u} textAnchor="middle" className="fill-inksoft" fontSize={6.5 * u} paintOrder="stroke" stroke="var(--color-paper)" strokeWidth={2 * u} strokeLinejoin="round">
                {fmt.money(m.entry_cost)} to enter
              </text>
            )}
          </g>
        );
        });
      })()}
    </svg>
  );
}
