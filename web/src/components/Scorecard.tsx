/**
 * Scorecard panel (DW-045, scoring-layer §5/§6) — the one number in the game that had
 * no explanation attached. Three readings, in plain language:
 *
 *   1. WHY the headline score moved this quarter — a waterfall of the four component
 *      bars (they sum to the delta exactly; the engine asserts zero residual).
 *   2. WHERE you stand against the room — each component's within-round z, spoken
 *      ("ahead of the field"), never printed as "z-score".
 *   3. WHETHER you're actually running a good company — raw metrics against absolute
 *      weak/sound/strong bands derived from the economy itself (display-only; they
 *      never touch the score). When the two readings disagree — leading a weak room,
 *      or trailing a hot one — the panel says so explicitly. That disagreement is the
 *      teaching moment, and it must not require the student to notice it.
 *
 * Also carries the "field moved, not you" guard: if your raw fundamentals improved but
 * your relative position fell, that's rivals outrunning you — the single most common
 * misreading of a relative scorecard.
 */
import type { GameView } from "../game/controller.js";
import { Card, Eyebrow } from "./ui.js";
import { Bridge, type BridgeStep } from "./Dashboards.js";

const HOP = "var(--color-hop)";
const BRICK = "var(--color-brick)";
const COPPER = "var(--color-copper)";

type CompKey = "financial" | "market" | "intangible" | "stakeholder";
const COMPONENTS: { key: CompKey; label: string; blurb: string }[] = [
  { key: "financial", label: "Financial", blurb: "Profit on the capital you employ, plus balance-sheet strength." },
  { key: "market", label: "Market", blurb: "Your share of demand, summed across the segments you serve." },
  { key: "intangible", label: "Preparedness", blurb: "Quality + brand capital — the product you'll compete with next year." },
  { key: "stakeholder", label: "Standing", blurb: "Employee, investor and regulator trust." },
];

/** Speak a within-round z as position-vs-pack (never print "z-score" at a student). */
function positionOf(z: number): { text: string; tone: "good" | "mid" | "risk" } {
  if (z >= 1) return { text: "far ahead of the field", tone: "good" };
  if (z >= 0.35) return { text: "ahead of the field", tone: "good" };
  if (z > -0.35) return { text: "with the pack", tone: "mid" };
  if (z > -1) return { text: "trailing the field", tone: "risk" };
  return { text: "far behind the field", tone: "risk" };
}

type Tier = "weak" | "sound" | "strong";
const tierOf = (v: number, band: { weak: number; strong: number }): Tier =>
  v < band.weak ? "weak" : v >= band.strong ? "strong" : "sound";
const TIER_COLOR: Record<Tier, string> = { weak: BRICK, sound: COPPER, strong: HOP };

/** Horizontal band gauge: three zones (weak | sound | strong) with a marker at your
 *  value and the median tick. Display-only — bands never enter the score. */
