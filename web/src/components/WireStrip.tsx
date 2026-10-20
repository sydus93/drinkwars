/**
 * DW-077 the wire strip (design/round-ux-2026-10 §A, "after dismissal"): one full-width row per
 * event the student may know about, directly under the header on EVERY tab. A 3px top border in
 * the event colour on its tint; 150px tag · title + one-line summary with "For your desk:" below ·
 * "IN EFFECT · ROUND n" on the right. No events → one muted line. Pure presentation over
 * `eventCopy()`; the takeover card is EventTakeover.tsx.
 */
import type { WireEvent } from "../lib/eventCopy.js";

const TONE = {
  red: { c: "var(--wire-red)", bg: "var(--wire-redbg)" },
  amber: { c: "var(--wire-amber)", bg: "var(--wire-amberbg)" },
} as const;

export function WireStrip({ events }: { events: WireEvent[] }) {
  if (!events.length) {
    return (
      <div className="border-b border-line px-3 py-2 text-[0.95rem] text-inksoft sm:px-5 sm:py-2.5" data-wire="quiet">
        <span className="hidden sm:inline">The wire is quiet. No market events this round.</span>
        <span className="sm:hidden">The wire is quiet this round.</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col" data-wire="rows">
      {events.map((e) => {
        const t = TONE[e.tone];
        return (
          <div key={`${e.key}:${e.phase}`} className="grid items-center gap-x-5 gap-y-1 border-b border-line px-3 py-2.5 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:px-5 sm:py-3" style={{ background: t.bg, borderTop: `3px solid ${t.c}` }}>
            <div className="flex items-center gap-2.5">
              <span className="rounded-[6px] px-2.5 py-1 text-center font-mono text-[0.68rem] font-bold tracking-[0.12em] sm:w-full" style={{ background: t.c, color: "var(--color-paper)" }}>{e.tag}</span>
              <span className="display text-[1.1rem] font-semibold leading-tight sm:hidden">{e.title}</span>
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="hidden text-[1.15rem] font-semibold leading-tight text-ink sm:block">{e.title} <span className="font-normal text-inksoft">· {e.summary}</span></span>
              <span className="text-[0.95rem] leading-snug text-ink sm:text-[1rem]"><b style={{ color: t.c }}><span className="hidden sm:inline">For your desk:</span><span className="sm:hidden">Your desk:</span></b> {e.short}</span>
            </div>
            <span className="hidden font-mono text-[0.7rem] font-semibold tracking-[0.08em] text-inksoft sm:block">IN EFFECT · {e.when}</span>
          </div>
        );
      })}
    </div>
  );
}
