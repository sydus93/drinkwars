/**
 * Teams-mode L1 — the desk cockpit (DW-031). The per-role experience that sits above the
 * desk-filtered DecisionForm: role identity + charter, a dynamic "your mandate this round"
 * brief, a firm-vs-field teaching-metrics strip, and a rationale note. Works SOLO (a
 * per-discipline lens on the focused desk) and in TEAM play (your seat's cockpit).
 *
 * Pure presentation over `deskMeta.ts` selectors — no engine/schema dependency.
 */
import type { GameView } from "../game/controller.js";
import { PERSONAS, cockpitSignals, cockpitMetrics, type CockpitDesk, type Tone } from "../deskMeta.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";
import { CapacityVsDemand, CostOfCapitalCockpit, ScorecardRadar } from "./Dashboards.js";

/** The one chart that most defines a desk's discipline (design §3.3) — shown when a round
 *  has resolved. Not every desk gets one; where a chart doesn't fit, the metrics carry it. */
function cockpitChart(desk: CockpitDesk, view: import("../game/controller.js").GameView) {
  const r = view.ownResult;
  if (!r) return null;
  if (desk === "operations") return { label: "Capacity vs demand", el: <CapacityVsDemand result={r} cap={view.own.cap} /> };
  if (desk === "finance") return { label: "Cost-of-capital cockpit", el: <CostOfCapitalCockpit coc={r.cost_of_capital} finance={view.finance} /> };
  if (desk === "all" || desk === "strategy") return { label: "Balanced scorecard", el: <ScorecardRadar you={r.scorecard_norm} /> };
  return null;
}

const TONE_COLOR: Record<Tone, string> = {
  good: "var(--color-hop)",
  watch: "var(--color-gold)",
  risk: "var(--color-brick)",
  neutral: "var(--color-inksoft)",
};

const SEAT_SHORT: Record<string, string> = { ceo: "CEO", cfo: "CFO", cmo: "CMO", coo: "COO", chro: "CHRO" };

export function DeskCockpit({ desk, view, seatRole, rationale, onRationale }: {
  desk: CockpitDesk;
  view: GameView;
  seatRole?: string | null; // team play: the seat this player holds (for "you hold this seat")
  rationale: string;
  onRationale: (v: string) => void;
}) {
  const p = PERSONAS[desk];
  const signals = cockpitSignals(desk, view);
  const metrics = cockpitMetrics(desk, view);
  // In team play, does this player actually hold the seat whose desk is focused?
  const yoursByRole = seatRole ? SEAT_SHORT[seatRole] : null;
  const holdsThis = !!seatRole && ((seatRole === "ceo" && (desk === "all" || desk === "strategy")) ||
    (seatRole === "cmo" && desk === "commercial") || (seatRole === "cfo" && desk === "finance") ||
    (seatRole === "coo" && desk === "operations") || (seatRole === "chro" && desk === "people"));

  return (
    <Card className="overflow-hidden !p-0">
      {/* identity header */}
      <div className="flex items-start gap-3 border-b border-line px-4 py-3" style={{ borderLeft: `3px solid ${p.accent}` }}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.12em]" style={{ color: p.accent }}>{p.short} desk</span>
            {holdsThis && <span className="rounded-full bg-ink px-2 py-0.5 font-mono text-[0.52rem] font-bold uppercase tracking-wide text-paper">Your seat · {yoursByRole}</span>}
          </div>
          <h3 className="display mt-0.5 text-lg font-semibold leading-tight text-ink">{p.title}</h3>
          <div className="font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">{p.discipline}</div>
          <p className="mt-1 font-body text-[0.82rem] italic leading-snug text-inksoft">{p.charter}</p>
        </div>
      </div>

      {/* mandate — your job this round */}
      {signals.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>Your mandate · Round {Math.min(view.round + 1, view.nRounds)}</Eyebrow>
          <div className="mt-1.5 grid gap-2">
            {signals.map((s, i) => (
              <div key={i} className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5">
                <span className="mt-0.5 inline-flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: TONE_COLOR[s.tone] }} />
                  <span className="font-mono text-[0.6rem] font-bold uppercase tracking-wide text-inksoft">{s.label}</span>
                </span>
                <span className="text-[0.82rem] font-semibold tabular-nums" style={{ color: s.tone === "neutral" ? "var(--color-ink)" : TONE_COLOR[s.tone] }}>{s.value}</span>
                <span className="col-start-2 text-[0.74rem] leading-snug text-inksoft">{s.read}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* teaching metrics — firm vs field */}
      {metrics.length > 0 && (
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Eyebrow>Your numbers vs the field</Eyebrow>
            <InfoDot title="Reading the round" align="left">
              Firm-level figures, visible to the whole team — the shared picture you decide from. Each shows what it means so a teammate outside this discipline can follow the story.
            </InfoDot>
          </div>
          <div className="mt-1.5 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {metrics.map((m, i) => (
              <div key={i} className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[0.6rem] uppercase tracking-wide text-inksoft">{m.label}</span>
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-[0.9rem] font-bold tabular-nums" style={{ color: m.tone === "neutral" ? "var(--color-ink)" : TONE_COLOR[m.tone] }}>{m.value}</span>
                    {m.field && <span className="font-mono text-[0.55rem] text-inksoft">{m.field}</span>}
                  </span>
                </div>
                <div className="text-[0.68rem] leading-snug text-inksoft/90">{m.hint}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* signature chart — the one visual that defines this desk's discipline */}
      {(() => { const c = cockpitChart(desk, view); return c ? (
        <div className="border-b border-line px-4 py-3">
          <Eyebrow>{c.label}</Eyebrow>
          <div className="mt-1.5">{c.el}</div>
        </div>
      ) : null; })()}

      {/* rationale — the officer's call (client-side this pass; the seam for the team huddle) */}
      <div className="px-4 py-3">
        <label className="flex items-center gap-1.5">
          <Eyebrow>Your call this round</Eyebrow>
          <InfoDot title="Why capture this?" align="left">
            One line on what you're recommending and why. It's your thinking aid now; in team play it becomes what you bring to the huddle — the record of who proposed what.
          </InfoDot>
        </label>
        <textarea
          value={rationale}
          onChange={(e) => onRationale(e.target.value)}
          rows={2}
          placeholder={`As ${p.short}, I'm recommending… because…`}
          className="mt-1.5 w-full resize-y rounded-lg border border-line2 bg-panel px-3 py-2 text-[0.82rem] text-ink placeholder:text-inksoft/60 focus:border-copper focus:outline-none"
        />
      </div>
    </Card>
  );
}
