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
import type { FirmDecision } from "drinkwars-engine";
import { ROLE_DESK } from "drinkwars-engine";
import type { GameView, TeamPlanSeat } from "../game/controller.js";
import { PERSONAS, type CockpitDesk } from "../deskMeta.js";
import { planCash } from "../lib/planSummary.js";
import { leverText } from "../lib/reconcile.js";
import { planTable, TABLE_DESKS, type TableDesk } from "../lib/roundTable.js";
import { fmt } from "../labels.js";
import { Card, Eyebrow } from "./ui.js";
import { InfoDot } from "./InfoDot.js";

const DESK_ORDER: CockpitDesk[] = ["commercial", "operations", "people", "finance", "strategy"];

export function RoundTable({ view, rationale, seatRole, standing, onFocusDesk }: {
  view: GameView;
  rationale: Record<string, string>;
  seatRole?: string | null;
  standing?: FirmDecision | null; // DW-076: the firm's standing plan — what "unchanged" means
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
            ? "Each seat submits its desk; the engine composes one plan from all of them, and this is that plan — every value, who it came from, and any entry that will NOT run. Anything you change on your desk is used; a lever you leave at last round's value follows the CEO's call."
            : "You hold every chair. Make each officer's call (jot it in their cockpit), then commit as the firm. In team play these become each teammate's proposal to the table."}
        </InfoDot>
      </div>

      {mpSeats ? (
        <TeamPlanBoard view={view} seatRole={seatRole} standing={standing} />
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
 * The live team plan (DW-038 → DW-076): readiness rail + the plan the server holds, lever by
 * lever, each value credited to the seat the ENGINE credits (composeTeamDecision's provenance,
 * DW-073), with ✎ where that seat changed it this round and ✗ under every entry a chair made
 * that will NOT run — including the Sprint-1 case, spelled out: "the COO left this at last
 * round's value, so the CEO's entry runs". What renders here IS what resolves at lock; the
 * form above is only this seat's draft until it is submitted.
 */
function TeamPlanBoard({ view, seatRole, standing }: { view: GameView; seatRole?: string | null; standing?: FirmDecision | null }) {
  const plan = view.teamPlan;
  const seats = plan?.seats ?? [];
  const table = planTable(plan, standing);
  const composed = table.composed ?? plan?.composed ?? null;
  const me = seats.find((s) => s.me) ?? null;
  const cash = composed ? planCash(composed, view) : null;
  const t = (f: keyof FirmDecision, v: unknown) => leverText(String(f), v, view);
  const who = (s: TeamPlanSeat) => (s.me ? "you" : `${s.name}${s.role ? ` · ${s.role.toUpperCase()}` : ""}`);
  const chairOf = (desk: TableDesk) => seats.find((s) => (s.desk ?? (s.role ? ROLE_DESK[s.role] : null)) === desk) ?? null;
  const ceoSeated = seats.some((s) => (s.desk ?? (s.role ? ROLE_DESK[s.role] : null)) === "all");
  const myUnused = table.rows.reduce((n, r) => n + r.unused.filter((u) => u.seat.me).length, 0);
  void seatRole;

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

      {/* the plan, lever by lever */}
      {!composed ? (
        <div className="rounded-lg border border-dashed border-line2 bg-panel px-2.5 py-2 text-[0.72rem] text-inksoft">
          Nothing on the table yet — as each desk submits, what the firm will actually do appears here for everyone to check.
        </div>
      ) : (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.12em] text-copperdeep">What will run {plan?.locked ? "· LOCKED" : "· live"}</span>
            {table.unusedCount > 0 && <span className="rounded-full border border-brick/60 px-1.5 py-0.5 font-mono text-[0.56rem] uppercase tracking-wide text-brick">✗ {table.unusedCount} entr{table.unusedCount === 1 ? "y" : "ies"} not used</span>}
          </div>
          {me && !me.submitted && !plan?.locked && (
            <div className="text-[0.68rem] italic text-inksoft">You haven't submitted this round — your desk isn't on the table yet.</div>
          )}
          {myUnused > 0 && (
            <div className="rounded-md border border-brick/50 px-2 py-1 text-[0.7rem] text-brick">{myUnused === 1 ? "One of your entries" : `${myUnused} of your entries`} will not run — see the ✗ rows. Change it on your desk and submit again, or settle it with the chair who owns it.</div>
          )}
          {TABLE_DESKS.map((desk) => {
            const p = PERSONAS[desk];
            const chair = chairOf(desk);
            const rows = table.rows.filter((r) => r.desk === desk);
            return (
              <div key={desk} className="rounded-lg border border-line2 bg-panel px-2.5 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[0.58rem] font-bold uppercase tracking-wide" style={{ color: p.accent }}>{p.short}</span>
                  <span className="truncate font-mono text-[0.56rem] uppercase tracking-wide text-inksoft">
                    {chair ? `${chair.me ? "you" : chair.name} · ${chair.submitted ? "in" : "waiting"}`
                      : desk === "strategy" ? (ceoSeated ? "the CEO's desk" : "no CEO seated")
                      : ceoSeated ? "empty chair · the CEO covers it" : "empty chair"}
                  </span>
                </div>
                {rows.length > 0 ? (
                  <div className="mt-0.5 grid gap-0.5">
                    {rows.map((r) => (
                      <div key={String(r.field)} className="grid gap-0.5">
                        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[0.72rem]">
                          <span className="text-inksoft">{r.label}</span>
                          <span className="font-semibold text-ink">{t(r.field, r.value)}</span>
                          <span className="flex-1" />
                          <span className="font-mono text-[0.56rem] uppercase tracking-wide" style={{ color: r.author?.me ? "var(--color-hop)" : "var(--color-inksoft)" }} title={r.author ? (r.authorChanged ? "changed this round" : "submitted unchanged") : "nobody set it; last round's plan carries"}>
                            {r.author ? `${r.authorChanged ? "✎ " : ""}${who(r.author)}` : "carried"}
                          </span>
                        </div>
                        {r.chairYielded && (
                          <div className="text-[0.66rem] italic text-inksoft">{r.chairYielded.me ? "You" : who(r.chairYielded)} left this at last round's value, so the CEO's entry runs.{r.chairYielded.me ? " To keep yours, change it (or press Keep mine in the commit panel) and submit again." : ""}</div>
                        )}
                        {r.unused.map((u, i) => (
                          <div key={i} className="text-[0.66rem] text-brick">✗ {u.seat.me ? "You" : who(u.seat)} entered {t(r.field, u.value)} — not used{r.author && r.author !== u.seat ? ` (${r.author.me ? "yours" : who(r.author) + "'s"} stands)` : ""}.</div>
                        ))}
                      </div>
                    ))}
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