function BandGauge({ value, band, format }: { value: number; band: { weak: number; sound: number; strong: number }; format: (v: number) => string }) {
  const span = Math.max(band.strong - band.weak, 1e-9);
  const lo = band.weak - span * 0.7;
  const hi = band.strong + span * 0.7;
  const xOf = (v: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100;
  const tier = tierOf(value, band);
  return (
    <div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full" aria-hidden>
        <div className="absolute inset-y-0 left-0" style={{ width: `${xOf(band.weak)}%`, background: `color-mix(in srgb, ${BRICK} 26%, var(--color-panel2))` }} />
        <div className="absolute inset-y-0" style={{ left: `${xOf(band.weak)}%`, width: `${xOf(band.strong) - xOf(band.weak)}%`, background: `color-mix(in srgb, ${COPPER} 22%, var(--color-panel2))` }} />
        <div className="absolute inset-y-0" style={{ left: `${xOf(band.strong)}%`, right: 0, background: `color-mix(in srgb, ${HOP} 26%, var(--color-panel2))` }} />
        <div className="absolute inset-y-0 w-px" style={{ left: `${xOf(band.sound)}%`, background: "var(--color-line)" }} title={`industry median ${format(band.sound)}`} />
        <div className="absolute -top-0 h-2.5 w-1 rounded-sm" style={{ left: `calc(${xOf(value)}% - 2px)`, background: "var(--color-ink)" }} />
      </div>
      <div className="mt-0.5 flex justify-between font-mono text-[0.56rem] uppercase tracking-wide text-inksoft">
        <span>weak</span>
        <span className="font-bold" style={{ color: TIER_COLOR[tier] }}>{format(value)} · {tier}</span>
        <span>strong</span>
      </div>
    </div>
  );
}

const TONE_COLOR: Record<"good" | "mid" | "risk", string> = { good: HOP, mid: "var(--color-inksoft)", risk: BRICK };

const sc = (n: number) => n.toFixed(2);
const scd = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(3)}`;

export function ScorecardPanel({ view }: { view: GameView }) {
  const bands = view.scoring?.benchmark_bands ?? {};
  const w = view.scoring?.weights;
  const h = view.history ?? [];
  const cur = h.at(-1)?.own;
  const prev = h.at(-2)?.own;
  const r = view.ownResult;

  // The published rules (§6 disclosure posture: shown from round 1, never discovered).
  const rules = w
    ? `Financial ${Math.round(w.financial * 100)}% · Market ${Math.round(w.market * 100)}% · Preparedness ${Math.round(w.intangible * 100)}% · Standing ${Math.round(w.stakeholder * 100)}% — each scored against the field every quarter, then averaged across the season. Sustained strength wins; a big final quarter doesn't.`
    : "Each component is scored against the field every quarter, then averaged across the season.";

  // Practice-round notice (§2): announced exclusions teach; silent ones don't.
  const win = view.scoring?.accumulation_window;
  const practiceNote = win?.tail_only != null
    ? `Only the final ${win.tail_only} rounds count toward the season score.`
    : (win?.drop_first ?? 0) > 0
      ? `Round${(win!.drop_first ?? 0) > 1 ? `s 1–${win!.drop_first}` : " 1"} ${(win!.drop_first ?? 0) > 1 ? "are" : "is"} practice — experiment freely, ${(win!.drop_first ?? 0) > 1 ? "they don't" : "it doesn't"} count toward the season score.`
      : null;

  if (!cur || !r) {
    return (
      <Card>
        <Eyebrow>Scorecard · how you're graded</Eyebrow>
        <div className="mt-1 text-[0.78rem] leading-relaxed">{rules}</div>
        {practiceNote && <div className="mt-2 rounded border border-gold/60 bg-gold/10 px-2 py-1 text-[0.72rem]">{practiceNote}</div>}
        <div className="mt-2 text-[0.7rem] text-inksoft">Your first reading appears when round 1 resolves.</div>
      </Card>
    );
  }

  // ── the waterfall: last quarter's score → component bars → now ─────────────
  const bridge = cur.scoreBridge;
  const prevScore = prev?.score ?? 0;
  const steps: BridgeStep[] = bridge
    ? [
        { label: h.length > 1 ? `R${(prev?.round ?? 0) + 1}` : "Start", total: prevScore },
        ...COMPONENTS.map((c) => ({ label: c.label, delta: bridge[c.key] })),
        ...(Math.abs(bridge.terminal) > 1e-9 ? [{ label: "Final-round", delta: bridge.terminal }] : []),
        { label: "Now", total: cur.score },
      ]
    : [];

  // ── the one-sentence read of the quarter ────────────────────────────────────
  let sentence = "";
  if (bridge) {
    const delta = cur.score - prevScore;
    const ranked = COMPONENTS.map((c) => ({ c, d: bridge[c.key] })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    const big = ranked[0];
    const drag = ranked.find((x) => Math.sign(x.d) !== Math.sign(big.d) && Math.abs(x.d) > 0.004);
    if (Math.abs(delta) < 0.004) sentence = "Your score held steady this quarter — gains and slips cancelled out.";
    else {
      sentence = `Your score ${delta > 0 ? "rose" : "fell"} ${scd(delta)} this quarter — mostly ${big.c.label} (${scd(big.d)})`;
      sentence += drag ? `; ${drag.c.label} ${drag.d > 0 ? "helped" : "cost you"} (${scd(drag.d)}).` : ".";
    }
    if (cur.scored === false) sentence += " (Practice round — shown, not scored.)";
  }

  // ── per-component: position, band reading, disagreement, field-moved guard ──
  const invested = r.balance_sheet.debt + r.balance_sheet.equity;
  const rawOf: Record<CompKey, { value: number; bandKey: string; format: (v: number) => string } | null> = {
    financial: invested > 0 ? { value: r.pnl.net_income / invested, bandKey: "roic", format: (v) => `${(v * 100).toFixed(1)}%` } : null,
    market: { value: Object.values(r.segments).reduce((a, s) => a + s.share, 0), bandKey: "segment_share", format: (v) => `${(v * 100).toFixed(0)}%` },
    intangible: { value: r.state.Q + r.state.B, bandKey: "intangible_index", format: (v) => v.toFixed(0) },
    stakeholder: { value: (r.state.T_emp + r.state.T_inv + r.state.T_gov) / 3, bandKey: "stakeholder_mean", format: (v) => v.toFixed(0) },
  };
  // Interest cover rides along under Financial (its own band; "no debt" beats a tier).
  const coverBand = bands.interest_cover;
  const coverLine = coverBand
    ? r.balance_sheet.debt < 1_000
      ? { text: "Interest cover: no debt — nothing to cover.", tone: "mid" as const }
      : { text: `Interest cover ${Math.min(20, r.cost_of_capital.coverage).toFixed(1)}× — ${tierOf(Math.min(20, r.cost_of_capital.coverage), coverBand)} (sound ≥ ${coverBand.weak}×, strong ≥ ${coverBand.strong}×).`, tone: "mid" as const }
    : null;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow>Scorecard · why your score moved, and what "good" looks like</Eyebrow>
        <div className="font-mono text-[0.62rem] text-inksoft">weights: {rules.split(" — ")[0]}</div>
      </div>
      {practiceNote && <div className="mt-2 rounded border border-gold/60 bg-gold/10 px-2 py-1 text-[0.72rem]">{practiceNote}</div>}
      {sentence && <div className="mt-2 text-[0.82rem] leading-relaxed">{sentence}</div>}

      {steps.length > 0 && (
        <div className="mt-2">
          <Bridge steps={steps} fmtDelta={scd} fmtTotal={sc} vh={150} />
          <div className="mt-1 text-[0.66rem] text-inksoft">
            This quarter's change in your season score, split by component. Bars are exact — they add up to the change with nothing left over.
          </div>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {COMPONENTS.map((c) => {
          const z = cur.scoreNorm?.[c.key] ?? 0;
          const pos = positionOf(z);
          const raw = rawOf[c.key];
          const band = raw ? bands[raw.bandKey] : undefined;
          const tier = raw && band ? tierOf(raw.value, band) : null;

          // The two-readings-disagree callout (§5): relative and absolute at odds.
          let callout: string | null = null;
          if (tier === "strong" && pos.tone === "risk") callout = "You're behind in this room, but by industry standards this is a strong position — the field here is unusually hot.";
          if (tier === "weak" && pos.tone === "good") callout = "You lead the room here — but by industry standards this is still weak. Don't settle for winning a slow race.";

          // The field-moved guard (§6): raw improved while position fell (or vice versa).
          let fieldNote: string | null = null;
          const prevNorm = prev?.scoreNorm?.[c.key];
          const prevRaw = prev?.scoreRaw?.[c.key];
          const curRaw = cur.scoreRaw?.[c.key];
          if (prevNorm != null && prevRaw != null && curRaw != null) {
            const dz = z - prevNorm;
            const dr = curRaw - prevRaw;
            if (dz < -0.15 && dr > 0) fieldNote = "Your fundamentals actually improved — rivals just improved faster.";
            if (dz > 0.15 && dr < 0) fieldNote = "You slipped in absolute terms — you gained ground only because the field slipped more.";
          }

          return (
            <div key={c.key} className="rounded border border-line bg-panel2/40 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <div className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.1em]">{c.label}</div>
                <div className="text-[0.68rem] font-semibold" style={{ color: TONE_COLOR[pos.tone] }}>{pos.text}</div>
              </div>
              <div className="mt-0.5 text-[0.66rem] text-inksoft">{c.blurb}</div>
              {raw && band ? (
                <div className="mt-2"><BandGauge value={raw.value} band={band} format={raw.format} /></div>
              ) : (
                <div className="mt-2 text-[0.62rem] text-inksoft">No reading yet.</div>
              )}
              {c.key === "financial" && coverLine && <div className="mt-1.5 text-[0.64rem] text-inksoft">{coverLine.text}</div>}
              {callout && <div className="mt-1.5 rounded border border-copper/50 bg-copper/10 px-2 py-1 text-[0.66rem] leading-snug">{callout}</div>}
              {fieldNote && <div className="mt-1.5 rounded border border-line bg-panel px-2 py-1 text-[0.66rem] italic leading-snug text-inksoft">{fieldNote}</div>}
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[0.62rem] text-inksoft">
        Colored zones are industry benchmarks (weak / sound / strong) from calibrated market data — they show whether you're running a good company, not just whether you're beating this room. They never change your score.
      </div>
    </Card>
  );
}
