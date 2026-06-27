/**
 * The Tuning Board (design: "Instructor · Balance & tuning"). Labelled sliders grouped
 * Demand / Spatial / Trade / Conduct / Shocks / Difficulty, each with min·typical·max and
 * a live plain-language consequence; presets (forgiving / balanced / cutthroat) + save-your-
 * own; and a "How it'll play" panel of feel-meters + a demand-vs-price curve derived from the
 * knobs (UI affordances, not engine values). It produces a ConfigOverride the instructor
 * persists on a game — no engine change (the engine already accepts the override).
 *
 * The knobs are instructor-facing abstractions; `tuningToOverride` maps them to the REAL
 * engine fields (some multiplicative on the resolved default, some absolute, arrays rebuilt
 * whole because deepMerge replaces arrays). Difficulty knobs are feel-only — investScale /
 * bot aggression are single-player controller concerns, and field size is set on the form.
 */
import { useEffect, useMemo, useState } from "react";
import { resolveConfig } from "drinkwars-engine";
import type { ConfigOverride } from "drinkwars-engine";

type Tone = "calm" | "mid" | "hot";
interface Knob {
  key: string;
  label: string;
  min: number;
  max: number;
  typ: number;
  step?: number;
  toggle?: boolean;
  fmt: (v: number) => string;
  feel: (v: number) => { head: string; note: string; tone: Tone };
}
interface Group { id: string; label: string; kicker: string; blurb: string; knobs: Knob[] }

const calm = (head: string, note: string) => ({ head, note, tone: "calm" as Tone });
const mid = (head: string, note: string) => ({ head, note, tone: "mid" as Tone });
const hot = (head: string, note: string) => ({ head, note, tone: "hot" as Tone });

