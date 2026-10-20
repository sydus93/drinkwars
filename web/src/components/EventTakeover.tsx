/**
 * DW-077 the event takeover (design/round-ux-2026-10 §A): a one-time card over the Decide screen
 * when a market event is announced or starts. Hazard stripe, kicker, 62px headline, the
 * "What it means for your desk, {FIRST NAME}" box with the seat-specific sentence, "ALSO ON THE
 * WIRE" rows for any further events, then "Got it, back to my desk" beside the round clock.
 * Desktop = centred 820px card; mobile = bottom sheet with the button pinned.
 *
 * Shown ONCE per student per event per phase (announced → hits counts as new): dismissal is
 * stored in localStorage as `dw_wire_seen:{gameId}:{shockKey}:{phase}` (`useUnseenWire`).
 * The round timer keeps running underneath — nothing here pauses or blocks the poll.
 *
 * Automation guard: the browser audits (web/scripts/*-audit.mjs, *-rehearsal.mjs) drive the
 * Decide screen through headless Chrome, where `navigator.webdriver` is true. A planted or
 * engine-rolled shock would otherwise park this card over the submit button and break every
 * click they make, so the takeover is auto-skipped (never shown, nothing stored) when
 * `navigator.webdriver` is true. A screenshot run that WANTS the card overrides the property
 * (`Object.defineProperty(navigator, "webdriver", { get: () => false })`) before load.
 */
import { useEffect, useMemo, useState } from "react";
import type { WireEvent } from "../lib/eventCopy.js";
import { SEAT_INK, seatColor, seatLabel } from "../lib/seatColors.js";

const TONE = { red: "var(--wire-red)", amber: "var(--wire-amber)" } as const;

const seenKey = (gameId: string, e: WireEvent) => `dw_wire_seen:${gameId}:${e.key}:${e.phase}`;
const isAutomation = (): boolean => typeof navigator !== "undefined" && navigator.webdriver === true;

/** DW-080: storage can refuse (a private window, a full quota) — a dismiss must still stick for the
 *  life of the page, or the takeover can never be closed. Keys mirror localStorage's. */
