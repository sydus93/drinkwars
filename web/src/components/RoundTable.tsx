/**
 * Teams-mode L1 — the Round Table (DW-031, the Huddle beat; DW-038, the live plan).
 * Turns the parallel desk cockpits into a collective pre-commit review: each officer's
 * call gathered in one place with a readiness signal, before the team locks the round.
 *
 * SOLO: the five desks you wear yourself — a checklist of "have I made each call?" plus the
 * rationale you jotted, click-to-jump back to a desk. TEAM: the readiness rail PLUS the
 * composed firm plan — every desk's submitted slice, who owns it, and a cash reconciliation
 * so spending desks and the financing desk see each other before anyone locks. Refreshes
 * on the same 2.5s poll as the rest of the view (real-ish time).
 */
import type { GameView } from "../game/controller.js";
import { PERSONAS, type CockpitDesk } from "../deskMeta.js";
import { deskLines, planCash } from "../lib/planSummary.js";
import { fmt } from "../labels.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";

const DESK_ORDER: CockpitDesk[] = ["commercial", "operations", "people", "finance", "strategy"];

export function RoundTable({ view, rationale, seatRole, onFocusDesk }: {
  view: GameView;
  rationale: Record<string, string>;
  seatRole?: string | null;
  onFocusDesk: (desk: CockpitDesk) => void;
}) {
  const mpSeats = view.seats.length > 0;
  const called = DESK_ORDER.filter((d) => (rationale[d] ?? "").trim().length > 0).length;

  return (
    <Card>
      <div className="flex items-center gap-1.5">
        <Eyebrow>Round table</Eyebrow>
        <InfoDot title="The huddle" align="right">
          {mpSeats
            ? "Each seat drafts its slice; the firm's decision is composed from all of them. Watch who's still out before you lock the round."
            : "You hold every chair. Make each officer's call (jot it in their cockpit), then commit as the firm. In team play these become each teammate's proposal to the table."}
        </InfoDot>
      </div>

      {mpSeats ? (
        <TeamPlanBoard view={view} seatRole={seatRole} />
      ) : (
        <>
          <div className="mb-1 mt-0.5 font-mono text-[0.58rem] uppercase tracking-wide text-inksoft">{called}/{DESK_ORDER.length} calls made</div>
          <div className="grid gap-1.5">
            {DESK_ORDER.map((d) => {
              const p = PERSONAS[d];
              const note = (rationale[d] ?? "").trim();
              return (
                <button key={d} onClick={() => onFocusDesk(d)} className="group grid grid-cols-[auto_1fr] items-start gap-x-2 rounded-lg border border-line2 bg-panel px-2.5 py-1.5 text-left transition-colors hover:border-copper">
                  <span className="mt-0.5 h-1.5 w-1.5 rounded-full" style={{ background: note ? p.accent : "var(--color-line2)" }} />
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-mono text-[0.58rem] font-bold uppercase tracking-wide" style={{ color: p.accent }}>{p.short}</span>
                      <span className="truncate text-[0.7rem] text-inksoft">{p.title}</span>
                    </span>
                    <span className="block truncate text-[0.74rem] text-ink">{note || <span className="italic text-inksoft/70">no call yet — open this desk</span>}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The live team plan (DW-038): readiness rail + the composed decision desk by desk,
 * each slice attributed to the seat that owns it, closing with the cash check. What
 * renders here IS what resolves — the server's merged decision, not local drafts.
 */
function TeamPlanBoard({ view, seatRole }: { view: GameView; seatRole?: string | null }) {
  const plan = view.teamPlan;
  const composed = plan?.composed ?? null;
  const seats = plan?.seats ?? [];
  // Who owns a desk right now: a submitted specialist, else a submitted generalist
  // (CEO / founder gap-fill), else nobody — the desk rides the house defaults.
  const ownerOf = (desk: CockpitDesk) =>
    seats.find((s) => s.desk === desk && s.submitted) ?? seats.find((s) => s.desk === "all" && s.submitted) ?? null;
  const waitingSpecialist = (desk: CockpitDesk) => seats.find((s) => s.desk === desk && !s.submitted) ?? null;
  const cash = composed ? planCash(composed, view) : null;

  return (
    <div className="mt-1 grid gap-2">
      {/* readiness rail */}
      <div className="grid gap-1">
        {view.seats.map((st, i) => (
          <div key={i} className="flex items-center justify-between text-[0.78rem]">
            <span className="truncate text-ink">{st.name} {st.role && <span className="font-mono text-[0.6rem] uppercase text-copperdeep">{st.role}</span>}{st.desk && st.desk !== "all" && <span className="text-[0.66rem] text-inksoft"> · {st.desk}</span>}</span>
            <span className="font-mono text-[0.58rem] font-bold uppercase tracking-wide" style={{ color: st.submitted ? "var(--color-hop)" : "var(--color-inksoft)" }}>{st.submitted ? "✓ in" : "waiting"}</span>
          </div>
        ))}
      </div>

      {/* the composed plan, desk by desk */}
      {!composed ? (
        <div className="rounded-lg border border-dashed border-line2 bg-panel px-2.5 py-2 text-[0.72rem] text-inksoft">
          Nothing on the table yet — as each desk submits, the firm's composed plan appears here for everyone to review.
        </div>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.12em] text-copperdeep">The firm's plan {plan?.locked ? "· LOCKED" : "· live"}</span>
            {seatRole === "ceo" && !plan?.locked && <span className="text-[0.62rem] italic text-inksoft">you hold the gavel — this is what commits at lock</span>}
          </div>
          {DESK_ORDER.map((desk) => {
            const p = PERSONAS[desk];
            const owner = ownerOf(desk);
            const waiting = !owner ? waitingSpecialist(desk) : null;
            const lines = deskLines(desk, composed, view);
            return (
              <div key={desk} className="rounded-lg border border-line2 bg-panel px-2.5 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[0.58rem] font-bold uppercase tracking-wide" style={{ color: p.accent }}>{p.short}</span>
                  <span className="truncate font-mono text-[0.56rem] uppercase tracking-wide text-inksoft">
                    {owner ? `${owner.name}${owner.desk === "all" && desk !== "strategy" ? " (gap-fill)" : ""}${owner.me ? " · you" : ""}`
                      : waiting ? `waiting on ${waiting.name}`
                      : "unmanned · house defaults"}
                  </span>
                </div>
                {lines.length > 0 ? (
                  <div className="mt-0.5 grid gap-0.5">
                    {lines.map((l, i) => <div key={i} className="truncate text-[0.72rem] text-ink">{l}</div>)}
                  </div>
                ) : (
                  <div className="mt-0.5 text-[0.7rem] italic text-inksoft/80">no moves this round</div>
                )}
              </div>
            );
          })}

          {/* the cash check — spending desks vs the financing desk, before lock */}
          {cash && (
            <div className="rounded-lg border px-2.5 py-1.5" style={{
              borderColor: cash.after < 0 ? "var(--color-brick)" : "var(--color-line2)",
              background: cash.after < 0 ? "color-mix(in srgb, var(--color-brick) 8%, var(--color-panel))" : "var(--color-panel)",
            }}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[0.72rem]">
                <span className="font-mono text-[0.56rem] font-bold uppercase tracking-wide text-inksoft">Cash check</span>
                <span className="text-ink">committed ≈ {fmt.money(cash.out)}</span>
                <span className="text-ink">financing +{fmt.money(cash.inflow)}</span>
                <span className="font-semibold" style={{ color: cash.after < 0 ? "var(--color-brick)" : "var(--color-hop)" }}>
                  {cash.after < 0 ? `short ${fmt.money(-cash.after)}` : `≈ ${fmt.money(cash.after)} left`}
                </span>
              </div>
              {cash.after < 0 && <div className="mt-0.5 text-[0.66rem] text-brick">The plan spends more than cash + financing covers — trim a desk or have the CFO draw funds. (Estimate: payroll &amp; production costs not included.)</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