export const TUNING_GROUPS: Group[] = [
  {
    id: "demand", label: "Demand", kicker: "What buyers respond to", blurb: "How sensitive consumers are to price, quality and brand — and how easily they walk away.",
    knobs: [
      { key: "beta_p", label: "Price sensitivity", min: 0.2, max: 3, typ: 1, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v < 0.7 ? calm("Buyers barely notice price", "you can charge a premium and keep volume — the “$100 monopoly” regime.") : v > 1.7 ? hot("Buyers chase the cheapest pint", "a few cents swings big share — price wars dominate.") : mid("Balanced price response", "price matters but quality and brand still pull weight.") },
      { key: "beta_q", label: "Quality pull", min: 0, max: 2.5, typ: 1, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v > 1.6 ? calm("Quality wins markets", "investing in recipe quality pays off strongly.") : v < 0.5 ? hot("Quality barely registers", "R&D spend is hard to justify.") : mid("Quality matters moderately", "a real but not dominant differentiator.") },
      { key: "beta_b", label: "Brand pull", min: 0, max: 2.5, typ: 0.9, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v > 1.5 ? calm("Brand is king", "marketing and PR splashes drive outsized share.") : v < 0.4 ? hot("Brand barely moves buyers", "marketing spend mostly wasted.") : mid("Brand has real weight", "marketing compounds but isn't everything.") },
      { key: "U0", label: "Outside option", min: 0, max: 3, typ: 1.2, fmt: (v) => v.toFixed(2), feel: (v) => v > 2 ? hot("Buyers walk away easily", "weak total demand — firms fight over a small pie.") : v < 0.6 ? calm("Captive market", "almost everyone buys something.") : mid("Normal walk-away rate", "a healthy share of buyers can abstain.") },
    ],
  },
  {
    id: "spatial", label: "Spatial", kicker: "Geography & catchment", blurb: "How much location matters — catchment strength, reach, distance decay and home advantage.",
    knobs: [
      { key: "beta_loc", label: "Location pull", min: 0, max: 2.5, typ: 1, fmt: (v) => v.toFixed(2), feel: (v) => v > 1.6 ? calm("Place is destiny", "siting near foot traffic dominates.") : v < 0.4 ? hot("Location barely matters", "you can sell from anywhere.") : mid("Location matters", "good siting helps, but isn't the whole game.") },
      { key: "radius", label: "Catchment reach", min: 0.5, max: 4, typ: 2, fmt: (v) => v.toFixed(1) + " km", feel: (v) => v > 3 ? calm("Wide catchments", "one taproom serves a big area.") : v < 1.2 ? hot("Tight catchments", "you need dense coverage to reach buyers.") : mid("Moderate reach", "a sensible coverage-vs-cost trade-off.") },
      { key: "lambda", label: "Distance decay", min: 0.2, max: 2.5, typ: 1, fmt: (v) => v.toFixed(2), feel: (v) => v > 1.7 ? hot("Steep decay", "buyers strongly prefer the nearest option.") : v < 0.5 ? calm("Flat decay", "distance hardly deters buyers.") : mid("Normal decay", "convenience matters at a believable rate.") },
      { key: "self_weight", label: "Home advantage", min: 0, max: 2, typ: 0.8, fmt: (v) => v.toFixed(2), feel: (v) => v > 1.4 ? calm("Strong home turf", "incumbents are hard to dislodge at home.") : v < 0.3 ? hot("No home edge", "every market is contestable from round one.") : mid("Modest home edge", "a slight incumbent advantage.") },
    ],
  },
  {
    id: "trade", label: "Trade", kicker: "Shipping & markets", blurb: "The transportation game: shipping cost, market growth, entry cost and tariffs.",
    knobs: [
      { key: "rate_per_unit_distance", label: "Shipping cost", min: 0, max: 5, typ: 1.5, fmt: (v) => "$" + v.toFixed(2), feel: (v) => v > 3.2 ? hot("Shipping is brutal", "far markets only pay off with local production.") : v < 0.5 ? calm("Shipping is cheap", "produce anywhere, sell everywhere.") : mid("Shipping has teeth", "distance costs real money; produce near demand.") },
      { key: "demand_growth", label: "Market growth", min: -0.1, max: 0.3, typ: 0.06, fmt: (v) => (v * 100).toFixed(0) + "%/rd", feel: (v) => v > 0.18 ? calm("Booming markets", "a rising tide — expansion is richly rewarded.") : v < 0 ? hot("Shrinking markets", "zero-sum and brutal — share must be taken.") : mid("Steady growth", "markets expand at a believable clip.") },
      { key: "entry_cost", label: "Entry cost", min: 0.2, max: 3, typ: 1, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v > 2 ? hot("Costly to expand", "new markets are a big commitment.") : v < 0.5 ? calm("Cheap to expand", "land-grab everywhere early.") : mid("Meaningful entry cost", "expansion is a real decision.") },
      { key: "tariff_rate", label: "Tariff rate", min: 0, max: 0.4, typ: 0.05, fmt: (v) => (v * 100).toFixed(0) + "%", feel: (v) => v > 0.25 ? hot("Protectionist", "cross-border selling is heavily taxed.") : v < 0.02 ? calm("Free trade", "international markets are wide open.") : mid("Modest tariffs", "international sales carry a small penalty.") },
    ],
  },
  {
    id: "conduct", label: "Conduct", kicker: "Antitrust & fairness", blurb: "How aggressively dominance and unfair pricing are policed — and how much goodwill shields you.",
    knobs: [
      { key: "dominance_threshold", label: "Dominance line", min: 0.3, max: 0.8, typ: 0.5, fmt: (v) => (v * 100).toFixed(0) + "%", feel: (v) => v < 0.4 ? hot("Trigger-happy regulators", "even modest share draws scrutiny.") : v > 0.7 ? calm("Hands-off regulators", "near-monopoly before anyone acts.") : mid("Standard threshold", "clear market leaders get watched.") },
      { key: "fair_markup", label: "Fair markup ceiling", min: 1.1, max: 3, typ: 1.8, fmt: (v) => v.toFixed(1) + "×", feel: (v) => v < 1.4 ? hot("Tight price policing", "high margins flagged as gouging fast.") : v > 2.5 ? calm("Loose price policing", "you can mark up steeply before trouble.") : mid("Reasonable ceiling", "extreme markups draw penalties.") },
      { key: "fine_scale", label: "Fine severity", min: 0, max: 3, typ: 1, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v > 2 ? hot("Ruinous fines", "a violation can sink a firm.") : v < 0.4 ? calm("Slap on the wrist", "fines are a cost of doing business.") : mid("Material fines", "penalties sting but rarely fatal.") },
      { key: "goodwill_k", label: "Goodwill shield", min: 0, max: 2, typ: 1, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v > 1.5 ? calm("Goodwill protects a lot", "regulator trust + reputation soften most penalties.") : v < 0.3 ? hot("Goodwill barely helps", "no buying your way out of trouble.") : mid("Goodwill helps", "reputation meaningfully mitigates fines.") },
    ],
  },
  {
    id: "shocks", label: "Shocks", kicker: "Disruptions & volatility", blurb: "Severity and frequency of water/harvest/CO₂ shocks — and whether they hit by region.",
    knobs: [
      { key: "magnitude_mean", label: "Shock severity", min: 0, max: 0.6, typ: 0.25, fmt: (v) => (v * 100).toFixed(0) + "%", feel: (v) => v > 0.4 ? hot("Devastating shocks", "a single event can reshape the table.") : v < 0.1 ? calm("Gentle shocks", "disruptions are a nuisance, not a crisis.") : mid("Real shocks", "events meaningfully move costs and capacity.") },
      { key: "prob_per_round", label: "Shock frequency", min: 0, max: 1, typ: 0.3, fmt: (v) => (v * 100).toFixed(0) + "%/rd", feel: (v) => v > 0.6 ? hot("Constant turbulence", "expect a shock almost every round.") : v < 0.1 ? calm("Calm seas", "shocks are rare surprises.") : mid("Occasional shocks", "a shock every few rounds keeps teams honest.") },
      { key: "regional", label: "Regional shocks", min: 0, max: 1, typ: 1, toggle: true, fmt: (v) => (v >= 0.5 ? "On" : "Off"), feel: (v) => v >= 0.5 ? mid("Shocks hit by region", "where you produce determines exposure — geography is risk.") : calm("Shocks hit everyone equally", "no geographic risk diversification.") },
    ],
  },
  {
    id: "difficulty", label: "Difficulty", kicker: "Roster & challenge · feel-only", blurb: "Previews the feel of the field. Field size is set on the form; bot aggression & starting capital apply to single-player practice.",
    knobs: [
      { key: "investScale", label: "Starting capital", min: 0.4, max: 2.5, typ: 1, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v > 1.8 ? calm("Flush with cash", "lots of room to experiment.") : v < 0.6 ? hot("Shoestring budget", "every dollar counts — early mistakes punish.") : mid("Standard capital", "enough to play, not enough to waste.") },
      { key: "aggression", label: "Bot aggression", min: 0, max: 2, typ: 1, fmt: (v) => v.toFixed(2) + "×", feel: (v) => v > 1.5 ? hot("Cutthroat rivals", "algorithmic firms undercut relentlessly.") : v < 0.4 ? calm("Passive rivals", "bots play it safe.") : mid("Competent rivals", "bots respond sensibly to your moves.") },
      { key: "roster", label: "Field size", min: 3, max: 10, typ: 6, step: 1, fmt: (v) => Math.round(v) + " firms", feel: (v) => v > 8 ? hot("Crowded field", "markets fragment, every share point contested.") : v < 4 ? calm("Small field", "easier to find open water.") : mid("Balanced field", "a competitive but readable roster.") },
    ],
  },
];

