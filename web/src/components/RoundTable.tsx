/**
 * Teams-mode L1 — the Round Table (DW-031, the Huddle beat). Turns the parallel desk
 * cockpits into a collective pre-commit review: each officer's call gathered in one place
 * with a readiness signal, before the team locks the round.
 *
 * SOLO: the five desks you wear yourself — a checklist of "have I made each call?" plus the
 * rationale you jotted, click-to-jump back to a desk. TEAM: the seat roster with live submit
 * status (the readiness rail). Cross-seat proposal *content* + the agency gap (proposed vs
 * committed) arrive with rationale persistence — this is the seam.
 */
import type { GameView } from "../game/controller.js";
import { PERSONAS, type CockpitDesk } from "../deskMeta.js";
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
        <div className="mt-1 grid gap-1">
          {view.seats.map((st, i) => (
            <div key={i} className="flex items-center justify-between text-[0.78rem]">
              <span className="truncate text-ink">{st.name} {st.role && <span className="font-mono text-[0.6rem] uppercase text-copperdeep">{st.role}</span>}{st.desk && st.desk !== "all" && <span className="text-[0.66rem] text-inksoft"> · {st.desk}</span>}</span>
              <span className="font-mono text-[0.58rem] font-bold uppercase tracking-wide" style={{ color: st.submitted ? "var(--color-hop)" : "var(--color-inksoft)" }}>{st.submitted ? "✓ in" : "waiting"}</span>
            </div>
          ))}
        </div>
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