const seenMem = new Set<string>();
/** Which of the current wire events this student has not yet dismissed, + the dismisser. */
export function useUnseenWire(events: WireEvent[], gameId: string | null | undefined): { unseen: WireEvent[]; dismiss: () => void } {
  const gid = gameId || "solo";
  const [bump, setBump] = useState(0);
  const sig = events.map((e) => `${e.key}:${e.phase}`).join("|");
  const unseen = useMemo(() => {
    void bump;
    if (isAutomation()) return [];
    return events.filter((e) => { const k = seenKey(gid, e); if (seenMem.has(k)) return false; try { return localStorage.getItem(k) == null; } catch { return true; } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, gid, bump]);
  const dismiss = () => {
    for (const e of unseen) { const k = seenKey(gid, e); seenMem.add(k); try { localStorage.setItem(k, String(Date.now())); } catch { /* memory holds it for this page */ } }
    setBump((b) => b + 1);
  };
  return { unseen, dismiss };
}

/** A 1 Hz clock while `active` (the deadline countdown); idle otherwise. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** "7:42" · "1 h 12 min" · "0:00" */
export function fmtClock(ms: number): string {
  if (ms <= 0) return "0:00";
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  if (m >= 90) return `${Math.floor(m / 60)} h ${m % 60} min`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function EventTakeover({ events, role, name, round, deadlineAt, onDismiss }: {
  events: WireEvent[]; // the lead is events[0]; the rest become "ALSO ON THE WIRE" rows
  role?: string | null; // seat (team play) — null in solo
  name?: string | null; // the student's display name (first name is used)
  round: number; // the round as shown to the student (1-based)
  deadlineAt?: number | null; // instructor-announced deadline, ms epoch
  onDismiss: () => void;
}) {
  const lead = events[0];
  const others = events.slice(1);
  const now = useNow(!!deadlineAt);
  if (!lead) return null;
  const c = TONE[lead.tone];
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  const left = deadlineAt ? deadlineAt - now : null;
  const clock = left != null && left > 0 ? `${fmtClock(left)} left in Round ${round}. The clock keeps running.` : `Round ${round} is open.`;
  const clockShort = left != null && left > 0 ? `${fmtClock(left)} left. The clock keeps running.` : `Round ${round} is open.`;
  const seatC = seatColor(role);
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-labelledby="dw-takeover-h" data-takeover={lead.phase}>
      <div className="absolute inset-0" style={{ background: "rgba(12,7,3,.62)" }} />
      <div className="dwsheet absolute inset-x-0 bottom-0 top-[70px] flex flex-col overflow-hidden rounded-t-[24px] border border-line bg-panel sm:inset-auto sm:left-1/2 sm:top-[110px] sm:w-[820px] sm:max-w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:rounded-[18px]" style={{ boxShadow: "0 30px 80px rgba(0,0,0,.45)", maxHeight: "calc(100vh - 70px)" }}>
        <div className="dw-hazard h-3 flex-none sm:h-[14px]" style={{ "--hz": c } as React.CSSProperties} />
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-[22px] pt-[22px] sm:gap-5 sm:px-11 sm:pt-[34px]">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[0.72rem] font-bold tracking-[0.16em] sm:text-[0.8rem]" style={{ color: c }}>{lead.kicker}</span>
            <span className="hidden font-mono text-[0.8rem] font-semibold tracking-[0.08em] text-inksoft sm:inline">{lead.scope}</span>
          </div>
          <div className="flex flex-col gap-2">
            <h2 id="dw-takeover-h" className="display text-[42px] font-bold leading-none text-ink sm:text-[62px]" style={{ textWrap: "balance" } as React.CSSProperties}>{lead.headline}</h2>
            <div className="text-[19px] leading-snug text-inksoft sm:text-[22px]">{lead.subline}</div>
          </div>
          <div className="flex flex-col gap-2 rounded-[12px] border border-line bg-panel2 px-4 py-4 sm:gap-2.5 sm:px-6 sm:py-5">
            <div className="flex items-center gap-2.5">
              <span className="rounded-[6px] px-2.5 py-1 font-mono text-[0.78rem] font-bold" style={{ background: seatC, color: role ? SEAT_INK : "var(--color-paper)" }}>{seatLabel(role)}</span>
              <span className="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-inksoft sm:text-[0.8rem]">
                <span className="hidden sm:inline">What it means for your desk{first ? `, ${first}` : ""}</span>
                <span className="sm:hidden">For your desk</span>
              </span>
            </div>
            <div className="text-[19px] leading-[1.4] text-ink sm:text-[21px]" style={{ textWrap: "pretty" } as React.CSSProperties}>{lead.long}</div>
          </div>
          {others.map((o) => (
            <div key={`${o.key}:${o.phase}`} className="flex flex-col gap-1 border-t border-line pt-3 text-[17px] text-ink sm:flex-row sm:items-baseline sm:gap-3.5 sm:text-[19px]">
              <span className="font-mono text-[0.72rem] font-bold tracking-[0.12em]" style={{ color: TONE[o.tone] }}>ALSO ON THE WIRE</span>
              <span><b>{o.title}</b> · {o.summary}</span>
            </div>
          ))}
          <div className="h-1 flex-none sm:hidden" />
        </div>
        <div className="flex flex-none flex-col gap-2.5 px-[18px] pb-7 pt-4 sm:flex-row sm:items-center sm:gap-5 sm:px-11 sm:pb-9 sm:pt-2">
          <button onClick={onDismiss} autoFocus className="w-full rounded-[12px] px-5 py-[18px] font-mono text-[17px] font-bold tracking-[0.04em] transition-opacity hover:opacity-90 sm:flex-1 sm:py-5" style={{ background: "var(--color-ink)", color: "var(--color-paper)" }}>Got it, back to my desk</button>
          <div className="text-center text-[16px] leading-tight text-inksoft sm:w-[220px] sm:text-left sm:text-[17px]">
            <span className="hidden sm:inline">{clock}</span>
            <span className="sm:hidden">{clockShort}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