const ALL_KNOBS: Knob[] = TUNING_GROUPS.flatMap((g) => g.knobs);
export type TuningVals = Record<string, number>;
export const tuningDefaults = (): TuningVals => Object.fromEntries(ALL_KNOBS.map((k) => [k.key, k.typ]));

export const TUNING_PRESETS: Record<string, TuningVals> = {
  balanced: tuningDefaults(),
  forgiving: { ...tuningDefaults(), beta_p: 0.5, U0: 0.7, rate_per_unit_distance: 0.8, magnitude_mean: 0.1, prob_per_round: 0.12, investScale: 1.8, aggression: 0.4, fine_scale: 0.5 },
  cutthroat: { ...tuningDefaults(), beta_p: 2.2, U0: 2.1, rate_per_unit_distance: 3.4, magnitude_mean: 0.45, prob_per_round: 0.65, investScale: 0.6, aggression: 1.7, demand_growth: -0.02, roster: 9 },
};

/** Map the instructor knobs to a real engine ConfigOverride. Reads the resolved default
 *  so multipliers compose correctly, and rebuilds arrays whole (deepMerge replaces arrays).
 *  Difficulty knobs are intentionally NOT emitted — they're feel-only / controller-side. */
export function tuningToOverride(vals: TuningVals): ConfigOverride {
  const base = resolveConfig();
  const o: Record<string, unknown> = {};
  const modules: Record<string, unknown> = {};

  // Demand — per segment: beta_p/q/b are multipliers on the default; U0 absolute.
  if (base.segments?.length) {
    o.segments = base.segments.map((s) => ({ ...s, beta_p: s.beta_p * (vals.beta_p ?? 1), beta_q: s.beta_q * (vals.beta_q ?? 1), beta_b: s.beta_b * (vals.beta_b ?? 1), U0: vals.U0 ?? s.U0 }));
  }

  // Spatial — catchment: absolute values (only when facilities/catchment exist).
  const fac = base.modules?.facilities;
  if (fac?.catchment) {
    modules.facilities = { catchment: { ...fac.catchment, beta_loc: vals.beta_loc ?? fac.catchment.beta_loc, radius: vals.radius ?? fac.catchment.radius, lambda: vals.lambda ?? fac.catchment.lambda, self_weight: vals.self_weight ?? fac.catchment.self_weight } };
  }

  // Trade — shipping (knob $typ1.5 ⇒ ×1 on the tiny per-degree default) + per-market knobs.
  const geo = base.modules?.geography;
  if (geo) {
    const dfltRate = geo.shipping?.rate_per_unit_distance ?? 0.004;
    const gOver: Record<string, unknown> = { shipping: { rate_per_unit_distance: dfltRate * ((vals.rate_per_unit_distance ?? 1.5) / 1.5) } };
    if (geo.markets?.length) {
      gOver.markets = geo.markets.map((m) => ({ ...m, demand_growth: vals.demand_growth ?? m.demand_growth ?? 0, entry_cost: (m.entry_cost ?? 0) * (vals.entry_cost ?? 1), tariff_rate: m.kind === "export" ? (vals.tariff_rate ?? m.tariff_rate ?? 0) : m.tariff_rate }));
    }
    modules.geography = gOver;
  }

  // Conduct (MOD-A10) — thresholds absolute; fine × default; goodwill × on both mitigation ks.
  const mc = base.modules?.marketConduct;
  if (mc) {
    modules.marketConduct = {
      dominance_threshold: vals.dominance_threshold ?? mc.dominance_threshold,
      fair_markup: vals.fair_markup ?? mc.fair_markup,
      fine_scale: mc.fine_scale * (vals.fine_scale ?? 1),
      tgov_k: mc.tgov_k * (vals.goodwill_k ?? 1),
      rep_k: mc.rep_k * (vals.goodwill_k ?? 1),
    };
  }

  // Shocks — per type: magnitude & frequency as multipliers (preserve per-type spread); regional bool.
  if (base.shocks?.types?.length) {
    const magM = (vals.magnitude_mean ?? 0.25) / 0.25;
    const probM = (vals.prob_per_round ?? 0.3) / 0.3;
    o.shocks = { types: base.shocks.types.map((t) => ({ ...t, magnitude_mean: t.magnitude_mean * magM, prob_per_round: Math.min(1, t.prob_per_round * probM), regional: (vals.regional ?? 1) >= 0.5 })) };
  }

  if (Object.keys(modules).length) o.modules = modules;
  return o as ConfigOverride;
}

