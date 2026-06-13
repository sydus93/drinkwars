import { useEffect, useMemo, useState } from "react";
import type { EventKind, GameEvent } from "./EventModal.js";

/** Display order + framing per category. One shelf per kind; empty shelves don't render. */
const SECTIONS: { kind: EventKind; glyph: string; label: string; accent: string; blurb: string }[] = [
  { kind: "shock", glyph: "⚠", label: "Disruptions", accent: "text-brick", blurb: "Things that hit the industry — shocks, exits, backlash." },
  { kind: "market", glyph: "◈", label: "Market shifts", accent: "text-copperdeep", blurb: "The ground moving — tastes, categories, consolidation." },
  { kind: "regulatory", glyph: "§", label: "Regulatory & financial", accent: "text-copperdeep", blurb: "Regulators, antitrust, notes converting." },
  { kind: "opportunity", glyph: "✦", label: "Moves & openings", accent: "text-hop", blurb: "Who did what — expansions, hires, plays, deals." },
  { kind: "info", glyph: "ℹ", label: "Notices", accent: "text-inksoft", blurb: "Everything else worth a line." },
];

/**
 * The end-of-round briefing: every dispatch from the resolved round in ONE
 * categorized, collapsible outline — skim the headlines, expand what matters,
 * dismiss once. Replaces the old one-pop-up-per-event queue. Events that
 * mention your brewery are flagged and float to the top of their section.
 */
export function RoundReport({
  round,
  events,
  final = false,
  onClose,
}: {
  round: number; // the round that just resolved (1-based for display)
  events: GameEvent[]; // already parsed (eventFeed.parseEvents), `mine` flag set
  final?: boolean; // season over — no next round to tee up
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<EventKind>>(new Set());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sections = useMemo(() => {
    // Ownership is determined at parse time (eventFeed.mentionsName), not by a
    // substring scan here — so a short name like "ya" never false-matches "loyal".
    return SECTIONS.map((s) => {
      const items = events
        .filter((e) => e.kind === s.kind)
        .map((e) => ({ ...e, you: !!e.mine }))
        .sort((a, b) => Number(b.you) - Number(a.you));
      return { ...s, items };
    }).filter((s) => s.items.length > 0);
  }, [events]);

  if (!sections.length) return null;
  const total = sections.reduce((a, s) => a + s.items.length, 0);
  const toggle = (kind: EventKind) => {
    const next = new Set(collapsed);
    next.has(kind) ? next.delete(kind) : next.add(kind);
    setCollapsed(next);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rise flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border-2 border-copper bg-paper shadow-2xl">
        {/* Masthead */}
        <div className="border-b border-line px-5 pt-4 pb-3">
          <div className="text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-copperdeep">The round in review</div>
          <h3 className="display text-xl font-semibold leading-tight text-ink">
            Round {round} — {total} dispatch{total === 1 ? "" : "es"}
          </h3>
        </div>

        {/* Categorized outline */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="grid gap-2">
            {sections.map((s) => {
              const isOpen = !collapsed.has(s.kind);
              return (
                <div key={s.kind} className="overflow-hidden rounded-md border border-line">
                  <button
                    type="button"
                    onClick={() => toggle(s.kind)}
                    className="flex w-full items-center gap-2 bg-paper2/50 px-3 py-2 text-left transition-colors hover:bg-paper2"
                  >
                    <span className={`text-base leading-none ${s.accent}`} aria-hidden>{s.glyph}</span>
                    <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink">{s.label}</span>
                    <span className="font-mono text-[0.62rem] text-inksoft">{s.items.length}</span>
                    {s.items.some((i) => i.you) && (
                      <span className="rounded-full border border-copper px-1.5 py-px text-[0.56rem] font-semibold uppercase tracking-[0.1em] text-copperdeep">involves you</span>
                    )}
                    <span className={`ml-auto inline-block text-[0.6rem] text-inksoft transition-transform ${isOpen ? "rotate-90" : ""}`}>▸</span>
                  </button>
                  {isOpen && (
                    <ul className="grid gap-1.5 p-2.5">
                      {s.items.map((e) => (
                        <li key={e.id} className={`flex gap-2 rounded-[3px] py-0.5 pr-1 text-sm leading-snug ${e.you ? "border-l-2 border-copper bg-copper/[0.06] pl-2" : "pl-1"}`}>
                          <div className="min-w-0">
                            <span className="font-semibold text-ink">{e.title}.</span>{" "}
                            <span className="text-inksoft">{e.body}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-line px-5 py-3">
          <button onClick={onClose} className="tt-btn tt-btn--go w-full text-sm">{final ? "To the final standings →" : `On to round ${round + 1} →`}</button>
          <div className="mt-1.5 text-center text-[0.64rem] text-inksoft">These dispatches stay in the rail if you want them later.</div>
        </div>
      </div>
    </div>
  );
}
