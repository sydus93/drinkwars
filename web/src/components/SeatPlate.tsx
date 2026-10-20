/**
 * DW-077 seat identity (design/round-ux-2026-10 §B): the header plate ("CFO | Ben Okafor /
 * YOUR SEAT · FINANCE DESK"), the row of other-seat chips ("CEO ✓", "CHRO · empty", own chip at
 * 35%), the page edge (8px left border on desktop; a 4px frame on mobile) and the mobile seat
 * bar at the very top of the screen. Every colour comes from seatColors.ts. Solo play (no seat)
 * renders none of this — Play.tsx gates on `seatRole`.
 */
import type { TeamSeat } from "../game/controller.js";
import { SEAT_INK, SEAT_ROLES, seatColor, seatDeskLong, seatDeskShort, seatLabel, seatTint } from "../lib/seatColors.js";

export function SeatPlate({ role, name, seats }: { role: string; name: string; seats: TeamSeat[] }) {
  const c = seatColor(role);
  return (
    <div className="hidden items-center gap-3 sm:flex" data-seat-plate={role}>
      <div className="flex items-stretch overflow-hidden rounded-[12px]" style={{ border: `2px solid ${c}`, background: seatTint(role) }}>
        <div className="flex items-center px-[18px] font-mono text-[1.3rem] font-bold tracking-[0.04em]" style={{ background: c, color: SEAT_INK }}>{seatLabel(role)}</div>
        <div className="flex flex-col px-[18px] py-2">
          <span className="display max-w-[15rem] truncate text-[1.25rem] font-semibold leading-[1.1] text-ink" title={name || undefined}>{name || "You"}</span>
          <span className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.08em] text-inksoft">Your seat · {seatDeskLong(role)}</span>
        </div>
      </div>
      <SeatChips role={role} seats={seats} />
    </div>
  );
}

/** One chip per C-suite chair: "CEO ✓" submitted · "CEO" seated · "CHRO · empty"; yours at 35%. */
export function SeatChips({ role, seats }: { role: string; seats: TeamSeat[] }) {
  return (
    <div className="hidden flex-wrap items-center gap-1.5 md:flex" data-seat-chips>
      {SEAT_ROLES.map((r) => {
        const s = seats.find((x) => x.role === r);
        const label = `${r.toUpperCase()}${s ? (s.submitted ? " ✓" : "") : " · empty"}`;
        return <span key={r} title={s ? `${s.name}${s.submitted ? " — submitted this round" : ""}` : "No one is seated here"} className="rounded-[6px] border border-line px-2.5 py-1.5 font-mono text-[0.68rem] font-semibold text-inksoft" style={{ opacity: r === role ? 0.35 : 1 }}>{label}</span>;
      })}
    </div>
  );
}

/** The page edge: 8px left border (desktop) · 4px frame (mobile). Fixed, non-interactive. */
export function SeatEdge({ role }: { role: string }) {
  const c = seatColor(role);
  return (
    <>
      <div aria-hidden className="pointer-events-none fixed bottom-0 left-0 top-0 z-40 hidden w-2 sm:block" style={{ background: c }} />
      <div aria-hidden className="pointer-events-none fixed inset-0 z-40 sm:hidden" style={{ border: `4px solid ${c}` }} />
    </>
  );
}

/** Mobile only: the solid seat-colour bar at the very top — role · name · short desk label. */
export function SeatMobileBar({ role, name }: { role: string; name: string }) {
  return (
    <div className="flex items-center gap-2.5 px-[18px] py-3 sm:hidden" style={{ background: seatColor(role), color: SEAT_INK }} data-seat-bar={role}>
      <span className="font-mono text-[1.25rem] font-bold">{seatLabel(role)}</span>
      <span className="display min-w-0 flex-1 truncate text-[1.15rem] font-semibold" style={{ color: SEAT_INK }}>{name || "You"}</span>
      <span className="flex-none font-mono text-[0.7rem] font-semibold uppercase tracking-[0.08em]">{seatDeskShort(role)}</span>
    </div>
  );
}