// ───────────────────────── feel-meters (UI-only) ─────────────────────────
const clampPct = (x: number) => Math.max(4, Math.min(100, x));
function feelMeters(v: TuningVals) {
  const volat = clampPct(((v.magnitude_mean ?? 0.25) / 0.6 * 0.6 + (v.prob_per_round ?? 0.3) * 0.4) * 100);
  const pressure = clampPct(((v.aggression ?? 1) / 2 * 0.4 + (v.beta_p ?? 1) / 3 * 0.35 + (1 - (v.dominance_threshold ?? 0.5)) * 0.25) * 100);
  const tradew = clampPct(((v.rate_per_unit_distance ?? 1.5) / 5 * 0.6 + (v.tariff_rate ?? 0.05) / 0.4 * 0.4) * 100);
  const meter = (pct: number, label: string, lo: string, midL: string, hi: string, notes: [string, string, string]) => {
    const i = pct > 66 ? 2 : pct > 33 ? 1 : 0;
    return { label, pct, tag: [lo, midL, hi][i], color: ["var(--color-hop)", "var(--color-copperdeep)", "var(--color-brick)"][i], note: notes[i] };
  };
  return [
    meter(volat, "Market volatility", "Calm", "Choppy", "Turbulent", ["Few disruptions — outcomes track strategy.", "Periodic shocks keep teams adapting.", "Frequent, severe shocks — luck plays a big role."]),
    meter(pressure, "Competitive pressure", "Gentle", "Real", "Brutal", ["Room to breathe — distinctive plays rewarded.", "Rivals respond; defend your share.", "Relentless undercutting — a knife fight."]),
    meter(tradew, "Transportation weight", "Light", "Felt", "Heavy", ["Geography barely constrains.", "Distance costs money; produce near demand.", "Shipping & tariffs dominate — locality is everything."]),
  ];
}

