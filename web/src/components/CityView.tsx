/**
 * City View per market (MOD-B01 geography) — the implementation of the Claude Design
 * "City View.dc.html" prototype. A globe navigates the markets ("cities") the firm can
 * operate in; each city is a procedurally-drawn isometric map where you site facilities
 * into districts (rent × output × brand × zoning tradeoffs), read local demand (who leads
 * each segment here), and scout rivals. International cities surface only once the engine
 * has opened them (international on + past the unlock round), so single-market and
 * pre-expansion games never see them.
 *
 * This is a presentation/action surface over existing engine mechanics: building queues a
 * `build_facilities` order (district + market), entering a market commits `market_presence`
 * (which triggers the engine's one-time entry cost), and scouting opens the existing rival
 * dossier (FirmDetail) with its research-gated poach flow. Nothing here changes engine math.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Config } from "drinkwars-engine";
import type { GameView, MarketView, MarketSegmentStanding, MarketLot } from "../game/controller.js";
import type { CityActions, CityBuildOrder } from "../game/cityActions.js";
import { buildKey, dedupeBuilds, marketPresenceFrom, overruledBuilds, teamBuildSource, teamEntryNote, teammateBuilds, type LostBuild } from "../game/cityActions.js";
import { SEG_LABEL, SEG_CHARACTER, DISTRICT_BEST, MARKET_META, ZONE_OF, ZONE_TONE, FAC_TAG, FAC_NOTE, fmt, rankDistrictsForType, districtFitScore } from "../labels.js";
import { firmColor } from "../lib/teamColors.js";
import { FacilityChip, flowBadge } from "./FacilityGlyph.js";
import { AnchoredPopover } from "./AnchoredPopover.js";
import { WORLD_LAND_PATH } from "./worldland.js";

// ───────────────────────── constants (Tap House hexes for canvas drawing) ─────────────────────────
const ISO = { N: 16, TW: 30, TH: 15, OX: 500, OY: 108 };
const PAL = { mapbg: "#e7d8b2", lot: "#dfcfa3", road: "#cdbd95", roadMaj: "#bca673", park: "#bccf86", tree: "#7f9f48", water: "#8fb6bf", waterHi: "#abccd1" };
// Your-site building tone now derives from the player's chosen house colour (mineTone in drawCity).
const ARCH_OF: Record<string, string> = { downtown: "core", riverside: "arts", industrial: "industrial", suburban: "garden" };
const PROF: Record<string, { min: number; max: number; tone: string; park: number }> = {
  core: { min: 54, max: 94, tone: "cool", park: 0 },
  arts: { min: 28, max: 48, tone: "brick", park: 0.07 },
  industrial: { min: 16, max: 30, tone: "ware", park: 0.02 },
  garden: { min: 11, max: 24, tone: "warm", park: 0.22 },
  waterfront: { min: 18, max: 36, tone: "warm", park: 0.12 },
};
const TONES: Record<string, { roof: string; l: string; r: string }> = {
  cool: { roof: "#e7e0cd", l: "#cbc6ad", r: "#aca78b" },
  warm: { roof: "#ece0bf", l: "#cdbb8e", r: "#b29a68" },
  brick: { roof: "#ddc6a0", l: "#c2a675", r: "#a6885a" },
  ware: { roof: "#d8c9a2", l: "#bcab80", r: "#9f895d" },
};
const ZONE_COLOR: Record<string, string> = { core: "#cf8f54", arts: "#d9a64e", industrial: "#7f93b0", garden: "#8fb06a", waterfront: "#5fa6ad" };

// ───────────────────────── tiny helpers ─────────────────────────
const rng = (seed: number) => {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const isoXY = (cx: number, cy: number): [number, number] => [ISO.OX + (cx - cy) * ISO.TW, ISO.OY + (cx + cy) * ISO.TH];
const districtCenters = (n: number): [number, number][] => {
  if (n <= 3) return ([[4, 4], [12, 5], [8, 12]] as [number, number][]).slice(0, n);
  if (n === 4) return [[4, 4], [12, 4], [4, 12], [12, 12]];
  return ([[3, 3], [13, 3], [8, 9], [3, 13], [13, 13]] as [number, number][]).slice(0, n);
};
const shade = (hex: string, amt: number): string => {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  let r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const f = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (f - r) * p); g = Math.round(g + (f - g) * p); b = Math.round(b + (f - b) * p);
  return `rgb(${r},${g},${b})`;
};
// firmColor returns var(--color-…) for palette firms and a hex for the player's picked
// house colour. Canvas fillStyle can't resolve CSS vars, so resolve them to hex here so
// both your sites (picked hex) and rivals (palette hues) paint accurately on the iso map.
const resolveColor = (c: string): string => {
  if (typeof c !== "string" || !c.startsWith("var(")) return c;
  try { const v = getComputedStyle(document.documentElement).getPropertyValue(c.slice(4, -1).trim()).trim(); return v || c; } catch { return c; }
};
const cssColor = (firmId: string): string => resolveColor(firmColor(firmId));
const trafficColor = (t: number): string => {
  const a = [31, 140, 147], b = [227, 165, 47], c = [176, 75, 30];
  let col: number[];
  if (t < 0.5) { const k = t / 0.5; col = a.map((v, i) => Math.round(v + (b[i] - v) * k)); }
  else { const k = (t - 0.5) / 0.5; col = b.map((v, i) => Math.round(v + (c[i] - v) * k)); }
  return `rgb(${col[0]},${col[1]},${col[2]})`;
};
const trafficDots = (t: number): string => { const n = Math.round(t * 4); return "●●●●".slice(0, n) + "○○○○".slice(0, 4 - n); };
const FPROF: Record<string, number> = { taproom: 26, brewery_small: 30, canning_line: 34, brewery_large: 44 };

// ───────────────────────── city model + procedural plan ─────────────────────────
interface DistrictModel { key: string; label: string; arch: string; kind: string; rent: number; out: number; brand: number; best: string }
interface MineModel {
  id: string; type: string; district: string; lot?: string; active: boolean; pending: boolean;
  // DW-082d — a queued build: its order, whether this seat may withdraw it, and whether a teammate's word dropped it from the plan
  order?: CityBuildOrder; own?: boolean; overruled?: boolean; lostWhy?: LostBuild;
}
interface RivalModel { firmId: string; name: string; district: string; type: string; lot?: string }
interface CityModel {
  id: string; name: string; region: string; kind: string; entered: boolean; entryCost: number; fx: number;
  geo: [number, number]; coast: "right" | "bottom" | null; seed: number; roadEvery: number;
  districts: DistrictModel[]; mine: MineModel[]; rivals: RivalModel[]; segments: MarketSegmentStanding[]; lots: MarketLot[];
  catchment?: { grid: number; radius: number; lambda: number; self_weight: number; beta_loc: number };
}
interface Cell { cx: number; cy: number; kind: string; di: number; arch: string; h: number; t2: number; traffic: number; major: boolean; fac?: MineModel; rival?: RivalModel }
interface Plan {
  cells: Cell[];
  districts: { key: string; label: string; arch: string; cx: number; cy: number; traffic: number }[];
  facilities: { id: string; cx: number; cy: number; h: number; tag: string; type: string; district: string; active: boolean; pending: boolean }[];
  rivals: { cx: number; cy: number; h: number; firmId: string; name: string; type: string; district: string }[];
  leases: { cx: number; cy: number; district: string; lot: string; crowd: number }[];
}

/** extraBuilds: builds already in the round decision but not in cityActions — e.g. the
 *  firm-builder's founding facilities (auto-placed on home lots round 1). Shown as PENDING so
 *  their lots read as taken (no land scramble); display-only, so they're not double-counted. */
function buildCity(view: GameView, market: MarketView, actions: CityActions, extraBuilds: { type: string; location?: string; market?: string; lot?: string }[] = [], extraOwn = false, lost: Map<string, LostBuild> = new Map()): CityModel {
  const meta = MARKET_META[market.id] ?? { city: market.label, region: "", geo: [0, 0] as [number, number], coast: null, seed: 1 };
  const dCfg = view.modules?.facilities?.districts ?? [];
  const districts: DistrictModel[] = dCfg.map((d) => ({
    key: d.id, label: d.label, arch: ARCH_OF[d.kind] ?? "arts", kind: d.kind,
    rent: d.rent_mult, out: d.capacity_mult ?? 1, brand: d.brand_boost ?? 0, best: DISTRICT_BEST[d.id] ?? d.blurb ?? "",
  }));
  const fallbackDistrict = districts[0]?.key ?? "downtown";
  const real: MineModel[] = market.yourSites.map((s) => ({
    id: s.id, type: s.type, district: s.location_id ?? fallbackDistrict, lot: s.lot_id,
    active: actions.reactivations.includes(s.id) ? true : actions.mothballs.includes(s.id) ? false : s.active,
    pending: false,
  }));
  // DW-076: the form mirrors builds the queue already holds (a cover the plan carries, or the
  // stored slice after a reload) — one marker per order, never two.
  // DW-082d: this seat may withdraw its own queue (and the form's builds when the lever is its own);
  // a build a teammate's word dropped from the plan is marked, not drawn as breaking ground.
  // DW-082e: the team plan's builds too — the CEO's form never copies a teammate's (DW-081), so their map showed
  // nothing a teammate sited until the round resolved. Display-only and never this seat's to withdraw.
  const ownKeys = new Set(actions.builds.map(buildKey));
  const extraKeys = new Set((extraBuilds as CityBuildOrder[]).map(buildKey));
  const teamBuilds = teammateBuilds(view);
  const queued: MineModel[] = dedupeBuilds([...actions.builds, ...extraBuilds, ...teamBuilds] as CityBuildOrder[])
    .filter((b) => b.market === market.id)
    .map((b, i) => { const k = buildKey(b); return { id: `queued_${market.id}_${i}`, type: b.type, district: b.location ?? (market.lots ?? []).find((L) => L.id === b.lot)?.district ?? fallbackDistrict, lot: b.lot, active: true, pending: true,
      order: b, own: ownKeys.has(k) || (extraOwn && extraKeys.has(k)), overruled: lost.has(k), lostWhy: lost.get(k) }; });
  const rivals: RivalModel[] = market.rivalSites.map((s) => ({ firmId: s.firmId, name: s.name, district: s.location_id ?? fallbackDistrict, type: s.type, lot: s.lot_id }));
  // A market counts as entered if the engine has it (prior rounds) OR it was committed this
  // round in the City View — otherwise the just-entered market stays "locked" and its siting
  // UI (FOR LEASE lots, "Site a facility") never appears, so you can't develop it until the
  // round resolves. Same-round enter→build is valid in the engine, so let the UI allow it.
  const enteredNow = market.entered || actions.markets.includes(market.id);
  return {
    id: market.id, name: meta.city, region: meta.region || market.label, kind: market.kind,
    entered: enteredNow, entryCost: market.entryCost, fx: market.fx,
    geo: meta.geo, coast: meta.coast, seed: meta.seed, roadEvery: 4,
    districts, mine: [...real, ...queued], rivals, segments: market.segments, lots: market.lots ?? [],
    catchment: view.modules?.facilities?.catchment,
  };
}

function cityPlan(c: CityModel): Plan {
  const N = ISO.N, rand = rng((c.seed || 1) * 131 + 9), dr = c.districts, centers = districtCenters(dr.length), roadEvery = c.roadEvery || 4, coast = c.coast;
  const isRoad = (x: number, y: number) => x % roadEvery === 0 || y % roadEvery === 0 || x === N - 1 || y === N - 1;
  const waterAt = (x: number, y: number) => {
    if (coast === "right") { const b = N - 4 + Math.round(Math.sin(y * 0.7) * 1.6); return x > b; }
    if (coast === "bottom") { const b = N - 4 + Math.round(Math.sin(x * 0.7) * 1.6); return y > b; }
    return false;
  };
  const bridgeAt = (x: number, y: number) => (coast === "right" ? y === Math.round(N / 2) : coast === "bottom" ? x === Math.round(N / 2) : false);
  const dist = (x: number, y: number, p: [number, number]) => Math.hypot(x - p[0], y - p[1]);
  const districtOf = (x: number, y: number) => { let bi = 0, bd = 1e9; centers.forEach((p, i) => { const d = dist(x, y, p); if (d < bd) { bd = d; bi = i; } }); return bi; };
  let coreIdx = 0, bb = -1; dr.forEach((d, i) => { const s = (d.arch === "core" ? 3 : 0) + d.brand; if (s > bb) { bb = s; coreIdx = i; } });
  const coreC = centers[coreIdx];
  const traffic = (x: number, y: number) => { let t = 1 - dist(x, y, coreC) / (N * 0.85); if (x % (roadEvery * 2) === 0 || y % (roadEvery * 2) === 0) t += 0.18; return Math.max(0, Math.min(1, t)); };
  const cells: Cell[] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const di = districtOf(x, y), prof = PROF[dr[di].arch] || PROF.arts, h = prof.min + rand() * (prof.max - prof.min), isPark = rand() < prof.park, t2 = rand();
    let kind: string;
    if (waterAt(x, y)) kind = bridgeAt(x, y) ? "road" : "water";
    else if (isRoad(x, y)) kind = "road";
    else if (isPark) kind = "park";
    else kind = "build";
    cells.push({ cx: x, cy: y, kind, di, arch: dr[di].arch, h, t2, traffic: traffic(x, y), major: x % (roadEvery * 2) === 0 || y % (roadEvery * 2) === 0 });
  }
  const cellAt = (x: number, y: number): Cell | undefined => (x >= 0 && y >= 0 && x < N && y < N ? cells[y * N + x] : undefined);
  const dCenterOf = (key: string): [number, number] => centers[dr.findIndex((d) => d.key === key)] ?? [8, 8];

  // Phase 2: facilities, rivals, and leases sit on REAL lots (engine coords). Lot-less legacy
  // facilities (e.g. founding builds) fall back near their district center so they still show.
  const lotById = new Map(c.lots.map((L) => [L.id, L] as const));
  const fallbackPos = (district: string, idx: number): [number, number] => { const [cx, cy] = dCenterOf(district); return [Math.max(1, Math.min(N - 2, cx + ((idx % 3) - 1))), Math.max(1, Math.min(N - 2, cy + ((Math.floor(idx / 3) % 3) - 1)))]; };

  const facilities: Plan["facilities"] = [];
  c.mine.forEach((f, idx) => {
    const L = f.lot ? lotById.get(f.lot) : undefined;
    const [cx, cy] = L ? [L.x, L.y] : fallbackPos(f.district, idx);
    const cell = cellAt(cx, cy); if (cell) { cell.kind = "mine"; cell.h = FPROF[f.type] ?? 28; cell.fac = f; }
    facilities.push({ id: f.id, cx, cy, h: FPROF[f.type] ?? 28, tag: FAC_TAG[f.type] ?? "•", type: f.type, district: f.district, active: f.active, pending: f.pending });
  });
  const rivals: Plan["rivals"] = [];
  c.rivals.forEach((rv, idx) => {
    const L = rv.lot ? lotById.get(rv.lot) : undefined;
    const [cx, cy] = L ? [L.x, L.y] : fallbackPos(rv.district, idx + 40);
    const cell = cellAt(cx, cy); if (cell) { cell.kind = "rival"; cell.h = 34; cell.rival = rv; }
    rivals.push({ cx, cy, h: 34, firmId: rv.firmId, name: rv.name, type: rv.type, district: rv.district });
  });

  // Available parcels = unlocked + unoccupied (built/queued/rival). Crowd preview = competing
  // footprint within the catchment radius (rivals full weight, your own softer) — the "find the
  // right location" hint: low crowd = blue ocean, high = saturated.
  const occupied = new Set<string>(); c.mine.forEach((f) => f.lot && occupied.add(f.lot)); c.rivals.forEach((r) => r.lot && occupied.add(r.lot));
  const sited = [...facilities.map((f) => ({ x: f.cx, y: f.cy, own: true })), ...rivals.map((r) => ({ x: r.cx, y: r.cy, own: false }))];
  const radius = c.catchment?.radius ?? 5, selfW = c.catchment?.self_weight ?? 0.5;
  const crowdAt = (x: number, y: number): number => sited.reduce((a, s) => { const k = Math.max(0, 1 - Math.hypot(x - s.x, y - s.y) / radius); return a + (k > 0 ? k * (s.own ? selfW : 1) : 0); }, 0);
  const leases: Plan["leases"] = [];
  for (const L of c.lots) {
    if (!L.unlocked || occupied.has(L.id)) continue;
    const cell = cellAt(L.x, L.y); if (cell) cell.kind = "lease";
    leases.push({ cx: L.x, cy: L.y, district: L.district, lot: L.id, crowd: crowdAt(L.x, L.y) });
  }

  const districts = dr.map((d) => {
    const dl = c.lots.filter((L) => L.district === d.key);
    const cx = dl.length ? dl.reduce((a, L) => a + L.x, 0) / dl.length : dCenterOf(d.key)[0];
    const cy = dl.length ? dl.reduce((a, L) => a + L.y, 0) / dl.length : dCenterOf(d.key)[1];
    return { key: d.key, label: d.label, arch: d.arch, cx, cy, traffic: traffic(Math.round(cx), Math.round(cy)) };
  });
  cells.sort((a, b) => a.cx + a.cy - (b.cx + b.cy));
  return { cells, districts, facilities, rivals, leases };
}

const pct = (cx: number, cy: number, h: number, layer: string) => {
  const [X, Y] = isoXY(cx, cy);
  const raised = layer === "map" || layer === "trade"; // trade reuses the 3-D base
  return { l: (X / 1000) * 100, t: ((Y + ISO.TH - (raised ? h || 0 : 4) - 14) / 680) * 100 };
};

// ───────────────────────── isometric city canvas ─────────────────────────
function diamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, inset: number, stroke?: string) {
  const [X, Y] = isoXY(cx, cy), tw = ISO.TW * inset, th = ISO.TH * inset, my = Y + ISO.TH;
  ctx.beginPath(); ctx.moveTo(X, my - th); ctx.lineTo(X + tw, my); ctx.lineTo(X, my + th); ctx.lineTo(X - tw, my); ctx.closePath();
  ctx.fillStyle = color; ctx.fill(); if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 0.6; ctx.stroke(); }
}
function building(ctx: CanvasRenderingContext2D, cx: number, cy: number, h: number, t: { roof: string; l: string; r: string }) {
  const [X, Y] = isoXY(cx, cy), ins = 0.84, tw = ISO.TW * ins, th = ISO.TH * ins, my = Y + ISO.TH;
  const bt: [number, number] = [X, my - th], br: [number, number] = [X + tw, my], bb: [number, number] = [X, my + th], bl: [number, number] = [X - tw, my];
  ctx.fillStyle = t.l; ctx.beginPath(); ctx.moveTo(bl[0], bl[1]); ctx.lineTo(bb[0], bb[1]); ctx.lineTo(bb[0], bb[1] - h); ctx.lineTo(bl[0], bl[1] - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = t.r; ctx.beginPath(); ctx.moveTo(br[0], br[1]); ctx.lineTo(bb[0], bb[1]); ctx.lineTo(bb[0], bb[1] - h); ctx.lineTo(br[0], br[1] - h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = t.roof; ctx.beginPath(); ctx.moveTo(bt[0], bt[1] - h); ctx.lineTo(br[0], br[1] - h); ctx.lineTo(bb[0], bb[1] - h); ctx.lineTo(bl[0], bl[1] - h); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(70,48,18,0.22)"; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(bb[0], bb[1]); ctx.lineTo(bb[0], bb[1] - h); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(bt[0], bt[1] - h); ctx.lineTo(br[0], br[1] - h); ctx.lineTo(bb[0], bb[1] - h); ctx.lineTo(bl[0], bl[1] - h); ctx.closePath(); ctx.stroke();
}
function toneFromColor(c: string) { const x = resolveColor(c); return { roof: shade(x, 0.45), l: shade(x, 0.12), r: shade(x, -0.28) }; }
function rivalTone(firmId: string) { return toneFromColor(firmColor(firmId)); }
// youColor: paint "your" buildings in an explicit house colour (the founding site map, where the
// player's colour isn't yet registered on a firm id). Omitted in live play ⇒ derive from youId.
function drawCity(cv: HTMLCanvasElement, plan: Plan, layer: string, youId: string, youColor?: string) {
  const r = cv.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext("2d"); if (!ctx) return;
  const selfColor = youColor ?? firmColor(youId); // your buildings paint in your chosen house colour
  const mineTone = toneFromColor(selfColor);
  const mineOutline = shade(resolveColor(selfColor), -0.45);
  ctx.setTransform(cv.width / 1000, 0, 0, cv.height / 680, 0, 0);
  ctx.fillStyle = PAL.mapbg; ctx.fillRect(0, 0, 1000, 680);
  for (const cell of plan.cells) {
    if (cell.kind === "water") { diamond(ctx, cell.cx, cell.cy, PAL.water, 1.001); if (cell.t2 > 0.62) diamond(ctx, cell.cx, cell.cy, PAL.waterHi, 0.45); continue; }
    if (layer === "map") {
      if (cell.kind === "road") { diamond(ctx, cell.cx, cell.cy, cell.major ? PAL.roadMaj : PAL.road, 1.001); continue; }
      if (cell.kind === "park") { diamond(ctx, cell.cx, cell.cy, PAL.park, 1.001); if (cell.t2 > 0.4) { const [X, Y] = isoXY(cell.cx, cell.cy); ctx.fillStyle = PAL.tree; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(X - 8 + i * 8, Y + ISO.TH - 2, 2.4, 0, 7); ctx.fill(); } } continue; }
      if (cell.kind === "lease") { diamond(ctx, cell.cx, cell.cy, PAL.lot, 1.001); diamond(ctx, cell.cx, cell.cy, "rgba(224,165,47,0.32)", 0.84, "rgba(154,80,36,0.5)"); continue; }
      diamond(ctx, cell.cx, cell.cy, PAL.lot, 1.001);
      const tone = cell.kind === "mine" ? mineTone : cell.kind === "rival" && cell.rival ? rivalTone(cell.rival.firmId) : TONES[(PROF[cell.arch] || PROF.arts).tone];
      building(ctx, cell.cx, cell.cy, cell.h, tone);
    } else {
      let col: string;
      if (cell.kind === "road") col = layer === "traffic" ? trafficColor(cell.traffic) : "#d8cba6";
      else if (cell.kind === "park") col = layer === "traffic" ? trafficColor(cell.traffic * 0.6) : ZONE_COLOR.garden;
      else col = layer === "traffic" ? trafficColor(cell.traffic) : ZONE_COLOR[cell.arch] || "#cf8f54";
      diamond(ctx, cell.cx, cell.cy, col, 1.001, "rgba(120,90,40,0.18)");
      if (cell.kind === "mine") diamond(ctx, cell.cx, cell.cy, mineOutline, 0.4);
      else if (cell.kind === "rival" && cell.rival) diamond(ctx, cell.cx, cell.cy, cssColor(cell.rival.firmId), 0.4);
    }
  }
  // chrome: frame + compass + scale bar
  ctx.strokeStyle = "rgba(120,90,40,0.42)"; ctx.lineWidth = 2; ctx.strokeRect(9, 9, 982, 662);
  ctx.lineWidth = 0.8; ctx.strokeStyle = "rgba(120,90,40,0.28)"; ctx.strokeRect(14, 14, 972, 652);
  const ox = 70, oy = 600, rr = 22;
  ctx.fillStyle = "rgba(252,245,231,0.5)"; ctx.beginPath(); ctx.arc(ox, oy, rr + 8, 0, 7); ctx.fill();
  ctx.strokeStyle = "#9a7a45"; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(ox, oy, rr, 0, 7); ctx.stroke();
  ctx.fillStyle = "#9a5024"; ctx.beginPath(); ctx.moveTo(ox, oy - rr); ctx.lineTo(ox - 5, oy); ctx.lineTo(ox + 5, oy); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#2c1d11"; ctx.font = "700 14px 'IBM Plex Sans',sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", ox, oy - rr - 6);
}

// ───────────────────────── globe (shared painter) ─────────────────────────
let LAND: [number, number][] | null = null;
function ensureLand() {
  if (LAND) return LAND;
  const pts: [number, number][] = [];
  try {
    const s = 2, mc = document.createElement("canvas"); mc.width = 360 * s; mc.height = 180 * s;
    const mx = mc.getContext("2d"); if (mx && WORLD_LAND_PATH) {
      mx.scale(s, s); mx.fillStyle = "#000"; mx.fill(new Path2D(WORLD_LAND_PATH));
      const data = mx.getImageData(0, 0, mc.width, mc.height).data;
      for (let lat = -84; lat <= 84; lat += 2.4) for (let lon = -178; lon <= 178; lon += 2.4) {
        const px = Math.round((lon + 180) * s), py = Math.round((90 - lat) * s);
        if (data[(py * mc.width + px) * 4 + 3] > 40) pts.push([lon, lat]);
      }
    }
  } catch { /* land silhouette is decorative — globe still works without it */ }
  LAND = pts; return LAND;
}
const toVec = (geo: [number, number]) => { const la = (geo[1] * Math.PI) / 180, lo = (geo[0] * Math.PI) / 180; return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) }; };
const slerp = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) => {
  let d = a.x * b.x + a.y * b.y + a.z * b.z; d = Math.max(-1, Math.min(1, d));
  const o = Math.acos(d); if (o < 1e-4) return a; const s = Math.sin(o), w1 = Math.sin((1 - t) * o) / s, w2 = Math.sin(t * o) / s;
  return { x: a.x * w1 + b.x * w2, y: a.y * w1 + b.y * w2, z: a.z * w1 + b.z * w2 };
};
interface GlobePin { id: string; x: number; y: number; front: boolean }
function paintGlobe(cv: HTMLCanvasElement, cities: CityModel[], homeGeo: [number, number] | null, rot: number, tilt: number, zoom: number, opts: { full?: boolean; mini?: boolean; arcs?: boolean }, mouse: { x: number; y: number } | null): GlobePin[] {
  const land = ensureLand();
  const r = cv.getBoundingClientRect(); if (r.width < 2) return [];
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(r.width * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
  const ctx = cv.getContext("2d"); if (!ctx) return [];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = r.width, H = r.height; ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.4 * zoom;
  const rr = (rot * Math.PI) / 180, T = (tilt * Math.PI) / 180, cr = Math.cos(rr), sr = Math.sin(rr), ct = Math.cos(T), st = Math.sin(T);
  const proj = (lon: number, lat: number) => { const la = (lat * Math.PI) / 180, lo = (lon * Math.PI) / 180; const x0 = Math.cos(la) * Math.sin(lo), y0 = Math.sin(la), z0 = Math.cos(la) * Math.cos(lo); const x = x0 * cr + z0 * sr, z = -x0 * sr + z0 * cr; const y2 = y0 * ct - z * st, z2 = y0 * st + z * ct; return { x: cx + R * x, y: cy - R * y2, z: z2 }; };
  const projVec = (v: { x: number; y: number; z: number }) => { const x = v.x * cr + v.z * sr, z = -v.x * sr + v.z * cr; const y2 = v.y * ct - z * st, z2 = v.y * st + z * ct; return { x: cx + R * x, y: cy - R * y2, z: z2 }; };
  if (opts.full) { const halo = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R * 1.34); halo.addColorStop(0, "rgba(224,165,47,0.18)"); halo.addColorStop(1, "rgba(224,165,47,0)"); ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(cx, cy, R * 1.34, 0, 7); ctx.fill(); }
  const g = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.36, R * 0.15, cx, cy, R); g.addColorStop(0, "#bcd0cb"); g.addColorStop(0.62, "#9cb6b1"); g.addColorStop(1, "#7e9a98");
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = "rgba(120,90,40,0.15)"; ctx.lineWidth = 0.7;
  for (let lon = -150; lon <= 180; lon += 30) { ctx.beginPath(); let s = false; for (let lat = -80; lat <= 80; lat += 4) { const q = proj(lon, lat); if (q.z > 0) { s ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); s = true; } else s = false; } ctx.stroke(); }
  for (let lat = -60; lat <= 60; lat += 30) { ctx.beginPath(); let s = false; for (let lon = -180; lon <= 180; lon += 4) { const q = proj(lon, lat); if (q.z > 0) { s ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); s = true; } else s = false; } ctx.stroke(); }
  ctx.fillStyle = "#b07a44"; const ds = Math.max(opts.full ? 1.8 : 1.3, (opts.full ? 2.2 : 1.6) * zoom);
  for (const p of land) { const q = proj(p[0], p[1]); if (q.z > 0) { ctx.globalAlpha = 0.45 + 0.5 * q.z; ctx.fillRect(q.x - ds / 2, q.y - ds / 2, ds, ds); } }
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.strokeStyle = "rgba(154,80,36,0.5)"; ctx.lineWidth = 1.2; ctx.stroke();
  if ((opts.full || opts.arcs) && homeGeo) { const a = toVec(homeGeo); for (const c of cities) { if (c.kind !== "export") continue; const b = toVec(c.geo); ctx.strokeStyle = "rgba(154,80,36,0.55)"; ctx.lineWidth = opts.full ? 1.4 : 1; ctx.setLineDash([5, 5]); ctx.beginPath(); let s = false; for (let t = 0; t <= 1.0001; t += 1 / 40) { const q = projVec(slerp(a, b, t)); if (q.z > 0) { if (!s) { ctx.moveTo(q.x, q.y); s = true; } else ctx.lineTo(q.x, q.y); } else s = false; } ctx.stroke(); ctx.setLineDash([]); } }
  const pins: GlobePin[] = [];
  const labels: { text: string; x: number; y: number; prio: number }[] = []; // full globe: drawn after the pins, see below
  for (const c of cities) { const q = proj(c.geo[0], c.geo[1]); const front = q.z > 0.02; pins.push({ id: c.id, x: q.x, y: q.y, front });
    if (q.z > -0.1) {
      const col = c.entered ? "#c0703a" : c.kind === "export" ? "#1f8c93" : "#9a7d52";
      const hov = !!mouse && Math.hypot(q.x - mouse.x, q.y - mouse.y) < (opts.full ? 22 : 13) && front;
      ctx.globalAlpha = front ? 1 : 0.4; ctx.beginPath(); ctx.arc(q.x, q.y, opts.full ? (hov ? 8 : 6) : hov ? 5.5 : 4.2, 0, 7); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = opts.full ? 2 : 1.4; ctx.strokeStyle = "#fff4e0"; ctx.stroke();
      if (c.entered && opts.full) { ctx.beginPath(); ctx.arc(q.x, q.y, 11, 0, 7); ctx.strokeStyle = "rgba(192,112,58,0.5)"; ctx.lineWidth = 1.4; ctx.stroke(); }
      ctx.globalAlpha = 1;
      if (front && opts.full) labels.push({ text: c.name.toUpperCase(), x: q.x, y: q.y, prio: hov ? 0 : c.entered ? 1 : 2 });
      else if (front && opts.mini && (c.entered || hov)) { ctx.font = "700 9px 'IBM Plex Sans',sans-serif"; ctx.textAlign = "center"; const ty = q.y - 8; ctx.lineWidth = 2.6; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(244,236,216,0.92)"; ctx.strokeText(c.name.toUpperCase(), q.x, ty); ctx.fillStyle = "#2c1d11"; ctx.fillText(c.name.toUpperCase(), q.x, ty); }
    }
  }
  // DW-080: the full globe labels every city in front — on a phone the US cities printed over each
  // other. Hovered first, then entered, then the rest; a label that would overlap one already drawn
  // tries below its pin, else waits for a hover.
  if (labels.length) {
    ctx.font = "800 14px 'EB Garamond',Georgia,serif"; ctx.textAlign = "center"; ctx.lineWidth = 3.5; ctx.lineJoin = "round";
    const drawn: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const L of labels.sort((p, q) => p.prio - q.prio)) {
      const w = ctx.measureText(L.text).width + 6;
      for (const ty of [L.y - 14, L.y + 26]) {
        const r = { x0: L.x - w / 2, x1: L.x + w / 2, y0: ty - 13, y1: ty + 3 };
        if (L.prio > 0 && drawn.some((d) => r.x0 < d.x1 && r.x1 > d.x0 && r.y0 < d.y1 && r.y1 > d.y0)) continue;
        drawn.push(r);
        ctx.strokeStyle = "rgba(244,236,216,0.92)"; ctx.strokeText(L.text, L.x, ty); ctx.fillStyle = "#2c1d11"; ctx.fillText(L.text, L.x, ty);
        break;
      }
    }
  }
  return pins;
}