const TONE_BG: Record<Tone, string> = { hot: "color-mix(in srgb, var(--color-brick) 9%, var(--color-panel))", calm: "color-mix(in srgb, var(--color-hop) 11%, var(--color-panel))", mid: "var(--color-panel2)" };
const TONE_BORDER: Record<Tone, string> = { hot: "color-mix(in srgb, var(--color-brick) 45%, var(--color-line))", calm: "color-mix(in srgb, var(--color-hop) 45%, var(--color-line))", mid: "var(--color-line)" };
const TONE_ICON: Record<Tone, string> = { hot: "🔴", calm: "🟢", mid: "🟡" };

interface SavedPreset { name: string; vals: TuningVals }
const SAVED_KEY = "dw_tuning_presets";
const loadSaved = (): SavedPreset[] => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"); } catch { return []; } };

/** Controlled Tuning Board. `value` is the current knob map; `onChange` fires on every edit. */
export function TuningBoard({ value, onChange }: { value: TuningVals; onChange: (v: TuningVals) => void }) {
  const [group, setGroup] = useState("demand");
  const [presetId, setPresetId] = useState("balanced");
  const [saved, setSaved] = useState<SavedPreset[]>(() => loadSaved());
  useEffect(() => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved)); } catch { /* ignore */ } }, [saved]);

  const vals = value;
  const set = (key: string, raw: number) => {
    const k = ALL_KNOBS.find((x) => x.key === key)!;
    const v = Math.max(k.min, Math.min(k.max, raw));
    onChange({ ...vals, [key]: v });
    setPresetId("custom");
  };
  const applyPreset = (id: string) => { if (TUNING_PRESETS[id]) { onChange({ ...TUNING_PRESETS[id] }); setPresetId(id); } };
  const meters = useMemo(() => feelMeters(vals), [vals]);

  const g = TUNING_GROUPS.find((x) => x.id === group) ?? TUNING_GROUPS[0];
  const resetGroup = () => { const nv = { ...vals }; g.knobs.forEach((k) => (nv[k.key] = k.typ)); onChange(nv); setPresetId("custom"); };
  const savePreset = () => setSaved((s) => [...s, { name: `Custom ${s.length + 1}`, vals: { ...vals } }]);

  // demand-vs-price curve from beta_p + U0
  const bp = vals.beta_p ?? 1, u0 = vals.U0 ?? 1.2;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) { const price = i / 24; const share = 1 / (1 + Math.exp(bp * 2.2 * (price - 0.5) + (u0 - 1) * 0.6)); pts.push([20 + price * 252, 100 - share * 84]); }
  const curve = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const elast = bp > 1.7 ? { color: "var(--color-brick)", tag: "elastic", note: "Steep — buyers flee as price rises. Price wars, thin margins." } : bp < 0.7 ? { color: "var(--color-hop)", tag: "inelastic", note: "Flat — buyers stay at high prices. Real pricing power." } : { color: "var(--color-copperdeep)", tag: "moderate", note: "Balanced — price matters, but isn't the only lever." };

  const presetBtn = (id: string, label: string) => {
    const on = presetId === id;
    return <button key={id} onClick={() => (id === "custom" ? setPresetId("custom") : applyPreset(id))} className="rounded-[7px] px-2.5 py-1.5 font-mono text-[0.6rem] uppercase tracking-wide" style={{ background: on ? "var(--color-copper)" : "transparent", color: on ? "#fff4e0" : "var(--color-inksoft)", fontWeight: on ? 700 : 500 }}>{label}</button>;
  };

  return (
    <div className="flex flex-col overflow-hidden rounded-[14px] border border-line2 bg-panel/40 lg:h-[640px] lg:flex-row">
      {/* group rail */}
      <nav className="scl flex flex-none flex-row gap-1.5 overflow-x-auto border-b border-line2 bg-panel/50 p-3 lg:w-[200px] lg:flex-col lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="hidden font-mono text-[0.55rem] uppercase tracking-[0.14em] text-inksoft lg:block">Knob groups</div>
        {TUNING_GROUPS.map((gr) => {
          const on = gr.id === group;
          const dirty = gr.knobs.some((k) => Math.abs((vals[k.key] ?? k.typ) - k.typ) > 1e-6);
          return (
            <button key={gr.id} onClick={() => setGroup(gr.id)} className="flex flex-none items-center gap-2 rounded-[10px] border px-2.5 py-2 text-left" style={{ borderColor: on ? "var(--color-line)" : "transparent", background: on ? "color-mix(in srgb, var(--color-copper) 13%, var(--color-panel))" : "transparent" }}>
              <span className="min-w-0"><span className="display block text-sm font-bold uppercase leading-none text-ink">{gr.label}</span><span className="font-mono text-[0.5rem] text-inksoft">{gr.knobs.length} knobs</span></span>
              {dirty && <span className="h-1.5 w-1.5 flex-none rounded-full bg-copper" />}
            </button>
          );
        })}
      </nav>

      {/* knobs */}
      <section className="scl min-w-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="inline-flex gap-0.5 rounded-[9px] border border-line2 bg-panel2 p-0.5">
            {presetBtn("forgiving", "Forgiving")}{presetBtn("balanced", "Balanced")}{presetBtn("cutthroat", "Cutthroat")}{presetBtn("custom", "Custom")}
          </div>
          <div className="flex gap-2">
            <button onClick={savePreset} className="rounded-[8px] border border-copperdeep px-2.5 py-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-wide text-[#3a2206]" style={{ background: "linear-gradient(var(--color-gold),var(--color-copper))" }}>＋ Save</button>
            <button onClick={resetGroup} className="rounded-[8px] border border-line2 bg-panel px-2.5 py-1.5 font-mono text-[0.6rem] font-bold uppercase tracking-wide text-inksoft">⟲ Reset</button>
          </div>
        </div>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div><div className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-copperdeep">{g.kicker}</div><div className="display text-2xl font-extrabold uppercase leading-none text-ink">{g.label}</div></div>
          <div className="max-w-[280px] text-right text-[0.7rem] text-inksoft">{g.blurb}</div>
        </div>
        <div className="flex flex-col gap-2.5">
          {g.knobs.map((k) => {
            const v = vals[k.key] ?? k.typ; const f = k.feel(v);
            const pct = ((v - k.min) / (k.max - k.min)) * 100;
            const typPct = ((k.typ - k.min) / (k.max - k.min)) * 100;
            const changed = Math.abs(v - k.typ) > 1e-6;
            return (
              <div key={k.key} className="rounded-[13px] border border-line bg-panel p-3.5">
                <div className="mb-1 flex items-baseline gap-2.5">
                  <span className="display text-base font-extrabold uppercase text-ink">{k.label}</span>
                  <span className="rounded-full border border-line px-1.5 font-mono text-[0.5rem] uppercase tracking-wide text-inksoft">{k.key}</span>
                  <span className="flex-1" />
                  {changed && <span className="font-mono text-[0.5rem] uppercase text-copperdeep">edited</span>}
                  <span className="font-mono text-base font-bold text-copper">{k.fmt(v)}</span>
                </div>
                {k.toggle ? (
                  <div className="my-2 flex items-center gap-2.5">
                    <button onClick={() => set(k.key, v >= 0.5 ? 0 : 1)} className="relative h-[26px] w-[46px] flex-none rounded-full" style={{ background: v >= 0.5 ? "var(--color-hop)" : "var(--color-panel2)", border: `1px solid ${v >= 0.5 ? "#4c7820" : "var(--color-line2)"}` }}>
                      <span className="absolute top-0.5 h-5 w-5 rounded-full bg-panel transition-all" style={{ left: v >= 0.5 ? 23 : 3, boxShadow: "0 1px 3px rgba(40,25,8,.35)" }} />
                    </button>
                    <span className="text-[0.8rem] font-semibold text-ink">{v >= 0.5 ? "Enabled" : "Disabled"}</span>
                  </div>
                ) : (
                  <div className="relative my-2">
                    <input type="range" min={k.min} max={k.max} step={k.step ?? (k.max - k.min) / 100} value={v} onChange={(e) => set(k.key, +e.target.value)} className="w-full" />
                    <span className="pointer-events-none absolute -top-0.5 h-[13px] w-px -translate-x-1/2 bg-inksoft/60" style={{ left: `${typPct}%` }} title="typical" />
                    <div className="mt-0.5 flex justify-between font-mono text-[0.5rem] text-inksoft"><span>{k.fmt(k.min)}</span><span>typ {k.fmt(k.typ)}</span><span>{k.fmt(k.max)}</span></div>
                  </div>
                )}
                <div className="mt-1.5 flex items-start gap-2 rounded-[9px] border px-2.5 py-2" style={{ background: TONE_BG[f.tone], borderColor: TONE_BORDER[f.tone] }}>
                  <span className="text-xs">{TONE_ICON[f.tone]}</span>
                  <span className="text-[0.72rem] leading-snug text-ink/80"><b className="text-ink">{f.head}</b> — {f.note}</span>
                </div>
                <span className="sr-only" style={{ width: `${pct}%` }} />
              </div>
            );
          })}
        </div>
        {saved.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] text-inksoft">Saved presets</div>
            <div className="flex flex-wrap gap-1.5">
              {saved.map((sp, i) => (
                <span key={i} className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1">
                  <button onClick={() => { onChange({ ...sp.vals }); setPresetId("custom"); }} className="font-mono text-[0.65rem] text-ink">{sp.name}</button>
                  <button onClick={() => setSaved((s) => s.filter((_, j) => j !== i))} className="text-[0.7rem] text-inksoft" title="Delete">✕</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* live feel */}
      <aside className="scl flex-none border-t border-line2 bg-panel/50 p-3.5 lg:w-[300px] lg:overflow-y-auto lg:border-l lg:border-t-0">
        <div className="font-mono text-[0.55rem] uppercase tracking-[0.14em] text-inksoft">Live feel · whole game</div>
        <div className="display mb-2 text-lg font-extrabold uppercase text-ink">How it'll play</div>
        <div className="rounded-[11px] border border-line bg-panel p-3">
          <div className="mb-1 flex items-baseline justify-between"><span className="display text-[0.85rem] font-bold uppercase text-ink">Demand vs price</span><span className="font-mono text-[0.6rem]" style={{ color: elast.color }}>{elast.tag}</span></div>
          <svg viewBox="0 0 280 120" className="block w-full">
            <line x1="20" y1="100" x2="272" y2="100" stroke="var(--color-line2)" strokeWidth="1" />
            <line x1="20" y1="12" x2="20" y2="100" stroke="var(--color-line2)" strokeWidth="1" />
            <path d={`${curve} L272 100 L20 100 Z`} fill="var(--color-copper)" opacity="0.1" />
            <path d={curve} fill="none" stroke="var(--color-copper)" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
          <div className="flex justify-between font-mono text-[0.5rem] text-inksoft"><span>low price</span><span>high price</span></div>
          <div className="mt-1.5 text-[0.7rem] leading-snug text-inksoft">{elast.note}</div>
        </div>
        <div className="mt-2.5 flex flex-col gap-2">
          {meters.map((m) => (
            <div key={m.label} className="rounded-[11px] border border-line bg-panel p-3">
              <div className="mb-1.5 flex items-baseline justify-between"><span className="display text-[0.8rem] font-bold uppercase text-ink">{m.label}</span><span className="font-mono text-[0.65rem] font-bold" style={{ color: m.color }}>{m.tag}</span></div>
              <div className="relative h-2 overflow-hidden rounded-full bg-panel2"><span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${m.pct}%`, background: m.color }} /></div>
              <div className="mt-1.5 text-[0.65rem] leading-snug text-inksoft">{m.note}</div>
            </div>
          ))}
        </div>
        <div className="mt-2.5 rounded-[10px] border border-dashed border-line2 bg-panel2/60 p-2.5 text-[0.65rem] leading-snug text-inksoft">Applies as a <b className="text-ink">ConfigOverride</b> on the game — no engine change. Save it as a preset to run a section as a treatment condition.</div>
      </aside>
    </div>
  );
}