// ───────────────────────── interactive mini globe (sidebar) ─────────────────────────
function MiniGlobe({ cities, homeGeo, hasIntl, onSelect, onOpen }: { cities: CityModel[]; homeGeo: [number, number] | null; hasIntl: boolean; onSelect: (id: string) => void; onOpen: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rot = useRef(100); const pins = useRef<GlobePin[]>([]); const drag = useRef<{ x: number; rot: number; moved: boolean } | null>(null); const mouse = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    let raf = 0; let alive = true;
    const frame = () => { if (!alive) return; const cv = ref.current; if (cv) { if (hasIntl && !drag.current) rot.current += 0.1; try { pins.current = paintGlobe(cv, cities, homeGeo, rot.current, 36, hasIntl ? 1.62 : 1.98, { mini: true, arcs: hasIntl }, mouse.current); } catch { /* ignore */ } } raf = window.setTimeout(frame, 50) as unknown as number; };
    frame();
    return () => { alive = false; clearTimeout(raf); };
  }, [cities, homeGeo, hasIntl]);
  const down = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.nativeEvent.offsetX, rot: rot.current, moved: false }; };
  const move = (e: React.PointerEvent) => { mouse.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }; if (drag.current) { const dx = e.nativeEvent.offsetX - drag.current.x; if (Math.abs(dx) > 4) drag.current.moved = true; rot.current = drag.current.rot + dx * 0.55; } };
  const up = (e: React.PointerEvent) => { const d = drag.current; drag.current = null; if (!d || d.moved) return; const mx = e.nativeEvent.offsetX, my = e.nativeEvent.offsetY; let best: string | null = null, bd = 14; for (const p of pins.current) { if (!p.front) continue; const dd = Math.hypot(p.x - mx, p.y - my); if (dd < bd) { bd = dd; best = p.id; } } if (best) onSelect(best); else onOpen(); };
  return <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { mouse.current = null; }} onPointerCancel={() => { drag.current = null; mouse.current = null; }} title="Drag to spin · tap a market to fly in · tap empty space to open the globe" style={{ width: "100%", height: 158, display: "block", cursor: "grab", touchAction: "none" }} />;
}

// ───────────────────────── full-screen globe overlay ─────────────────────────
function GlobeOverlay({ cities, homeGeo, onClose, onPick }: { cities: CityModel[]; homeGeo: [number, number] | null; onClose: () => void; onPick: (id: string) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rot = useRef(100); const tilt = useRef(34); const zoom = useRef(1); const pins = useRef<GlobePin[]>([]);
  const drag = useRef<{ x: number; y: number; rot: number; tilt: number; moved: boolean } | null>(null); const mouse = useRef<{ x: number; y: number } | null>(null);
  const fly = useRef<{ id: string; t0: number; rot0: number; tilt0: number; lon: number; lat: number } | null>(null);
  useEffect(() => {
    let raf = 0; let alive = true; const t0 = performance.now();
    const frame = (now: number) => {
      if (!alive) return; const cv = ref.current;
      if (cv) {
        if (fly.current) { const z = fly.current; let k = (now - z.t0) / 850; if (k > 1) k = 1; const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; zoom.current = 1 + 1.5 * e; const dr = ((-z.lon - z.rot0) % 360 + 540) % 360 - 180; rot.current = z.rot0 + dr * e; tilt.current = z.tilt0 + (z.lat - z.tilt0) * e; if (k >= 1) { const id = z.id; fly.current = null; onPick(id); return; } }
        else if (!drag.current) rot.current += 0.12;
        try { pins.current = paintGlobe(cv, cities, homeGeo, rot.current, tilt.current, zoom.current, { full: true }, mouse.current); } catch { /* ignore */ }
      }
      raf = window.requestAnimationFrame(frame);
    };
    raf = window.requestAnimationFrame(frame); void t0;
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [cities, homeGeo, onPick]);
  const hit = (mx: number, my: number) => { let best: string | null = null, bd = 22; for (const p of pins.current) { if (!p.front) continue; const dd = Math.hypot(p.x - mx, p.y - my); if (dd < bd) { bd = dd; best = p.id; } } return best; };
  const down = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, rot: rot.current, tilt: tilt.current, moved: false }; };
  const move = (e: React.PointerEvent) => { mouse.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }; if (drag.current) { const dx = e.nativeEvent.offsetX - drag.current.x, dy = e.nativeEvent.offsetY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true; rot.current = drag.current.rot + dx * 0.32; tilt.current = Math.max(-8, Math.min(78, drag.current.tilt + dy * 0.3)); } };
  const up = (e: React.PointerEvent) => { const d = drag.current; drag.current = null; if (d && d.moved) return; const id = hit(e.nativeEvent.offsetX, e.nativeEvent.offsetY); if (id) { const c = cities.find((x) => x.id === id); if (c) fly.current = { id, t0: performance.now(), rot0: rot.current, tilt0: tilt.current, lon: c.geo[0], lat: c.geo[1] }; } };
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50" style={{ background: "radial-gradient(120% 100% at 50% 8%, var(--color-panel) 0%, var(--color-paper) 55%, var(--color-panel2) 100%)" }}>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => { mouse.current = null; }} onPointerCancel={() => { drag.current = null; mouse.current = null; }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", cursor: "grab", touchAction: "none" }} />
      <div className="pointer-events-none absolute left-5 top-4">
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.18em] text-copperdeep">Drink Wars · global markets</div>
        <div className="display text-3xl font-black text-ink">The World</div>
        <div className="mt-1.5 max-w-[300px] text-xs text-inksoft">Drag to spin. Click a market to fly in.</div>
      </div>
      <button onClick={onClose} className="absolute right-5 top-4 rounded-lg border border-copperdeep px-3.5 py-2 font-mono text-[0.7rem] uppercase tracking-wide text-copperdeep" style={{ background: "color-mix(in srgb, var(--color-copper) 12%, var(--color-panel))" }}>✕ Close</button>
      <div className="scl absolute right-5 top-[104px] flex max-h-[calc(100%-140px)] w-[240px] flex-col gap-1.5 overflow-y-auto">
        <div className="mb-0.5 font-mono text-[0.55rem] uppercase tracking-[0.16em] text-inksoft">Markets</div>
        {cities.map((c) => (
          <button key={c.id} onClick={() => { const cc = cities.find((x) => x.id === c.id); if (cc) fly.current = { id: c.id, t0: performance.now(), rot0: rot.current, tilt0: tilt.current, lon: cc.geo[0], lat: cc.geo[1] }; }} className="rounded-lg border bg-panel/80 px-2.5 py-2 text-left backdrop-blur" style={{ borderColor: "var(--color-line2)" }}>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 flex-none rounded-full" style={{ background: c.entered ? "var(--color-copper)" : c.kind === "export" ? "var(--color-aero)" : "var(--color-inksoft)" }} />
              <span className="display flex-1 text-sm font-bold uppercase tracking-wide text-ink">{c.name}</span>
              <span className="font-mono text-[0.55rem] uppercase" style={{ color: c.kind === "export" ? "var(--color-aero)" : "var(--color-inksoft)" }}>{c.kind === "export" ? "intl" : c.kind === "home" ? "home" : "dom"}</span>
            </div>
            <div className="mt-1 flex justify-between pl-[17px]">
              <span className="text-[0.7rem] text-inksoft">{c.region}</span>
              <span className="font-mono text-[0.6rem]" style={{ color: c.entered ? "var(--color-inksoft)" : "var(--color-gold)" }}>{c.entered ? `${c.mine.length} site${c.mine.length === 1 ? "" : "s"}` : `Enter · ${fmt.money(c.entryCost)}`}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── main component ─────────────────────────
export function CityView({ view, actions, setActions, onInspect, extraBuilds = [], extraOwn = false, onWithdrawBuild, carriedSupply }: { view: GameView; actions: CityActions; setActions: (u: (a: CityActions) => CityActions) => void; onInspect: (firmId: string) => void; extraBuilds?: { type: string; location?: string; market?: string; lot?: string }[]; extraOwn?: boolean; onWithdrawBuild?: (b: CityBuildOrder) => void; carriedSupply?: Record<string, number> }) {
  const lost = useMemo(() => overruledBuilds(view), [view]);
  const cities = useMemo(() => view.markets.map((m) => buildCity(view, m, actions, extraBuilds, extraOwn, lost)), [view, actions, extraBuilds, extraOwn, lost]);
  const hasIntl = cities.some((c) => c.kind === "export");
  const homeGeo = cities.find((c) => c.kind === "home")?.geo ?? null;
  const youId = view.own.id;
  const facTypes = view.modules?.facilities?.types ?? [];
  const facOn = !!view.modules?.facilities?.enabled;
  const typeOf = (id: string) => facTypes.find((t) => t.id === id);

  const [selId, setSelId] = useState<string>(() => cities.find((c) => c.entered)?.id ?? cities[0]?.id ?? "home");
  const [layer, setLayer] = useState<"map" | "traffic" | "zoning" | "trade">("map");
  const [hoverSeg, setHoverSeg] = useState<string | null>(null);
  const [hoverFac, setHoverFac] = useState<string | null>(null);
  const [siting, setSiting] = useState<{ lot: string | null; district: string | null; type: string | null; bid?: number } | null>(null);
  const [entering, setEntering] = useState<string | null>(null);
  const [facPop, setFacPop] = useState<string | null>(null);
  const [globeOpen, setGlobeOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null); // the map box the on-map popovers anchor to (DW-079)
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sel = cities.find((c) => c.id === selId) ?? cities[0];
  const plan = useMemo(() => (sel ? cityPlan(sel) : null), [sel?.id, sel?.mine.map((f) => f.id + f.lot + f.district + f.active).join(","), sel?.rivals.map((r) => r.firmId + r.lot).join(","), sel?.lots.map((L) => L.id + L.unlocked + L.occupant).join(",")]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!plan || !canvasRef.current) return;
    const draw = () => { if (canvasRef.current && plan) try { drawCity(canvasRef.current, plan, layer === "trade" ? "map" : layer, youId); } catch { /* ignore */ } };
    const id = window.setTimeout(draw, 0);
    window.addEventListener("resize", draw);
    return () => { clearTimeout(id); window.removeEventListener("resize", draw); };
  }, [plan, layer]);

  if (!sel) return <div className="rounded-xl border border-line2 bg-panel p-6 text-sm text-inksoft">The city map opens once geographic markets are in play.</div>;

  const dByKey = (k: string) => sel.districts.find((d) => d.key === k);
  const segMeta = (id: string) => SEG_CHARACTER[id] ?? { hue: "var(--color-copper)", tagline: "", rewards: "" };
  const leaderName = (id: string | null) => (id ? (id === youId ? "You" : view.names[id] ?? id) : "— open");
  const cityShare = sel.segments.length ? sel.segments.reduce((a, s) => a + s.yourShare * s.size, 0) / Math.max(1, sel.segments.reduce((a, s) => a + s.size, 0)) : 0;
  const leadCount = sel.segments.filter((s) => s.leader === youId).length;

  // ---- actions ----
  const selectCity = (id: string) => { const c = cities.find((x) => x.id === id); if (!c) return; setSiting(null); setFacPop(null); setGlobeOpen(false); if (c.entered) setSelId(id); else { setSelId(id); setEntering(id); } };
  const commitEnter = (id: string) => { setActions((a) => ({ ...a, markets: Array.from(new Set([...a.markets, id])) })); setEntering(null); setSelId(id); };
  const openSiting = (district?: string | null, lot?: string | null) => setSiting({ lot: lot ?? null, district: district ?? null, type: null });
  const build = () => {
    if (!siting?.lot || !siting.district || !siting.type) return;
    const order = { type: siting.type, location: siting.district, market: sel.id, lot: siting.lot, ...(siting.bid && siting.bid > 0 ? { bid: siting.bid } : {}) };
    setActions((a) => ({ ...a, builds: [...a.builds, order], markets: Array.from(new Set([...a.markets, sel.id])) }));
    setSiting(null);
  };
  // Parcels you can lease right now (unlocked + unoccupied by built/queued/rival), with a crowd
  // preview so a blue-ocean spot is obvious. Mirrors the engine catchment weighting.
  const cat = sel.catchment;
  const occupiedLots = new Set<string>(); sel.mine.forEach((f) => f.lot && occupiedLots.add(f.lot)); sel.rivals.forEach((r) => r.lot && occupiedLots.add(r.lot));
  const lotCoord = new Map(sel.lots.map((L) => [L.id, L] as const));
  const sitedPts = [
    ...sel.mine.map((f) => f.lot && lotCoord.get(f.lot)).filter(Boolean).map((L) => ({ x: (L as MarketLot).x, y: (L as MarketLot).y, own: true })),
    ...sel.rivals.map((r) => r.lot && lotCoord.get(r.lot)).filter(Boolean).map((L) => ({ x: (L as MarketLot).x, y: (L as MarketLot).y, own: false })),
  ];
  const crowdAtLot = (L: MarketLot): number => sitedPts.reduce((a, s) => { const k = Math.max(0, 1 - Math.hypot(L.x - s.x, L.y - s.y) / (cat?.radius ?? 5)); return a + (k > 0 ? k * (s.own ? cat?.self_weight ?? 0.5 : 1) : 0); }, 0);
  const crowdTone = (cr: number): { label: string; color: string } => cr < 0.25 ? { label: "Blue ocean", color: "var(--color-hop)" } : cr < 0.9 ? { label: "Some competition", color: "var(--color-gold)" } : { label: "Crowded", color: "var(--color-brick)" };
  const availLots = sel.lots.filter((L) => L.unlocked && !occupiedLots.has(L.id));
  const toggleFac = (id: string) => {
    const fac = sel.mine.find((f) => f.id === id); if (!fac || fac.pending) return;
    setActions((a) => {
      const moth = new Set(a.mothballs), react = new Set(a.reactivations);
      if (fac.active) { moth.add(id); react.delete(id); } else { react.add(id); moth.delete(id); }
      return { ...a, mothballs: [...moth], reactivations: [...react] };
    });
  };
  const toggleMaintain = (id: string, type: string) => {
    const t = typeOf(type); const amt = t ? Math.round(t.condition_decay / Math.max(t.maintenance_effect, 1e-6)) : 12;
    setActions((a) => { const m = { ...a.maintain }; if (m[id]) delete m[id]; else m[id] = amt; return { ...a, maintain: m }; });
  };
  const toggleDivest = (id: string) => {
    const fac = sel.mine.find((f) => f.id === id); if (!fac || fac.pending) return;
    setActions((a) => { const dv = new Set(a.divests); if (dv.has(id)) dv.delete(id); else dv.add(id); return { ...a, divests: [...dv] }; });
  };

  const presence = marketPresenceFrom(view, actions.markets);
  // DW-082: the offers in force — the drawer's once edited, else the form's (carried from last round).
  const offers = actions.supply ?? carriedSupply ?? {};
  const offered = (id: string) => typeof offers[id] === "number";
  const anyOffer = Object.keys(presence).some(offered);
  const selSites = sel.mine.length;
  const tradeOn = layer === "trade";
  // Last resolved round's per-market trade flow (produced/consumed/net/lanes) — engine hook #1.
  const flow = view.ownResult?.markets?.[sel.id] ?? null;
  // DW-082d: shipments come from the lanes (recorded where they land), not from `net` = brewed − sold,
  // which also counted beer left unsold — "ships 21600" when 19,372 went out.
  const flows = view.ownResult?.markets ?? null;
  const shippedOut = (id: string) => Object.values(flows ?? {}).reduce((a, m) => a + (m.lanes ?? []).filter((L) => L.origin_market === id).reduce((s2, L) => s2 + L.units, 0), 0);
  const shippedIn = (id: string) => (flows?.[id]?.lanes ?? []).reduce((a, L) => a + L.units, 0);
  const shipBadge = (id: string): { text: string; tone: "in" | "out" | "neutral" } => { const o = shippedOut(id), i = shippedIn(id); return o > 0.5 ? { text: `↑ shipped out ${fmt.int(o)}`, tone: "out" } : i > 0.5 ? { text: `↓ shipped in ${fmt.int(i)}`, tone: "in" } : { text: "all local", tone: "neutral" }; };
  // DW-082e: builds are one lever — after the CEO's word on them, a build sent LATER waits for the CEO ("cancelled it" was untrue)
  const lostCopy = (l: LostBuild | undefined) => {
    if (!l?.who) return "A teammate's call on builds stands — see your team's rows on Decide.";
    const tag = (s: { name: string; role: string | null }) => `${s.name} (${(s.role ?? "").toUpperCase()})`;
    if (l.kind === "chair") return `${tag(l.who)} set this round's builds — it's their desk, so their call stands.`;
    // A seated chair who submitted without changing builds yields to the CEO, whose row keeps Use theirs (playtest
    // 10-29: it read "the COO decides" with no button, so this copy had stopped promising one).
    const unless = l.chair ? `, unless ${tag(l.chair)}, whose desk it is, sets them` : "";
    if (l.kind === "ceo") return l.waiting
      ? `Waiting on ${tag(l.who)}. The CEO set this round's builds before you sent this one, and the CEO's word on builds is final${unless} — so it goes in once the CEO takes it (Use theirs, on Decide). Talk to them.`
      : `${tag(l.who)} cancelled it. The CEO's word on builds is final${unless}: the CEO can bring it back with Use theirs, on Decide. Or withdraw it to free the parcel.`;
    return `${tag(l.who)} changed the team's builds after you sent this — among teammates the latest change wins. Talk to them, or to your CEO, who has the final say.`;
  };
  // Playtest 10-29: a teammate's build — the CEO looked here for a cancel. Builds are one list in Sprint 2, so say where it is.
  const teamBuildCopy = (b: CityBuildOrder | undefined) => {
    const src = b ? teamBuildSource(view, b) : null;
    const tag = (s: { name: string; role: string | null }) => `${s.name} (${(s.role ?? "").toUpperCase()})`;
    const from = src?.by ? tag(src.by) : "a teammate";
    if (src?.chair) return `On the team plan from ${from}. ${tag(src.chair)} set this round's builds — it's their desk, so their call stands.`;
    if (src?.ceo) return `On the team plan from ${from}. To drop it: Decide › What locks › Build facilities › Cancel it (Keep mine, if you've sited your own). Builds are one list, so that drops every teammate's build this round.`;
    return `On the team plan from ${from} — talk to them, or answer it on Decide.`;
  };
  const entryNote = (id: string) => teamEntryNote(view, id); // playtest 10-29: a city the team plan already enters
  const layerTabs: { id: "map" | "traffic" | "zoning" | "trade"; label: string }[] = [{ id: "map", label: "Map" }, { id: "traffic", label: "Traffic" }, { id: "zoning", label: "Zoning" }, { id: "trade", label: "Trade" }];

  // ── derived view copy ──
  const enteredCount = cities.filter((c) => c.entered).length;
  const siteCount = cities.reduce((a, c) => a + (c.entered ? c.mine.filter((f) => !f.pending).length : 0), 0);
  const mapHint = !sel.entered ? `${sel.name} — enter the market to develop it` : `${sel.name} — site facilities into districts`;
  // DW-076: before the unlock the export markets are not in the view at all (geography.ts filters
  // them), so the Trade tab is where a team learns WHEN the globe opens. Rounds are 1-based on screen.
  const intl = view.modules?.international;
  const exportsOpenRound = intl?.enabled && !hasIntl && view.round < (intl.export_unlock_round ?? 0) ? (intl.export_unlock_round ?? 0) + 1 : null;
  const legendNote = layer === "traffic" ? "Traffic — warm = busy streets" : layer === "zoning" ? "Zoning — land use by district" : layer === "trade" ? (exportsOpenRound ? `Trade — flows shipped per round · Exports open in round ${exportsOpenRound}` : "Trade — flows shipped per round") : "Click a FOR-LEASE parcel to site a facility";
  const selKindLabel = sel.kind === "export" ? "International market" : sel.kind === "home" ? "Home market" : "Domestic market";
  const totalPresence = Math.max(0.001, Object.values(presence).reduce((a, b) => a + b, 0));
  const autoPresence = Math.max(0.001, Object.entries(presence).filter(([id]) => !offered(id)).reduce((a, [, w]) => a + w, 0));

  return (
    <div className="relative grid gap-3.5 lg:grid-cols-[248px_minmax(0,1fr)_330px] lg:items-start">
      {/* ░░ LEFT RAIL — operation · globe · cities ░░ */}
      <aside className="scl flex flex-col gap-3 lg:max-h-[84vh] lg:overflow-y-auto">
        <section className="card p-3.5">
          <div className="eyebrow">Your operation</div>
          <div className="display mt-0.5 text-[1.05rem] leading-tight text-ink">{view.names[youId] ?? "Your Brewery"}</div>
          <div className="mt-0.5 text-sm italic text-inksoft">{enteredCount} market{enteredCount === 1 ? "" : "s"} · {siteCount} site{siteCount === 1 ? "" : "s"}</div>
          <div onClick={() => setGlobeOpen(true)} title="Open the globe" className="relative mt-2.5 cursor-pointer overflow-hidden rounded-[10px] border border-line2" style={{ background: "radial-gradient(120% 100% at 50% 20%, #f6ecd4, #e2d0a6)" }}>
            <div className="pointer-events-none absolute left-2 top-1.5 z-[2]">
              {/* the card is always parchment (like the map) — fixed ink, not theme tokens, or dark mode reads light-on-light */}
              <div className="font-mono text-[0.5rem] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(44,29,17,.62)" }}>Territory</div>
              <div className="display text-[0.82rem] leading-none" style={{ color: "#2c1d11" }}>{hasIntl ? "Global network" : "United States"}</div>
              <div className="font-mono text-[0.5rem]" style={{ color: "rgba(44,29,17,.62)" }}>{hasIntl ? `${cities.filter((c) => c.kind !== "export").length} domestic · ${cities.filter((c) => c.kind === "export" && c.entered).length} intl live` : `${cities.length} markets`}</div>
            </div>
            <MiniGlobe cities={cities} homeGeo={homeGeo} hasIntl={hasIntl} onSelect={selectCity} onOpen={() => setGlobeOpen(true)} />
            <div className="pointer-events-none absolute bottom-1.5 right-2 font-mono text-[0.5rem] font-semibold uppercase tracking-wide" style={{ color: "#8a4b1e" }}>Open globe ⤢</div>
          </div>
        </section>

        {exportsOpenRound && tradeOn && (
          <section className="card p-3">
            <div className="mb-1 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-aero">International ↗</div>
            <div className="text-sm text-ink">Exports open in round {exportsOpenRound}.</div>
            <div className="mt-0.5 text-[0.72rem] leading-snug text-inksoft">The export markets appear here once the globe opens; until then, build the home base.</div>
          </section>
        )}
        {hasIntl && (
          <section className="card p-3">
            <div className="mb-1.5 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-aero">International ↗</div>
            <div className="flex flex-col gap-1.5">
              {cities.filter((c) => c.kind === "export").map((c) => (
                <button key={c.id} onClick={() => selectCity(c.id)} className="flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left" style={{ borderColor: c.id === selId ? "var(--color-copperdeep)" : "var(--color-line2)", background: c.id === selId ? "color-mix(in srgb, var(--color-aero) 14%, var(--color-panel))" : "var(--color-panel)" }}>
                  <span className="h-1.5 w-1.5 flex-none rounded-full border" style={{ background: c.entered ? "var(--color-copper)" : "var(--color-aero)", borderColor: "var(--color-copperdeep)" }} />
                  <span className="display flex-1 text-[0.85rem] text-ink">{c.name}</span>
                  <span className="font-mono text-[0.6rem]" style={{ color: c.entered ? "var(--color-inksoft)" : "var(--color-aero)" }}>{c.entered ? `${c.mine.filter((f) => !f.pending).length} site${c.mine.filter((f) => !f.pending).length === 1 ? "" : "s"}` : "scout"}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="card p-3">
          <div className="mb-1.5 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-inksoft">Your cities</div>
          <div className="flex flex-col gap-1.5">
            {cities.map((c) => {
              const sl = c.id === selId; const share = c.segments.length ? c.segments.reduce((a, s) => a + s.yourShare * s.size, 0) / Math.max(1, c.segments.reduce((a, s) => a + s.size, 0)) : 0;
              const ns = c.mine.filter((f) => !f.pending).length;
              return (
                <button key={c.id} onClick={() => selectCity(c.id)} className="block w-full rounded-[10px] border px-2.5 py-2 text-left transition-colors" style={{ borderColor: sl ? "var(--color-copperdeep)" : "var(--color-line2)", background: sl ? "color-mix(in srgb, var(--color-copper) 12%, var(--color-panel))" : "var(--color-panel)" }}>
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 flex-none rounded-sm border" style={{ background: c.entered ? "var(--color-copper)" : "transparent", borderColor: c.entered ? "var(--color-copperdeep)" : "var(--color-inksoft)" }} />
                    <span className="display flex-1 text-[0.92rem] text-ink">{c.name}</span>
                    <span className="tnum text-[0.78rem] font-semibold" style={{ color: c.entered ? "var(--color-copper)" : "var(--color-inksoft)" }}>{c.entered ? fmt.pct(share) : "—"}</span>
                  </div>
                  <div className="mt-0.5 flex justify-between pl-[18px]">
                    <span className="text-[0.78rem] italic text-inksoft">{c.region}{c.kind === "export" ? " · intl" : ""}</span>
                    <span className="font-mono text-[0.58rem]" style={{ color: c.entered ? "var(--color-inksoft)" : "var(--color-gold)" }}>{c.entered ? `${ns} site${ns === 1 ? "" : "s"}` : `Enter · ${fmt.money(c.entryCost)}`}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </aside>

      {/* ░░ CENTER — layer toolbar · map stage · legend ░░ */}
      {/* sticks BELOW the page's sticky tab bar (it used to stick at 14px, under the bar) */}
      <main className="flex flex-col gap-3 lg:sticky lg:top-[4.25rem]">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex gap-0.5 rounded-[10px] border border-line2 bg-panel p-0.5">
            {layerTabs.map((t) => (
              <button key={t.id} onClick={() => setLayer(t.id)} className="rounded-[7px] px-3 py-1.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wide" style={{ background: layer === t.id ? "var(--color-copper)" : "transparent", color: layer === t.id ? "#fff4e0" : "var(--color-inksoft)" }}>{t.label}</button>
            ))}
          </div>
          {/* DW-082e: Supply & lanes sat at the foot of the right rail — easy to miss (playtest 10-28) */}
          <button data-dw="supply-lanes" onClick={() => { setLayer("trade"); setDrawerOpen(true); }} className="rounded-[10px] border border-copperdeep px-3 py-1.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wide text-copperdeep" style={{ background: "color-mix(in srgb, var(--color-copper) 12%, var(--color-panel))" }}>Supply &amp; lanes ↗</button>
          <div className="flex-1" />
          <span className="text-sm italic text-faint" style={{ color: "var(--color-inksoft)" }}>{mapHint}</span>
        </div>

        {/* DW-082e: a build of mine the team plan dropped is named over the map, in whichever city it sits */}
        {(() => {
          const lostAll = cities.flatMap((c) => c.mine.filter((f) => f.overruled).map(() => c));
          if (!lostAll.length) return null;
          const n = lostAll.length, elsewhere = [...new Set(lostAll.filter((c) => c.id !== sel.id).map((c) => c.name))];
          return (
            <div role="status" data-dw="lost-banner" className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm leading-snug text-ink" style={{ borderColor: "var(--color-brick)", background: "color-mix(in srgb, var(--color-brick) 9%, var(--color-panel))" }}>
              <span aria-hidden="true" className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full font-mono text-[0.6rem] font-bold leading-none text-white" style={{ background: "var(--color-brick)" }}>✕</span>
              <span>{n === 1 ? "One of your builds isn't in the team plan" : `${n} of your builds aren't in the team plan`}, so {n === 1 ? "it won't" : "they won't"} break ground as things stand. Click a <b className="text-brick">✕</b> marker to see why{elsewhere.length ? ` (in ${elsewhere.join(", ")})` : ""}.</span>
            </div>
          );
        })()}

        {/* map stage */}
        <div ref={stageRef} className="card relative w-full overflow-visible p-0" style={{ aspectRatio: "1000 / 680" }}>
          {/* overflow-visible so on-map popovers (facility / lease) can extend above a
              top-row marker without being cropped by the map box; the canvas keeps the
              rounded map corners via its own border-radius. */}
          <div className="absolute inset-0 overflow-visible rounded-[14px]" style={{ background: PAL.mapbg }}>
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", borderRadius: 14 }} />

            {plan && (layer === "map" || layer === "trade") && plan.districts.map((d) => { const ec = dByKey(d.key); if (!ec) return null; const p = pct(d.cx, d.cy, 60, layer); return (
              <div key={d.key} className="pointer-events-none absolute z-[4] flex flex-col items-center gap-0.5" style={{ left: `${p.l}%`, top: `${p.t}%`, transform: "translate(-50%,-100%)" }}>
                <div className="display whitespace-nowrap text-[0.8rem] tracking-[0.1em]" style={{ color: "rgba(44,29,17,.78)", textShadow: `0 1px 3px ${PAL.mapbg}, 0 0 6px ${PAL.mapbg}` }}>{ec.label}</div>
                <div className="pointer-events-auto flex items-center gap-1">
                  <span className="hidden rounded border border-line bg-panel/90 px-1 py-px font-mono text-[0.55rem] sm:inline" style={{ color: ec.rent > 1.05 ? "var(--color-brick)" : ec.rent < 0.95 ? "var(--color-hop)" : "var(--color-inksoft)" }} title="Rent multiplier">R×{ec.rent.toFixed(2)}</span>
                  <span className="hidden rounded border border-line bg-panel/90 px-1 py-px font-mono text-[0.55rem] sm:inline" style={{ color: ec.out > 1.02 ? "var(--color-hop)" : ec.out < 0.98 ? "var(--color-brick)" : "var(--color-inksoft)" }} title="Output multiplier">O×{ec.out.toFixed(2)}</span>
                  <span className="hidden rounded border border-line bg-panel/90 px-1 py-px font-mono text-[0.55rem] text-aero sm:inline" title="Foot traffic">{trafficDots(d.traffic)}</span>
                  {facOn && sel.entered && <button onClick={() => openSiting(d.key)} title={`Build in ${ec.label}`} className="grid h-[18px] w-[18px] place-items-center rounded border border-copperdeep font-mono text-[0.62rem] font-bold leading-none text-copperdeep" style={{ background: "color-mix(in srgb, var(--color-copper) 22%, var(--color-panel))" }}>+</button>}
                </div>
              </div>
            ); })}

            {plan && facOn && sel.entered && (layer === "map" || layer === "trade") && plan.leases.map((L, i) => { const p = pct(L.cx, L.cy, 0, layer); const ec = dByKey(L.district); const z = ZONE_OF[ec?.kind ?? ""]; const ct = crowdTone(L.crowd); return (
              <button key={i} data-dw="lease-pin" onClick={() => openSiting(L.district, L.lot)} title={`Available parcel · ${ec?.label ?? L.district} · ${ct.label}`} className="absolute z-[5] cursor-pointer border-none bg-none p-0" style={{ left: `${p.l}%`, top: `${p.t}%`, transform: "translate(-50%,-100%)" }}>
                <span className="hidden rounded-t-[3px] border px-1.5 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-wide text-white sm:block" style={{ background: "var(--color-copperdeep)", borderColor: "#6e3914" }}>FOR LEASE</span>
                <span className="hidden items-center justify-center gap-0.5 rounded-b-[3px] border border-t-0 px-1 py-px text-center font-mono text-[0.44rem] font-bold uppercase text-copperdeep sm:flex" style={{ background: "#f3e6c8", borderColor: "#6e3914" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: ct.color }} />{z?.zone ?? ""}</span>
                <span className="grid h-[18px] w-[18px] place-items-center rounded-[4px] border sm:hidden" style={{ background: "var(--color-copperdeep)", borderColor: "#6e3914" }} aria-label="For lease"><span className="h-1.5 w-1.5 rounded-full" style={{ background: ct.color }} /></span>
                <span className="mx-auto block h-2 w-px" style={{ background: "#6e3914" }} />
              </button>
            ); })}

            {plan && plan.facilities.map((f) => { const p = pct(f.cx, f.cy, f.h, layer); const ec = dByKey(f.district); const tt = typeOf(f.type); const lostHere = !!sel.mine.find((x) => x.id === f.id)?.overruled; const dim = hoverFac && hoverFac !== f.id ? 0.5 : !f.active ? 0.5 : lostHere ? 0.9 : f.pending ? 0.6 : 1; const fb = tradeOn ? flowBadge((tt?.production_capacity ?? tt?.capacity_contribution ?? 0) - (tt?.retail_draw ?? 0)) : null; return (
              <button key={f.id} data-dw="fac-marker" onClick={() => setFacPop(f.id)} onMouseEnter={() => setHoverFac(f.id)} onMouseLeave={() => setHoverFac(null)} title={`${tt?.label ?? f.type} · ${ec?.label ?? f.district}${f.pending ? (lostHere ? " · not in the team plan" : " · breaking ground") : f.active ? "" : " · mothballed"}`} className="absolute z-[7] flex cursor-pointer flex-col items-center border-none bg-none p-0" style={{ left: `${p.l}%`, top: `${p.t}%`, transform: "translate(-50%,-100%)", opacity: dim, filter: hoverFac === f.id ? "drop-shadow(0 0 5px var(--color-copperdeep))" : "drop-shadow(0 3px 5px rgba(40,25,8,.32))" }}>
                {lostHere ? (
                  // DW-082e: a build the team plan dropped — greyed, a brick ✕ and a "not in plan" tag (a dimmer dash read as just another pending build)
                  <span className="relative block">
                    <FacilityChip type={f.type} color={cssColor(youId)} size={30} mine style={{ outline: "2px dashed var(--color-brick)", outlineOffset: 1, filter: "grayscale(.85)", opacity: 0.6 }} />
                    <span aria-hidden="true" className="absolute -right-2 -top-2 grid h-[15px] w-[15px] place-items-center rounded-full font-mono text-[0.55rem] font-bold leading-none text-white" style={{ background: "var(--color-brick)", boxShadow: "0 0 0 1.5px var(--color-panel)" }}>✕</span>
                  </span>
                ) : <FacilityChip type={f.type} color={cssColor(youId)} size={30} mine style={f.pending ? { outline: "2px dashed #7e3f18", outlineOffset: 1 } : undefined} />}
                {lostHere && <span className="mt-0.5 hidden whitespace-nowrap rounded-[3px] px-1 py-px font-mono text-[0.45rem] font-bold uppercase leading-none tracking-wide text-white sm:block" style={{ background: "var(--color-brick)" }}>not in plan</span>}
                {fb && <span className="mt-0.5 rounded-full px-1.5 py-px font-mono text-[0.5rem] font-bold leading-none" style={{ background: fb.tone === "out" ? "var(--color-copper)" : fb.tone === "in" ? "var(--color-aero)" : "var(--color-panel)", color: fb.tone === "neutral" ? "var(--color-inksoft)" : "#fff4e0", whiteSpace: "nowrap" }}>{fb.text}</span>}
              </button>
            ); })}

            {plan && plan.rivals.map((r, i) => { const p = pct(r.cx, r.cy, r.h, layer); const col = cssColor(r.firmId); const ec = dByKey(r.district); return (
              <button key={i} onClick={() => onInspect(r.firmId)} title={`${r.name} · ${typeOf(r.type)?.label ?? r.type} · ${ec?.label ?? r.district} — scout`} className="absolute z-[6] cursor-pointer border-none bg-none p-0" style={{ left: `${p.l}%`, top: `${p.t}%`, transform: "translate(-50%,-100%)", opacity: hoverSeg ? 0.45 : 1, filter: "drop-shadow(0 2px 4px rgba(40,25,8,.3))" }}>
                <FacilityChip type={r.type} color={col} size={24} />
              </button>
            ); })}

            {/* trade supply lanes (Trade layer) */}
            {plan && tradeOn && (() => {
              const isProd = (ty: string) => { const t = typeOf(ty); return (t?.production_capacity ?? t?.capacity_contribution ?? 0) > 0; };
              const isRetail = (ty: string) => (typeOf(ty)?.retail_draw ?? 0) > 0;
              const src = plan.facilities.find((f) => isProd(f.type)) ?? plan.facilities[0];
              const retail = plan.facilities.filter((f) => isRetail(f.type) && f !== src);
              const net = shippedOut(sel.id) - shippedIn(sel.id); // DW-082d: what really shipped, not brewed − sold
              const ptOf = (f: { cx: number; cy: number; h: number }) => { const pp = pct(f.cx, f.cy, f.h, layer); return [pp.l, pp.t] as const; };
              if (!src) return null;
              const [sx, sy] = ptOf(src);
              return (
                <>
                  <svg className="pointer-events-none absolute inset-0 z-[5] h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {retail.slice(0, 3).map((rt, i) => { const [x2, y2] = ptOf(rt); if (sx === x2 && sy === y2) return null; return (
                      <path key={i} d={`M${sx} ${sy} Q${(sx + x2) / 2} ${Math.min(sy, y2) - 7} ${x2} ${y2}`} fill="none" stroke="#cf9a5f" strokeWidth="0.6" strokeDasharray="1.6 1.6" strokeLinecap="round" className="dwflow" vectorEffect="non-scaling-stroke" />
                    ); })}
                    {Math.abs(net) > 5 && (() => { const out = net > 0; const x2 = out ? 98 : 2; const y2 = Math.max(8, sy - 12); return (
                      <path d={`M${sx} ${sy} Q${(sx + x2) / 2} ${y2 - 5} ${x2} ${y2}`} fill="none" stroke={out ? "#c0703a" : "#1f8c93"} strokeWidth="1.3" strokeDasharray="2.6 2.4" strokeLinecap="round" className="dwflow" vectorEffect="non-scaling-stroke" />
                    ); })()}
                  </svg>
                  {Math.abs(net) > 5 && (
                    <div className="pointer-events-none absolute top-2 z-[6] rounded-full px-2 py-0.5 font-mono text-[0.55rem] font-bold" style={{ ...(net > 0 ? { right: 8 } : { left: 8 }), background: net > 0 ? "var(--color-copper)" : "var(--color-aero)", color: "#fff4e0" }}>{net > 0 ? `↗ ${fmt.int(net)} ship out` : `↘ ${fmt.int(-net)} ship in`}</div>
                  )}
                </>
              );
            })()}

            {/* on-map facility popover — click a site to read its condition/progress + act (design's facPop) */}
            {plan && facPop && (() => {
              const fp = plan.facilities.find((x) => x.id === facPop); const f = sel.mine.find((x) => x.id === facPop); const t = f ? typeOf(f.type) : undefined;
              if (fp && f && f.pending) {
                // DW-082d: a queued build — what it costs, whether it is still in the team plan, and (if it is this seat's) Withdraw.
                const ec = dByKey(f.district); const p = pct(fp.cx, fp.cy, fp.h, "map"); const label = t?.label ?? f.type;
                const body = (
                  <>
                    <div className="flex items-baseline justify-between gap-2"><div className="flex items-center gap-2"><FacilityChip type={f.type} color={cssColor(youId)} size={20} mine /><div className="display text-[0.95rem] text-ink">{label}</div></div><button onClick={() => setFacPop(null)} className="border-none bg-none text-[0.8rem] text-inksoft">✕</button></div>
                    <div className="text-[0.7rem] italic text-inksoft">{ec?.label ?? f.district} · {f.overruled ? "not in the team plan" : "breaks ground when the round locks"}</div>
                    {f.overruled && <div className="mt-2 text-[0.68rem] leading-snug text-brick">{lostCopy(f.lostWhy)}</div>}
                    <div className="mt-2 flex justify-between text-[0.8rem]"><span className="text-inksoft">Cost</span><span className="tnum font-semibold text-ink">{fmt.money((t?.base_cost ?? 0) + (f.order?.bid ?? 0))}</span></div>
                    {f.own && f.order && onWithdrawBuild
                      ? <button onClick={() => { onWithdrawBuild(f.order!); setFacPop(null); }} className="mt-2.5 w-full rounded-md border border-brick px-2 py-1.5 font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-brick">Withdraw {f.overruled ? "my proposal" : "this build"}</button>
                      : <div className="mt-2 text-[0.64rem] italic leading-snug text-inksoft">{teamBuildCopy(f.order)}</div>}
                  </>
                );
                return <AnchoredPopover stage={stageRef} at={p} width={214} label={`${label} · ${ec?.label ?? f.district}`} onClose={() => setFacPop(null)}>{body}</AnchoredPopover>;
              }
              if (!fp || !f || !t || f.pending) return null;
              const ec = dByKey(f.district); const p = pct(fp.cx, fp.cy, fp.h, "map");
              const prod = t.production_capacity ?? t.capacity_contribution ?? 0;
              const condNow = view.own.facilities?.find((x) => x.id === f.id)?.condition ?? 1;
              const maintaining = !!actions.maintain[f.id]; const divesting = actions.divests.includes(f.id);
              const condColor = condNow > 0.6 ? "var(--color-hop)" : condNow > 0.35 ? "var(--color-gold)" : "var(--color-brick)";
              const body = (
                <>
                  <div className="flex items-baseline justify-between gap-2"><div className="flex items-center gap-2"><FacilityChip type={f.type} color={cssColor(youId)} size={20} mine /><div className="display text-[0.95rem] text-ink">{t.label}</div></div><button onClick={() => setFacPop(null)} className="border-none bg-none text-[0.8rem] text-inksoft">✕</button></div>
                  <div className="text-[0.7rem] italic text-inksoft">{ec?.label ?? f.district} · {f.active ? "running" : "mothballed"}</div>
                  <div className="mt-2 flex justify-between text-[0.8rem]"><span className="text-inksoft">Output</span><span className="tnum font-semibold text-hop">+{f.active ? fmt.int(prod * (ec?.out ?? 1)) : 0}/rd</span></div>
                  <div className="mt-1.5"><div className="flex justify-between text-[0.66rem] text-inksoft"><span>Condition</span><span className="tnum">{fmt.pct(condNow)}</span></div><div className="mt-0.5 h-1.5 overflow-hidden rounded" style={{ background: "var(--color-panel2)" }}><div style={{ height: "100%", width: `${Math.round(condNow * 100)}%`, background: condColor }} /></div></div>
                  <div className="mt-2 text-[0.66rem] leading-snug text-inksoft">{FAC_NOTE[f.type] ?? ""}</div>
                  <div className="mt-2.5 grid grid-cols-3 gap-1">
                    <button onClick={() => f.active && !divesting && toggleMaintain(f.id, f.type)} disabled={!f.active || divesting} className="rounded-md border px-1 py-1.5 font-mono text-[0.5rem] font-semibold uppercase tracking-wide disabled:opacity-40" style={{ borderColor: maintaining ? "var(--color-hop)" : "var(--color-line2)", color: maintaining ? "var(--color-hop)" : "var(--color-inksoft)" }}>{maintaining ? "✓ Maintain" : "Maintain"}</button>
                    <button onClick={() => !divesting && toggleFac(f.id)} disabled={divesting} className="rounded-md border border-line2 px-1 py-1.5 font-mono text-[0.5rem] font-semibold uppercase tracking-wide text-inksoft disabled:opacity-40">{f.active ? "Mothball" : "Reopen"}</button>
                    <button onClick={() => toggleDivest(f.id)} className="rounded-md border px-1 py-1.5 font-mono text-[0.5rem] font-semibold uppercase tracking-wide" style={{ borderColor: divesting ? "var(--color-line2)" : "var(--color-brick)", color: divesting ? "var(--color-inksoft)" : "var(--color-brick)" }}>{divesting ? "Keep" : "Divest"}</button>
                  </div>
                </>
              );
              // DW-079: a top-layer popover anchored to the facility (bottom sheet on a phone) — see AnchoredPopover
              return <AnchoredPopover stage={stageRef} at={p} width={214} label={`${t.label} · ${ec?.label ?? f.district}`} onClose={() => setFacPop(null)}>{body}</AnchoredPopover>;
            })()}

            {/* on-map lease popover — click a FOR-LEASE parcel to build right there (design's sitePop) */}
            {plan && siting && siting.lot && (() => {
              const st = siting; if (!st.lot) return null;
              const Lz = plan.leases.find((x) => x.lot === st.lot); if (!Lz) return null;
              const d = dByKey(st.district ?? ""); const z = ZONE_OF[d?.kind ?? ""] ?? { zone: "", allow: [] as string[] };
              const p = pct(Lz.cx, Lz.cy, 4, "map"); const selType = st.type; const selOk = !!selType && z.allow.includes(selType);
              const capex = selType ? typeOf(selType)?.base_cost ?? 0 : 0;
              // Queued spend counts queued bids too, and THIS order must cover capex + its
              // own bid — otherwise "Build" can pass while cash < capex + premium.
              const queuedSpend = actions.builds.reduce((s, b) => s + (typeOf(b.type)?.base_cost ?? 0) + (b.bid ?? 0), 0);
              const afford = view.own.cash - queuedSpend >= capex + (st.bid ?? 0); const can = selOk && afford;
              const body = (
                <>
                  <div className="flex items-baseline justify-between gap-2"><div className="display text-[0.9rem] text-ink">Lease · {d?.label ?? st.district}</div><button onClick={() => setSiting(null)} className="border-none bg-none text-[0.8rem] text-inksoft">✕</button></div>
                  <div className="text-[0.68rem] italic text-inksoft">{z.zone}{d ? ` · rent ×${d.rent.toFixed(2)} · output ×${d.out.toFixed(2)}` : ""} · choose what to build</div>
                  {/* internal scroll: a long type list must never grow the popover past the
                      viewport (it has nowhere to go but up, under the sticky tab nav) */}
                  <div className="mt-2 grid max-h-44 gap-1 overflow-y-auto pr-0.5">
                    {facTypes.filter((t) => z.allow.includes(t.id)).map((t) => { const on = selType === t.id; const canAfford = view.own.cash - queuedSpend >= t.base_cost; return (
                      <button key={t.id} onClick={() => setSiting({ ...st, type: t.id })} className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left" style={{ borderColor: on ? "var(--color-copperdeep)" : "var(--color-line2)", background: on ? "color-mix(in srgb, var(--color-copper) 10%, var(--color-panel))" : "var(--color-panel)" }}>
                        <FacilityChip type={t.id} color={cssColor(youId)} size={18} />
                        <span className="min-w-0 flex-1"><span className="block truncate text-[0.8rem] font-semibold text-ink">{t.label}</span><span className="block text-[0.54rem] text-inksoft">{fmt.money(t.fixed_cost * (d?.rent ?? 1))}/rd upkeep</span></span>
                        <span className="tnum shrink-0 text-right text-[0.62rem] leading-tight" style={{ color: canAfford ? "var(--color-copperdeep)" : "var(--color-brick)" }}>{fmt.money(t.base_cost)}<span className="block text-[0.5rem] font-normal text-inksoft">to build</span></span>
                      </button>
                    ); })}
                  </div>
                  {/* Site competition: if a rival goes for this same parcel this round, the
                      higher premium wins it — only the winner pays. No premium = you lose
                      any contested tie. (The auction is engine-side; see facilities.ts.) */}
                  {selType && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-line2 bg-panel2 px-2.5 py-1.5">
                      <div className="min-w-0">
                        <div className="font-mono text-[0.52rem] uppercase tracking-wide text-inksoft">Bid premium · optional</div>
                        <div className="text-[0.58rem] leading-snug text-inksoft">If a rival wants this parcel too, the higher bid takes it — only the winner pays.</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1"><span className="text-[0.7rem] text-inksoft">$</span><input type="number" min="0" step="1000" value={st.bid ?? 0} onChange={(e) => setSiting((s) => (s ? { ...s, bid: Math.max(0, +e.target.value) } : s))} className="w-20 text-right text-[0.7rem]" /></div>
                    </div>
                  )}
                  <button onClick={build} disabled={!can} className="tt-btn tt-btn--go mt-2.5 w-full py-2 text-[0.62rem]" style={{ opacity: can ? 1 : 0.55, cursor: can ? "pointer" : "not-allowed", filter: can ? undefined : "grayscale(0.4)" }}>{!selType ? "Pick a type" : !selOk ? "Not permitted here" : !afford ? "Not enough cash" : `Build · ${fmt.money(capex)}${st.bid ? ` + ${fmt.money(st.bid)} bid` : ""}`}</button>
                </>
              );
              // DW-079: top-layer popover anchored to the parcel (bottom sheet on a phone). Inside the map
              // it sat under the sticky tab bar whenever it rose above the map — see AnchoredPopover.
              return <AnchoredPopover stage={stageRef} at={p} width={224} label={`Lease · ${d?.label ?? st.district}`} onClose={() => setSiting(null)}>{body}</AnchoredPopover>;
            })()}

            {sel.entered && facOn && selSites === 0 && !siting && !facPop && (
              <div className="absolute bottom-3 left-1/2 z-[7] hidden -translate-x-1/2 items-center gap-2 rounded-lg px-4 py-2 text-sm sm:flex" style={{ background: "var(--color-ink)", color: "var(--color-paper)" }}>
                <span className="font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-gold">New market</span>
                You're in {sel.name} — click a FOR LEASE lot to site your first facility.
              </div>
            )}
          </div>
        </div>

        {sel.entered && facOn && selSites === 0 && !siting && !facPop && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm sm:hidden" style={{ background: "var(--color-ink)", color: "var(--color-paper)" }}>
            <span className="mt-0.5 font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-gold">New market</span>
            <span>You're in {sel.name} — tap a lease pin to site your first facility.</span>
          </div>
        )}
        {/* legend */}
        <div className="flex flex-wrap items-center gap-3.5 text-sm text-inksoft">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: firmColor(youId) }} />Your sites</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-inksoft)" }} />Rivals</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-copperdeep" style={{ background: "rgba(224,165,47,.32)" }} />For lease</span>
          {sel.mine.some((f) => f.pending && !f.overruled) && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border-2 border-dashed" style={{ borderColor: "#7e3f18" }} />Breaking ground</span>}
          {sel.mine.some((f) => f.overruled) && <span className="flex items-center gap-1.5 text-brick"><span className="grid h-3 w-3 place-items-center rounded-full font-mono text-[0.45rem] font-bold leading-none text-white" style={{ background: "var(--color-brick)" }}>✕</span>Not in the team plan</span>}
          <span className="flex-1" />
          <span className="italic">{legendNote}</span>
        </div>
      </main>

      {/* ░░ RIGHT RAIL — market · demand · facilities · districts · siting ░░ */}
      <aside className="scl flex flex-col gap-3 lg:max-h-[84vh] lg:overflow-y-auto">
        {/* selected market header */}
        <section className="card p-4">
          <div className="font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">{selKindLabel}</div>
          <div className="display text-2xl leading-none text-ink">{sel.name}</div>
          <div className="text-sm italic text-inksoft">{sel.region}{sel.kind === "export" ? ` · FX ${sel.fx.toFixed(2)}` : ""}</div>
          {sel.entered ? (
            <div className="mt-3 flex gap-5">
              <div><div className="font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-faint" style={{ color: "var(--color-inksoft)" }}>City share</div><div className="tnum text-xl font-semibold text-copper">{fmt.pct(cityShare)}</div></div>
              <div><div className="font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-faint" style={{ color: "var(--color-inksoft)" }}>Your sites</div><div className="tnum text-xl font-semibold text-ink">{selSites}</div></div>
              <div><div className="font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-faint" style={{ color: "var(--color-inksoft)" }}>Segments led</div><div className="tnum text-xl font-semibold" style={{ color: leadCount > 0 ? "var(--color-hop)" : "var(--color-ink)" }}>{leadCount}<span className="text-sm text-inksoft">/{sel.segments.length}</span></div></div>
            </div>
          ) : (
            <div className="mt-3 rounded-[11px] border p-3" style={{ borderColor: "var(--color-gold)", background: "color-mix(in srgb, var(--color-gold) 12%, var(--color-panel))" }}>
              <div className="text-sm leading-relaxed text-inksoft">Not yet in this market. Entering commits a one-time entry cost and opens its districts for siting.</div>
              {entryNote(sel.id) && <div className="mt-1.5 text-sm leading-relaxed text-ink">{entryNote(sel.id)}</div>}
              <button onClick={() => setEntering(sel.id)} className="tt-btn tt-btn--go mt-2.5 w-full py-2.5 text-[0.72rem]">Enter market · {fmt.money(sel.entryCost)}</button>
            </div>
          )}
        </section>

        {sel.entered && (
          <>
            {/* local demand */}
            <section className="card p-4">
              <div className="mb-2 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">Local demand · who leads</div>
              {sel.segments.length === 0 ? <div className="text-sm italic text-inksoft">This market's demand opens once the season is underway.</div> : (
                <div className="flex flex-col gap-2.5">
                  {sel.segments.map((s) => { const meta = segMeta(s.id); const maxSize = Math.max(...sel.segments.map((x) => x.size), 1); return (
                    <div key={s.id} onMouseEnter={() => setHoverSeg(s.id)} onMouseLeave={() => setHoverSeg(null)}>
                      <div className="flex items-baseline gap-2">
                        <span className="h-2 w-2 flex-none rounded-sm" style={{ background: meta.hue }} />
                        <span className="flex-1 text-[0.95rem] font-semibold text-ink">{SEG_LABEL[s.id] ?? s.id}</span>
                        <span className="tnum text-[0.7rem] text-inksoft">{fmt.int(s.size)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 pl-[16px]">
                        <div className="relative h-1.5 flex-1 overflow-hidden rounded" style={{ background: "var(--color-panel2)" }}>
                          <span className="absolute inset-y-0 left-0" style={{ width: `${(s.size / maxSize) * 100}%`, background: meta.hue, opacity: 0.45 }} />
                          <span className="absolute inset-y-0 left-0" style={{ width: `${s.yourShare * 100}%`, background: "var(--color-copper)" }} />
                        </div>
                        <span className="whitespace-nowrap text-[0.72rem] italic text-inksoft">leader <span className="font-semibold not-italic text-ink">{leaderName(s.leader)}</span></span>
                      </div>
                    </div>
                  ); })}
                </div>
              )}
            </section>

            {/* your facilities here */}
            <section className="card p-4">
              <div className="mb-2 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">Your facilities here</div>
              {sel.mine.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {sel.mine.map((f) => { const t = typeOf(f.type); const ec = dByKey(f.district); return (
                    <div key={f.id} className="flex items-center gap-2.5 rounded-[9px] border border-line2 px-2.5 py-2" style={{ opacity: f.active ? 1 : 0.6 }}>
                      <button onClick={() => setFacPop(f.id)} onMouseEnter={() => setHoverFac(f.id)} onMouseLeave={() => setHoverFac(null)} className="flex flex-1 items-center gap-2.5 border-none bg-none p-0 text-left" title="Open facility">
                        <FacilityChip type={f.type} color={cssColor(youId)} size={22} mine />
                        <div className="min-w-0 flex-1"><div className="text-[0.92rem] font-semibold text-ink">{t?.label ?? f.type}</div><div className={`text-[0.72rem] italic ${f.overruled ? "text-brick" : "text-inksoft"}`}>{ec?.label ?? f.district} · {f.pending ? (f.overruled ? "not in the team plan" : f.own ? "breaking ground" : "breaking ground · a teammate's") : f.active ? "running" : "mothballed"}</div></div>
                      </button>
                      {f.pending && f.own && f.order && onWithdrawBuild && <button onClick={() => onWithdrawBuild(f.order!)} className="rounded-[7px] border border-brick px-2 py-1 font-mono text-[0.55rem] font-semibold uppercase tracking-wide text-brick">Withdraw</button>}
                      {!f.pending && <button onClick={() => toggleFac(f.id)} className="rounded-[7px] border px-2 py-1 font-mono text-[0.55rem] font-semibold uppercase tracking-wide" style={{ borderColor: f.active ? "var(--color-inksoft)" : "var(--color-hop)", color: f.active ? "var(--color-inksoft)" : "var(--color-hop)" }}>{f.active ? "Mothball" : "Reopen"}</button>}
                    </div>
                  ); })}
                </div>
              ) : (
                <div className="text-sm italic text-inksoft">No sites here yet — lease a parcel below.</div>
              )}
            </section>

            {/* districts · siting tradeoffs */}
            <section className="card p-4">
              <div className="mb-2 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">Districts · siting tradeoffs</div>
              <div className="flex flex-col gap-1.5">
                {sel.districts.map((d) => { const sites = sel.mine.filter((f) => f.district === d.key && !f.pending).length; return (
                  <div key={d.key} className="rounded-[9px] border border-line2 px-2.5 py-2">
                    <div className="flex items-baseline justify-between gap-2"><span className="text-[0.92rem] font-semibold text-ink">{d.label}</span><span className="font-mono text-[0.5rem] font-semibold uppercase tracking-wide text-copperdeep">{sites} yours</span></div>
                    <div className="text-[0.72rem] italic text-inksoft">{d.best}</div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className="rounded-[6px] border border-line2 px-1.5 py-px font-mono text-[0.58rem]" style={{ color: d.rent > 1.05 ? "var(--color-brick)" : d.rent < 0.95 ? "var(--color-hop)" : "var(--color-inksoft)" }}>Rent ×{d.rent.toFixed(2)}</span>
                      <span className="rounded-[6px] border border-line2 px-1.5 py-px font-mono text-[0.58rem]" style={{ color: d.out > 1.02 ? "var(--color-hop)" : d.out < 0.98 ? "var(--color-brick)" : "var(--color-inksoft)" }}>Output ×{d.out.toFixed(2)}</span>
                      <span className="rounded-[6px] border border-line2 px-1.5 py-px font-mono text-[0.58rem]" style={{ color: d.brand ? "var(--color-aero)" : "var(--color-inksoft)" }}>{d.brand ? `+${d.brand} brand` : "no brand draw"}</span>
                    </div>
                  </div>
                ); })}
              </div>
            </section>

            {/* site a facility (inline) */}
            {facOn && (
              <section className="card p-4">
                <div className="mb-1 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">Site a facility</div>
                {siting && siting.lot ? (() => {
                  const d = dByKey(siting.district ?? "")!; const z = ZONE_OF[d?.kind ?? ""] ?? { zone: "", allow: [] as string[] };
                  const lotObj = lotCoord.get(siting.lot); const ct = crowdTone(lotObj ? crowdAtLot(lotObj) : 0);
                  const selType = siting.type; const selOk = !!selType && z.allow.includes(selType);
                  const capex = selType ? typeOf(selType)?.base_cost ?? 0 : 0;
                  const queuedSpend = actions.builds.reduce((s, b) => s + (typeOf(b.type)?.base_cost ?? 0) + (b.bid ?? 0), 0);
                  const afford = selOk && view.own.cash - queuedSpend >= capex + (siting.bid ?? 0); const can = selOk && afford;
                  return (
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-sm italic text-inksoft">On <span className="font-semibold not-italic text-ink">{d?.label ?? siting.district}</span> · {z.zone}</span>
                        <button onClick={() => openSiting(siting.district)} className="border-none bg-none p-0 font-mono text-[0.55rem] uppercase tracking-wide text-inksoft">← change parcel</button>
                      </div>
                      <div className="mb-2 flex flex-wrap gap-1">
                        <span className="rounded border border-line2 bg-panel2 px-1.5 py-px font-mono text-[0.58rem] text-inksoft">Rent ×{d.rent.toFixed(2)}</span>
                        <span className="rounded border border-line2 bg-panel2 px-1.5 py-px font-mono text-[0.58rem] text-inksoft">Out ×{d.out.toFixed(2)}</span>
                        <span className="rounded border border-line2 bg-panel2 px-1.5 py-px font-mono text-[0.58rem] text-aero">{d.brand > 0 ? `Brand +${d.brand}` : "No brand"}</span>
                        <span className="flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[0.58rem]" style={{ borderColor: ct.color, color: ct.color }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: ct.color }} />{ct.label}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {facTypes.map((t) => { const allowed = z.allow.includes(t.id), isSel = selType === t.id, canAfford = view.own.cash - queuedSpend >= t.base_cost; return (
                          <button key={t.id} onClick={() => allowed && setSiting({ ...siting, type: t.id })} disabled={!allowed} className="rounded-[10px] border p-2.5 text-left transition-colors" style={{ borderColor: !allowed ? "var(--color-line2)" : isSel ? "var(--color-copperdeep)" : "var(--color-line)", background: !allowed ? "color-mix(in srgb, var(--color-panel2) 50%, transparent)" : isSel ? "color-mix(in srgb, var(--color-copper) 10%, var(--color-panel))" : "var(--color-panel)", opacity: allowed ? 1 : 0.5, cursor: allowed ? "pointer" : "not-allowed" }}>
                            <div className="flex items-center gap-2.5">
                              <FacilityChip type={t.id} color={cssColor(youId)} size={22} />
                              <span className="display flex-1 text-[0.88rem] text-ink">{t.label}</span>
                              <span className="tnum text-[0.78rem] font-semibold" style={{ color: !allowed ? "var(--color-inksoft)" : canAfford ? "var(--color-ink)" : "var(--color-brick)" }}>{fmt.money(t.base_cost)}</span>
                            </div>
                            <div className="mt-1 flex gap-3 pl-[33px] text-[0.7rem] text-inksoft">
                              <span>Output <b className="tnum text-hop">+{fmt.int((t.production_capacity ?? t.capacity_contribution ?? 0) * d.out)}</b></span>
                              <span>Retail <b className="tnum" style={{ color: (t.retail_draw ?? 0) > 0 ? "var(--color-aero)" : "var(--color-inksoft)" }}>{(t.retail_draw ?? 0) > 0 ? `+${fmt.int(t.retail_draw ?? 0)}` : "—"}</b></span>
                              <span>Fixed <b className="tnum text-ink">{fmt.money(t.fixed_cost * d.rent)}</b>/rd</span>
                            </div>
                            {!allowed && <div className="mt-1 pl-[33px] text-[0.66rem] text-brick">✕ Not permitted in {z.zone} zone</div>}
                          </button>
                        ); })}
                      </div>
                      {selType && (
                        <div className="mt-2.5 flex items-center justify-between gap-2 rounded-[10px] border border-line2 bg-panel2 px-3 py-2">
                          <div><div className="font-mono text-[0.55rem] uppercase tracking-wide text-inksoft">Bid premium (optional)</div><div className="text-[0.62rem] text-inksoft">Outbid rivals for a contested parcel</div></div>
                          <div className="flex items-center gap-1"><span className="text-inksoft">$</span><input type="number" min="0" step="10" value={siting.bid ?? 0} onChange={(e) => setSiting((s) => (s ? { ...s, bid: Math.max(0, +e.target.value) } : s))} className="w-20 text-right" /></div>
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => setSiting(null)} className="rounded-[10px] border border-line2 bg-panel2 px-3 py-2.5 font-mono text-[0.6rem] font-semibold uppercase tracking-wide text-inksoft">Cancel</button>
                        <button onClick={build} disabled={!can} className="tt-btn tt-btn--go flex-1 py-2.5 text-[0.7rem]" style={{ opacity: can ? 1 : 0.55, cursor: can ? "pointer" : "not-allowed", filter: can ? undefined : "grayscale(0.5)" }}>{!selType ? "Pick a type" : !selOk ? "Not permitted" : !afford ? "Not enough cash" : `Build · ${fmt.money(capex)}${siting.bid ? ` + ${fmt.money(siting.bid)} bid` : ""}`}</button>
                      </div>
                    </div>
                  );
                })() : (
                  <div>
                    <div className="mb-2 text-sm italic text-faint" style={{ color: "var(--color-inksoft)" }}>Lease an open parcel — crowd preview shows the catchment competition.</div>
                    {availLots.length === 0 ? (
                      <div className="text-sm italic text-inksoft">Every unlocked parcel here is taken.</div>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {availLots.map((L) => { const d = dByKey(L.district); const z = ZONE_OF[d?.kind ?? ""]; const ct = crowdTone(crowdAtLot(L)); return (
                          <button key={L.id} onClick={() => setSiting({ lot: L.id, district: L.district, type: null })} className="flex items-center gap-2.5 rounded-[9px] border border-line2 bg-panel3 px-2.5 py-2 text-left" style={{ background: "var(--color-panel)" }}>
                            <span className="h-2 w-2 flex-none rounded-full" style={{ background: ct.color }} />
                            <div className="min-w-0 flex-1"><div className="text-[0.9rem] font-semibold text-ink">{d?.label ?? L.district}</div><div className="text-[0.72rem] italic text-inksoft">{z?.zone ?? ""}</div></div>
                            <span className="font-mono text-[0.55rem] font-semibold uppercase tracking-wide" style={{ color: ct.color }}>{ct.label}</span>
                          </button>
                        ); })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}

            {/* distribution */}
            <section className="card p-4">
              {flow && (() => { const fb = shipBadge(sel.id); const ship = (flow.lanes ?? []).reduce((a, L) => a + L.cost, 0); return (
                <div className="mb-2.5">
                  <div className="font-mono text-[0.5rem] uppercase tracking-[0.12em] text-inksoft">This market · last round</div>
                  <div className="mt-1 flex items-center justify-between text-[0.78rem] text-inksoft"><span>Brewed here <b className="tnum text-ink">{fmt.int(flow.produced)}</b></span><span>Sold <b className="tnum text-ink">{fmt.int(flow.q_sold)}</b></span></div>
                  <div className="mt-1 flex items-center justify-between"><span className="font-mono text-[0.62rem] font-bold" style={{ color: fb.tone === "out" ? "var(--color-copper)" : fb.tone === "in" ? "var(--color-aero)" : "var(--color-inksoft)" }}>{fb.text}</span>{ship > 0 && <span className="font-mono text-[0.62rem] font-bold text-brick">−{fmt.money(ship)} shipping</span>}</div>
                </div>
              ); })()}
              <button onClick={() => { setLayer("trade"); setDrawerOpen(true); }} className="w-full rounded-[10px] border border-line2 bg-panel py-2 font-mono text-[0.62rem] font-semibold uppercase tracking-wide text-inksoft">Supply &amp; lanes ↗</button>
              <div className="mt-2 text-center font-mono text-[0.55rem] text-inksoft">{offered(sel.id) ? `Supply offered here: ${fmt.int(offers[sel.id])} units` : anyOffer ? `Supply routed here: ${fmt.pct((presence[sel.id] ?? 0) / autoPresence)} of what your offers leave` : `Supply routed here: ${fmt.pct((presence[sel.id] ?? 0) / totalPresence)}`}</div>
            </section>
          </>
        )}
      </aside>

      {/* ░░ overlays ░░ */}
      {/* entry modal */}
      {entering && (() => { const ec = cities.find((c) => c.id === entering); if (!ec) return null; const can = view.own.cash >= ec.entryCost; return (
        <div role="dialog" aria-modal="true" onClick={() => setEntering(null)} className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(44,29,17,.4)", backdropFilter: "blur(3px)" }}>
          <div onClick={(e) => e.stopPropagation()} className="w-[420px] max-w-[94vw] overflow-hidden rounded-2xl border border-line2 bg-panel" style={{ boxShadow: "0 18px 50px rgba(40,25,8,.4)" }}>
            <div className="h-1.5" style={{ background: "linear-gradient(90deg,var(--color-gold),var(--color-copper))" }} />
            <div className="px-5 py-5">
              <div className="font-mono text-[0.55rem] font-semibold uppercase tracking-[0.16em] text-copperdeep">{ec.region} · new market</div>
              <div className="display text-2xl leading-none text-ink">Enter {ec.name}</div>
              <div className="mt-2 text-sm text-inksoft">A one-time entry cost opens this city; capacity then routes here and you can site facilities into its districts. It commits when you brew this round. Local demand:</div>
              {entryNote(ec.id) && <div className="mt-2 text-sm text-ink">{entryNote(ec.id)}</div>}
              <div className="my-3.5 flex flex-col gap-1.5">
                {ec.segments.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <span className="h-2 w-2 flex-none rounded-full" style={{ background: segMeta(s.id).hue }} />
                    <span className="flex-1 text-sm text-ink">{SEG_LABEL[s.id] ?? s.id}</span>
                    <span className="tnum text-[0.7rem] text-inksoft">{fmt.int(s.size)}</span>
                    <span className="w-24 text-right font-mono text-[0.58rem] text-inksoft">led by {leaderName(s.leader)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-line pt-3.5">
                <div><div className="font-mono text-[0.55rem] uppercase tracking-wide text-inksoft">Entry cost</div><div className="tnum text-xl font-bold" style={{ color: can ? "var(--color-ink)" : "var(--color-brick)" }}>{fmt.money(ec.entryCost)}</div></div>
                <div className="flex gap-2">
                  <button onClick={() => setEntering(null)} className="rounded-lg border border-line2 bg-panel2 px-4 py-2.5 text-sm font-semibold text-inksoft">Not now</button>
                  <button onClick={() => commitEnter(ec.id)} disabled={!can} className="tt-btn tt-btn--go px-5 py-2.5 text-xs" style={{ opacity: can ? 1 : 0.6, cursor: can ? "pointer" : "not-allowed" }}>{can ? "Enter market" : "Not enough cash"}</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ); })()}


      {/* distribution drawer — DW-082d: last round's flows (brewed, sent, sold, shipped from where), then,
          apart from them, this round's offers. It read as one picture: "ships 21600" was brewed − sold
          (beer left unsold counted as shipped), nothing said which round, and the offer boxes sat on
          last round's numbers as if they set them. */}
      {drawerOpen && (() => {
        const mk = view.ownResult?.markets ?? null;
        const rows = cities.filter((c) => c.entered).map((c) => { const m = mk?.[c.id]; return { id: c.id, name: c.name, brewed: m?.produced ?? 0, drunk: m?.q_sold ?? 0, sent: m?.supplied, lanes: m?.lanes ?? [] }; });
        const maxv = Math.max(1, ...rows.map((r) => Math.max(r.brewed, r.drunk)));
        const nameOf = (id: string) => cities.find((c) => c.id === id)?.name ?? id;
        const hadRound = rows.some((r) => r.brewed > 0 || r.drunk > 0);
        const lastSupply = rows.some((r) => r.sent != null) ? rows.reduce((a, r) => a + (r.sent ?? 0), 0) : rows.reduce((a, r) => a + r.brewed, 0);
        const offerTotal = Object.values(offers).reduce((a, b) => a + b, 0);
        const nowMarkets = cities.filter((c) => presence[c.id] != null);
        const setOffer = (id: string, v: string) => setActions((a) => { const supply = { ...(a.supply ?? carriedSupply ?? {}) }; if (!v) delete supply[id]; else supply[id] = Math.max(0, +v); return { ...a, supply }; });
        return (
        <>
          <div onClick={() => setDrawerOpen(false)} className="fixed inset-0 z-50" style={{ background: "rgba(44,29,17,.3)" }} />
          <aside role="dialog" aria-modal="true" className="dwslide scl fixed bottom-0 right-0 top-0 z-50 w-[360px] max-w-[94vw] overflow-y-auto border-l border-line2 bg-panel" style={{ boxShadow: "-14px 0 40px rgba(40,25,8,.24)" }}>
            <div className="sticky top-0 z-[2] flex items-start gap-2.5 border-b border-line bg-panel px-5 py-4">
              <div className="flex-1"><div className="font-mono text-[0.55rem] uppercase tracking-[0.16em] text-copperdeep">Distribution · transportation</div><div className="display text-xl text-ink">Supply &amp; lanes</div></div>
              <button onClick={() => setDrawerOpen(false)} className="border-none bg-none text-lg text-inksoft">✕</button>
            </div>
            <div className="px-5 py-4">
              <div className="mb-1 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">Last round</div>
              <div className="mb-3 text-sm text-inksoft">Where you <b className="text-copperdeep">can brew</b> (left of the line) and where you <b style={{ color: "var(--color-aero)" }}>sold</b> (right). Beer sold beyond what a city can brew ships in from your nearest brewery — a lane you pay for, per unit and per mile.</div>
              {!hadRound ? <div className="mb-2 text-sm italic text-inksoft">No resolved round yet — flows appear once the first round closes.</div> : rows.map((r) => {
                const fb = shipBadge(r.id);
                // pre-ship 10-29: an offer puts beer ON SALE and a lane carries only what sells — "65,000 sent here" beside
                // "shipped in 23,420" read as a lost shipment; and "brewed" was capacity (beer is brewed to what sells)
                const unsold = r.sent != null ? Math.max(0, r.sent - r.drunk) : 0;
                const soldOut = r.sent != null && r.sent > 0 && unsold < 1;
                return (
                  <div key={r.id} className="mb-3.5">
                    <div className="mb-1 flex items-baseline justify-between gap-2">
                      <button onClick={() => setSelId(r.id)} className="display text-sm" style={{ color: r.id === sel.id ? "var(--color-copperdeep)" : "var(--color-ink)" }}>{r.name}</button>
                      <span className="font-mono text-[0.6rem] font-bold" style={{ color: fb.tone === "out" ? "var(--color-copper)" : fb.tone === "in" ? "var(--color-aero)" : "var(--color-inksoft)" }}>{fb.text}</span>
                    </div>
                    <div className="relative h-3.5 rounded-[3px]" style={{ background: "var(--color-panel2)" }}>
                      <div className="absolute bottom-0 top-0 rounded-l-[3px]" style={{ right: "50%", width: `${(r.brewed / maxv) * 50}%`, background: "var(--color-copper)" }} />
                      <div className="absolute bottom-0 top-0 rounded-r-[3px]" style={{ left: "50%", width: `${(r.drunk / maxv) * 50}%`, background: "var(--color-aero)" }} />
                      <div className="absolute -bottom-0.5 -top-0.5 left-1/2 w-px -translate-x-1/2" style={{ background: "var(--color-inksoft)" }} />
                    </div>
                    <div className="mt-1 text-[0.68rem] leading-snug text-inksoft">
                      can brew <b className="tnum text-ink">{fmt.int(r.brewed)}</b> · sold <b className="tnum text-ink">{fmt.int(r.drunk)}</b>
                      {soldOut ? <> · <b className="text-hop">sold out</b> — you might have sold more here</> : unsold >= 1 ? <> · {fmt.int(r.sent ?? 0)} on sale here, <b className="text-brick">{fmt.int(unsold)} not bought</b></> : null}
                    </div>
                    {r.lanes.map((L, i) => (<div key={i} className="text-[0.68rem] leading-snug text-inksoft">shipped from {nameOf(L.origin_market)} <b className="tnum text-ink">{fmt.int(L.units)}</b> · lane cost <b className="tnum text-brick">−{fmt.money(L.cost)}</b></div>))}
                  </div>
                );
              })}
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-1 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">This round · where your beer goes</div>
                <div className="mb-2.5 text-[0.7rem] leading-snug text-inksoft">Leave a market on <b className="text-ink">auto</b> and your beer splits across your markets by presence — home counts most, a new market starts with a foothold, and brewing you site in a market raises its share. Or type an <b className="text-ink">offer</b> — a number of units, not a percent: that many go on sale there (shoppers decide how many sell, and only what sells is shipped), and the auto markets share what's left. An offer stays in force every round until you clear it.{lastSupply > 0 && <> Last round you had <b className="tnum text-ink">{fmt.int(lastSupply)}</b> units to sell.</>}</div>
                {/* DW-082e: the shares read in %, the box takes units — say so (playtest 10-28) */}
                {nowMarkets.length > 0 && <div className="mb-1 flex items-center gap-2 font-mono text-[0.5rem] uppercase tracking-[0.12em] text-inksoft"><span className="flex-1">Market</span><span>Share</span><span className="w-20 text-right">Offer · units</span></div>}
                {nowMarkets.map((c) => (
                  <div key={c.id} className="mb-1.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[0.8rem] text-ink">{c.name}</span>
                    <span className="tnum font-mono text-[0.6rem] text-inksoft">{offered(c.id) ? (lastSupply > 0 ? `offer · ≈${fmt.pct(offers[c.id] / lastSupply)} of last round's` : "offer") : anyOffer ? `auto · ${fmt.pct((presence[c.id] ?? 0) / autoPresence)} of the rest` : `auto · ${fmt.pct((presence[c.id] ?? 0) / totalPresence)}`}</span>
                    <input type="number" min="0" step="10" placeholder="auto" value={offers[c.id] ?? ""} onChange={(e) => setOffer(c.id, e.target.value)} className="w-20 !py-0.5 text-right text-[0.7rem]" title={`Units to put on sale in ${c.name} this round — blank for auto`} aria-label={`Units on sale in ${c.name}`} />
                  </div>
                ))}
                {offerTotal > 0 && lastSupply > 0 && offerTotal > lastSupply && <div className="mt-1 text-[0.64rem] leading-snug text-brick">Your offers add up to more than you had to sell last round. If they exceed what you can brew, every offer is scaled down to fit, and markets on auto get nothing.</div>}
              </div>
            </div>
          </aside>
        </>
        );
      })()}

      {globeOpen && <GlobeOverlay cities={cities} homeGeo={homeGeo} onClose={() => setGlobeOpen(false)} onPick={(id) => { setGlobeOpen(false); selectCity(id); }} />}
    </div>
  );
}

// ═══════════════════════ Founding site picker ═══════════════════════
// The create-a-firm "where do I open?" surface — the same isometric home map, driven straight
// from CONFIG (no live game yet) so the founding choice sees the exact rent × output × brand ×
// zoning tradeoff it will pay all season. Reuses cityPlan/drawCity; a lot click (or a district
// card) reports the chosen spot back to the firm builder, which stores it on the founding facility.

export interface FoundingPlacement { type: string; lot?: string; district?: string }

/** A CityModel for the home market built from config alone. `placed` founding facilities show as
 *  pending (their lots read taken). No rivals/standings — founding is before the field exists. */
function foundingCityModel(cfg: Config, placed: FoundingPlacement[]): CityModel {
  const meta = MARKET_META.home ?? { city: "Home region", region: "", geo: [0, 0] as [number, number], coast: null, seed: 7 };
  const dCfg = cfg.modules?.facilities?.districts ?? [];
  const districts: DistrictModel[] = dCfg.map((d) => ({
    key: d.id, label: d.label, arch: ARCH_OF[d.kind] ?? "arts", kind: d.kind,
    rent: d.rent_mult, out: d.capacity_mult ?? 1, brand: d.brand_boost ?? 0, best: DISTRICT_BEST[d.id] ?? d.blurb ?? "",
  }));
  const fallback = districts[0]?.key ?? "downtown";
  const homeMkt = cfg.modules?.geography?.markets?.find((m) => m.kind === "home");
  const rawLots = (homeMkt?.lots ?? []).filter((L) => (L.unlock_round ?? 0) <= 0);
  const districtOfLot = (id?: string) => rawLots.find((L) => L.id === id)?.district;
  const lots: MarketLot[] = rawLots.map((L) => ({ id: L.id, x: L.x, y: L.y, district: L.district, unlocked: true, occupant: null }));
  const mine: MineModel[] = placed.map((p, i) => ({ id: `founding_${i}`, type: p.type, district: p.district ?? districtOfLot(p.lot) ?? fallback, lot: p.lot, active: true, pending: true }));
  return {
    id: "home", name: meta.city, region: meta.region || "Home region", kind: "home",
    entered: true, entryCost: 0, fx: 1, geo: meta.geo, coast: meta.coast, seed: meta.seed, roadEvery: 4,
    districts, mine, rivals: [], segments: [], lots, catchment: cfg.modules?.facilities?.catchment,
  };
}

const crowdTag = (cr: number): { label: string; color: string } =>
  cr < 0.25 ? { label: "Blue ocean", color: "var(--color-hop)" } : cr < 0.9 ? { label: "Some competition", color: "var(--color-gold)" } : { label: "Crowded", color: "var(--color-brick)" };

export function FoundingSiteMap({ cfg, color, placed, sitingType, onPick }: {
  cfg: Config;
  color: string;
  placed: FoundingPlacement[];
  sitingType: string | null; // the facility TYPE being sited right now
  onPick: (loc: { lot?: string; district: string }) => void;
}) {
  const dCfg = useMemo(() => cfg.modules?.facilities?.districts ?? [], [cfg]);
  const facTypes = useMemo(() => cfg.modules?.facilities?.types ?? [], [cfg]);
  const typeOf = (id: string | null) => facTypes.find((t) => t.id === id);
  const t = typeOf(sitingType);
  const model = useMemo(() => foundingCityModel(cfg, placed), [cfg, placed]);
  const plan = useMemo(() => cityPlan(model), [model]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const draw = () => { if (canvasRef.current) try { drawCity(canvasRef.current, plan, "map", "you", color); } catch { /* ignore */ } };
    const id = window.setTimeout(draw, 0);
    window.addEventListener("resize", draw);
    return () => { clearTimeout(id); window.removeEventListener("resize", draw); };
  }, [plan, color]);

  const dByKey = (k: string) => model.districts.find((d) => d.key === k);
  const zoneOf = (kind?: string) => ZONE_OF[kind ?? ""] ?? { zone: "", allow: [] as string[] };
  const allowsType = (kind?: string) => !sitingType || zoneOf(kind).allow.includes(sitingType);
  // Recommended home for the type being sited: the best-fit zoning-permitted district that still
  // has a free parcel (falls through to the next district if the best one is full).
  const ranked = t ? rankDistrictsForType(t, dCfg) : [];
  const freeLotsIn = (key: string) => plan.leases.filter((L) => L.district === key);
  const recDistrict = ranked.find((d) => freeLotsIn(d.id).length > 0)?.id ?? ranked[0]?.id ?? null;
  const recLot = recDistrict ? (freeLotsIn(recDistrict).slice().sort((a, b) => a.crowd - b.crowd)[0]?.lot ?? null) : null;

  const pickLot = (lot: string, district: string) => { if (allowsType(dByKey(district)?.kind)) onPick({ lot, district }); };
  const pickDistrict = (key: string) => {
    if (!allowsType(dByKey(key)?.kind)) return;
    const free = freeLotsIn(key).slice().sort((a, b) => a.crowd - b.crowd)[0];
    onPick(free ? { lot: free.lot, district: key } : { district: key }); // no free lot ⇒ district-only (geography off)
  };

  const hasLots = model.lots.length > 0;

  return (
    <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* map stage — the same isometric home city as in play */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-copperdeep">Home market · {model.name}</span>
          <span className="flex-1" />
          <span className="text-sm italic text-inksoft">{t ? `Siting your ${t.label.toLowerCase()}` : "Your footprint"}</span>
        </div>
        <div className="card relative w-full overflow-visible p-0" style={{ aspectRatio: "1000 / 680" }}>
          <div className="absolute inset-0 overflow-visible rounded-[14px]" style={{ background: PAL.mapbg }}>
            <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", borderRadius: 14 }} />

            {/* district labels + rent/output chips */}
            {plan.districts.map((d) => { const ec = dByKey(d.key); if (!ec) return null; const p = pct(d.cx, d.cy, 60, "map"); const ok = allowsType(ec.kind); return (
              <div key={d.key} className="pointer-events-none absolute z-[4] flex flex-col items-center gap-0.5" style={{ left: `${p.l}%`, top: `${p.t}%`, transform: "translate(-50%,-100%)", opacity: ok ? 1 : 0.4 }}>
                <div className="display whitespace-nowrap text-[0.8rem] tracking-[0.1em]" style={{ color: "rgba(44,29,17,.78)", textShadow: `0 1px 3px ${PAL.mapbg}, 0 0 6px ${PAL.mapbg}` }}>{ec.label}</div>
                <div className="flex items-center gap-1">
                  <span className="rounded border border-line bg-panel/90 px-1 py-px font-mono text-[0.55rem]" style={{ color: ec.rent > 1.05 ? "var(--color-brick)" : ec.rent < 0.95 ? "var(--color-hop)" : "var(--color-inksoft)" }} title="Rent multiplier on upkeep">R×{ec.rent.toFixed(2)}</span>
                  <span className="rounded border border-line bg-panel/90 px-1 py-px font-mono text-[0.55rem]" style={{ color: ec.out > 1.02 ? "var(--color-hop)" : ec.out < 0.98 ? "var(--color-brick)" : "var(--color-inksoft)" }} title="Output multiplier">O×{ec.out.toFixed(2)}</span>
                  {ec.brand > 0 && <span className="rounded border border-line bg-panel/90 px-1 py-px font-mono text-[0.55rem] text-aero" title="Brand draw per round">B+{ec.brand}</span>}
                </div>
              </div>
            ); })}

            {/* FOR-LEASE parcels — click to site the selected facility here */}
            {hasLots && plan.leases.map((L, i) => { const p = pct(L.cx, L.cy, 0, "map"); const ec = dByKey(L.district); const z = zoneOf(ec?.kind); const ct = crowdTag(L.crowd); const ok = allowsType(ec?.kind); const isRec = L.lot === recLot; return (
              <button key={i} onClick={() => pickLot(L.lot, L.district)} disabled={!ok} title={ok ? `Lease in ${ec?.label ?? L.district} · ${ct.label}${isRec ? " · recommended" : ""}` : `${t?.label ?? "This type"} can't be zoned in ${ec?.label ?? L.district}`} className="absolute z-[5] cursor-pointer border-none bg-none p-0 disabled:cursor-not-allowed" style={{ left: `${p.l}%`, top: `${p.t}%`, transform: "translate(-50%,-100%)", opacity: ok ? 1 : 0.32 }}>
                <span className="block rounded-t-[3px] border px-1.5 py-0.5 font-mono text-[0.5rem] font-bold uppercase tracking-wide text-white" style={{ background: isRec && ok ? "var(--color-hop)" : "var(--color-copperdeep)", borderColor: "#6e3914", boxShadow: isRec && ok ? "0 0 0 2px color-mix(in srgb, var(--color-hop) 50%, transparent)" : undefined }}>{isRec && ok ? "BEST" : "FOR LEASE"}</span>
                <span className="flex items-center justify-center gap-0.5 rounded-b-[3px] border border-t-0 px-1 py-px text-center font-mono text-[0.44rem] font-bold uppercase text-copperdeep" style={{ background: "#f3e6c8", borderColor: "#6e3914" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: ct.color }} />{z?.zone ?? ""}</span>
                <span className="mx-auto block h-2 w-px" style={{ background: "#6e3914" }} />
              </button>
            ); })}

            {/* already-placed founding facilities */}
            {plan.facilities.map((f) => { const p = pct(f.cx, f.cy, f.h, "map"); const ec = dByKey(f.district); const tt = typeOf(f.type); return (
              <div key={f.id} title={`${tt?.label ?? f.type} · ${ec?.label ?? f.district}`} className="pointer-events-none absolute z-[7] flex flex-col items-center" style={{ left: `${p.l}%`, top: `${p.t}%`, transform: "translate(-50%,-100%)", filter: "drop-shadow(0 3px 5px rgba(40,25,8,.32))" }}>
                <FacilityChip type={f.type} color={color} size={30} mine style={{ outline: "2px dashed #7e3f18", outlineOffset: 1 }} />
              </div>
            ); })}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-inksoft">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />Your sites</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-copperdeep" style={{ background: "rgba(224,165,47,.32)" }} />For lease</span>
          <span className="flex-1" />
          <span className="italic">{hasLots ? "Tap a parcel — or a district card — to site it" : "Tap a district to site it"}</span>
        </div>
      </div>

      {/* district tradeoff cards — the rent/output/brand economics, best fit first */}
      <div className="grid content-start gap-2">
        <div className="eyebrow">{t ? "Best fit for this facility" : "The districts"}</div>
        {(t ? [...model.districts].sort((a, b) => districtFitScore(t, dCfg.find((d) => d.id === b.key)!) - districtFitScore(t, dCfg.find((d) => d.id === a.key)!)) : model.districts).map((d) => {
          const ok = allowsType(d.kind); const isRec = d.key === recDistrict; const free = freeLotsIn(d.key).length;
          return (
            <button key={d.key} onClick={() => pickDistrict(d.key)} disabled={!ok || (hasLots && free === 0)} title={ok ? d.best : `Not zoned for ${t?.label ?? "this type"}`} className="rounded-xl border p-2.5 text-left transition-colors disabled:opacity-45" style={{ borderColor: isRec && ok ? "var(--color-hop)" : "var(--color-line2)", background: isRec && ok ? "color-mix(in srgb, var(--color-hop) 8%, var(--color-panel))" : "var(--color-panel)" }}>
              <div className="flex items-center gap-1.5">
                <span className="display text-[0.95rem] text-ink">{d.label}</span>
                {isRec && ok && <span className="rounded-full px-1.5 py-px font-mono text-[0.5rem] font-bold uppercase tracking-wide text-white" style={{ background: "var(--color-hop)" }}>Best</span>}
                <span className="flex-1" />
                {hasLots && <span className="font-mono text-[0.55rem] text-inksoft">{free} open</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className="rounded border border-line px-1 py-px font-mono text-[0.55rem]" style={{ color: d.rent > 1.05 ? "var(--color-brick)" : d.rent < 0.95 ? "var(--color-hop)" : "var(--color-inksoft)" }}>Rent ×{d.rent.toFixed(2)}</span>
                <span className="rounded border border-line px-1 py-px font-mono text-[0.55rem]" style={{ color: d.out > 1.02 ? "var(--color-hop)" : d.out < 0.98 ? "var(--color-brick)" : "var(--color-inksoft)" }}>Output ×{d.out.toFixed(2)}</span>
                {d.brand > 0 && <span className="rounded border border-line px-1 py-px font-mono text-[0.55rem] text-aero">Brand +{d.brand}</span>}
              </div>
              <div className="mt-1 text-[0.68rem] leading-snug text-inksoft">{ok ? d.best : `Zoning doesn't allow a ${t?.label.toLowerCase() ?? "facility"} here.`}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
